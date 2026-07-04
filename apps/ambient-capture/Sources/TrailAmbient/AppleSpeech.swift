// F201.6.7 — Apple on-device streaming STT (SFSpeechRecognizer).
//
// Ported from buddy's proven iOS SpeechService (apps/ios/Buddy/Services/
// SpeechService.swift) — the same engine iPhone dictation uses — and adapted
// for macOS. WHY this over WhisperKit (F201.6.2): WhisperKit is BATCH (record →
// wait → transcribe the whole clip), which on large models triggered a
// multi-minute ANE compile + a visible wait. SFSpeechRecognizer STREAMS: partial
// results arrive as you speak, so the HUD shows text live ("skriver mens jeg
// taler", Christian 2026-07-03). Danish via locale da-DK.
//
// PRIVACY: forced on-device (requiresOnDeviceRecognition) when the device
// supports it, so audio never leaves the Mac — Trail's egress guarantee, same
// as screen frames. buddy deliberately allowed the server engine (personal
// tool, long dictation); Trail's privacy stance picks on-device.
//
// The hard-won bits copied verbatim from buddy: SFSpeechRecognizer auto-
// finalizes on long pauses and caps on-device tasks at ~60s, so a proactive
// 45s restart spawns a fresh task on the still-running audio engine and freezes
// the prior text into `accumulated` — no dropped words across a long note.
//
// macOS differences from the iOS original: no AVAudioSession (iOS-only) — the
// AVAudioEngine tap is used directly; mic permission is the existing AVCapture
// grant (AudioWatcher + the audio-input entitlement); speech permission is the
// separate SFSpeechRecognizer authorization requested here.
import Foundation
import Speech
@preconcurrency import AVFoundation

@MainActor
final class AppleSpeech: ObservableObject {
    enum State: Equatable { case idle, listening, error(String) }

    @Published private(set) var state: State = .idle
    /// Live transcript — updates on every partial result while listening.
    @Published private(set) var transcript: String = ""
    /// True once the recognizer has committed the current segment.
    @Published private(set) var isFinal: Bool = false
    /// Live mic input level (0…1 peak) from the tap — drives the HUD level meter
    /// so it's VISIBLE whether audio is actually reaching the engine.
    @Published private(set) var inputLevel: Float = 0

    static var isSpeechAuthorized: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    private let recognizer: SFSpeechRecognizer? = SFSpeechRecognizer(locale: Locale(identifier: "da-DK"))
    private var audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var proactiveRestartTimer: Timer?
    private var configObserver: NSObjectProtocol?
    private var configRebuilds = 0
    /// F201.6 — records the full mic audio so the SAVED transcript can be produced
    /// by faithful BATCH transcription at stop (the streaming text is preview only).
    private var recorder: AudioRecorder?
    /// The kept .wav of the last dictation (nil if nothing was recorded).
    private(set) var lastRecordingURL: URL?

    /// Text locked in from earlier recognition tasks in THIS dictation session
    /// (see the 45s-restart note above). Only stop() clears it.
    private var accumulated: String = ""
    /// True while the user is capturing — distinguishes "recognizer auto-
    /// finalized but keep going" from "user pressed stop, we're done".
    private var userHolding = false
    private static let restartInterval: TimeInterval = 45

    /// Prompt for Speech authorization (mic is the separate AVCapture grant).
    func requestAuthorization() async -> Bool {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
    }

    func start() throws {
        guard state != .listening else { return }
        transcript = ""; accumulated = ""; isFinal = false; userHolding = true
        configRebuilds = 0
        lastRecordingURL = nil
        recorder = AudioRecorder(url: AudioRecorder.newRecordingURL())
        do {
            try buildEngineAndTap()
        } catch {
            userHolding = false
            throw error
        }
        spawnTask(replacingExisting: false)
        startProactiveRestartTimer()
        state = .listening
    }

    /// Build a FRESH audio engine bound to the CURRENT input device + format,
    /// install the level-metering tap, start it, and observe device changes.
    ///
    /// Two fixes live here:
    /// 1. Fresh engine + format guard. AVAudioEngine caches the input format at
    ///    graph-setup time; a stale one (or an invalid 0-ch/0-Hz one when the mic
    ///    isn't ready) makes installTap raise an Obj-C NSException Swift can't
    ///    catch → SIGABRT. Read the live format and validate first.
    /// 2. Config-change observer. AirPods flip A2DP (48 kHz) → HFP (24 kHz) the
    ///    instant the mic activates — AFTER we read the format — so the tap stays
    ///    on 48 kHz while the device delivers 24 kHz → the recognizer hears
    ///    NOTHING, or captures only the part before the flip ("opfanger intet" /
    ///    "ikke det hele kom med", Christian 2026-07-03; recording worked only
    ///    with Noise-Cancellation forcing a stable profile). On the change we
    ///    rebuild the graph at the new format so capture continues seamlessly.
    private func buildEngineAndTap() throws {
        if let o = configObserver { NotificationCenter.default.removeObserver(o); configObserver = nil }
        audioEngine = AVAudioEngine()
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            state = .error("mikrofon ikke klar")
            EventLog.shared.log(kind: "apple_speech_bad_format sr=\(Int(format.sampleRate)) ch=\(format.channelCount)")
            throw NSError(domain: "AppleSpeech", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Mikrofonen er ikke klar (intet gyldigt input-format)"])
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            let peak = Self.peakLevel(buffer)
            Task { @MainActor in
                self?.request?.append(buffer)
                self?.recorder?.append(buffer)   // keep the full audio for batch STT
                self?.inputLevel = peak
            }
        }
        audioEngine.prepare()
        try audioEngine.start()
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: audioEngine, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.handleConfigChange() }
        }
        EventLog.shared.log(kind: "apple_speech_listening sr=\(Int(format.sampleRate)) ch=\(format.channelCount)")
    }

    /// The input device/format changed mid-capture (AirPods profile flip, device
    /// swap). Rebuild the audio graph at the NEW format + a fresh recognizer,
    /// preserving the text so far. Capped so a flapping route can't loop forever.
    private func handleConfigChange() {
        guard userHolding, state == .listening else { return }
        configRebuilds += 1
        guard configRebuilds <= 4 else {
            EventLog.shared.log(kind: "apple_speech_config_change_giveup")
            return
        }
        EventLog.shared.log(kind: "apple_speech_config_change rebuild=\(configRebuilds)")
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        do {
            try buildEngineAndTap()               // fresh engine at the NEW format
            spawnTask(replacingExisting: true)     // fresh recognizer, keeps `accumulated`
        } catch {
            userHolding = false
            stopInternal()
        }
    }

    /// Peak amplitude (0…1) of a capture buffer — drives the input-level meter.
    private static func peakLevel(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let ch = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
        let n = Int(buffer.frameLength)
        var peak: Float = 0
        let data = ch[0]
        for i in 0..<n { peak = max(peak, abs(data[i])) }
        return min(1, peak)
    }

    /// Stop capturing and return the final transcript ("" → nil).
    func stop() -> String? {
        userHolding = false
        stopInternal()
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    // MARK: - Internals

    private func restartRecognition() {
        guard userHolding else { return }
        spawnTask(replacingExisting: true)
    }

    private func spawnTask(replacingExisting: Bool) {
        let oldRequest = replacingExisting ? request : nil
        let oldTask = replacingExisting ? task : nil

        // Freeze everything spoken so far into `accumulated` BEFORE swapping the
        // request. On a proactive (45s) or config-change restart the old task's
        // final callback is dropped by the `request === newReq` guard below, so
        // without this commit the WHOLE in-flight segment is lost on every restart
        // — long speeches were truncated to just their last segment ("længere
        // speeches blev afkortet", Christian 2026-07-03). transcript =
        // combine(accumulated, currentPartial), so this preserves the full text.
        if replacingExisting {
            accumulated = transcript
            isFinal = false
            EventLog.shared.log(kind: "apple_speech_restart accumulated_chars=\(accumulated.count)")
        }

        let newReq = SFSpeechAudioBufferRecognitionRequest()
        newReq.shouldReportPartialResults = true
        newReq.taskHint = .dictation
        // F201.14 pre-STT biasing — nudge the recogniser toward canonical dev/
        // product/person names BEFORE it mishears them (Apple's initialPrompt).
        newReq.contextualStrings = SpeechDictionary.contextualStrings
        // Privacy: keep audio on-device when supported (Trail egress guarantee).
        if recognizer?.supportsOnDeviceRecognition == true {
            newReq.requiresOnDeviceRecognition = true
        }
        request = newReq

        oldRequest?.endAudio()
        oldTask?.finish()

        task = recognizer?.recognitionTask(with: newReq) { [weak self] result, error in
            Task { @MainActor in
                guard let self, self.request === newReq else { return }  // drop late callbacks
                if let result {
                    let current = result.bestTranscription.formattedString
                    self.transcript = self.combine(self.accumulated, current)
                    self.isFinal = result.isFinal
                    if result.isFinal {
                        self.accumulated = self.combine(self.accumulated, current)
                        if self.userHolding {
                            Task { @MainActor in self.restartRecognition() }
                        } else {
                            self.stopInternal()
                        }
                    }
                }
                if error != nil {
                    self.userHolding = false
                    self.stopInternal()
                }
            }
        }
    }

    private func stopInternal() {
        stopProactiveRestartTimer()
        if let o = configObserver { NotificationCenter.default.removeObserver(o); configObserver = nil }
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        lastRecordingURL = recorder?.finish()
        recorder = nil
        request?.endAudio()
        task?.finish()
        request = nil; task = nil
        inputLevel = 0
        if state == .listening { state = .idle }
    }

    private func startProactiveRestartTimer() {
        stopProactiveRestartTimer()
        proactiveRestartTimer = Timer.scheduledTimer(withTimeInterval: Self.restartInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.restartRecognition() }
        }
    }
    private func stopProactiveRestartTimer() {
        proactiveRestartTimer?.invalidate(); proactiveRestartTimer = nil
    }

    private func combine(_ lhs: String, _ rhs: String) -> String {
        if lhs.isEmpty { return rhs }
        if rhs.isEmpty { return lhs }
        return lhs + " " + rhs
    }

    // MARK: - Headless file test (--speechtest), mirrors Whisper's --sttest proof

    /// Transcribe an audio file on-device (no engine/tap) — used by --speechtest
    /// to prove Danish recognition without a live mic.
    static func transcribeFile(path: String, locale: String = "da-DK") async -> String? {
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: locale)) else { return nil }
        let req = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
        req.taskHint = .dictation
        if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        return await withCheckedContinuation { cont in
            var resumed = false
            rec.recognitionTask(with: req) { result, error in
                if let error {
                    if !resumed { resumed = true; cont.resume(returning: nil) }
                    _ = error
                    return
                }
                if let result, result.isFinal, !resumed {
                    resumed = true
                    cont.resume(returning: result.bestTranscription.formattedString)
                }
            }
        }
    }
}
