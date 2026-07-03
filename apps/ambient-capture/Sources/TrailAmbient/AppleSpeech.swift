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

    static var isSpeechAuthorized: Bool {
        SFSpeechRecognizer.authorizationStatus() == .authorized
    }

    private let recognizer: SFSpeechRecognizer? = SFSpeechRecognizer(locale: Locale(identifier: "da-DK"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var proactiveRestartTimer: Timer?

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

        let input = audioEngine.inputNode
        // outputFormat(forBus:) reflects the LIVE hardware input. When the mic
        // isn't ready (not granted, no default input device, held by another
        // process) it comes back with 0 channels / 0 Hz — and installTap then
        // raises an Obj-C NSException, NOT a Swift error, so `try`/`catch` can't
        // catch it and the WHOLE APP aborts (SIGABRT — observed 2026-07-03:
        // "6 tryk på mikrofonen uden resultat", så crash). Validate FIRST and
        // throw a real Swift error so the caller recovers instead of dying.
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            state = .error("mikrofon ikke klar")
            EventLog.shared.log(kind: "apple_speech_bad_format sr=\(Int(format.sampleRate)) ch=\(format.channelCount)")
            throw NSError(domain: "AppleSpeech", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Mikrofonen er ikke klar (intet gyldigt input-format)"])
        }

        transcript = ""; accumulated = ""; isFinal = false; userHolding = true
        input.removeTap(onBus: 0)
        // The tap forwards buffers to whatever request is currently active, so a
        // recognizer restart picks up mid-stream without dropping audio.
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            Task { @MainActor in self?.request?.append(buffer) }
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            input.removeTap(onBus: 0)
            userHolding = false
            state = .error("kunne ikke starte lyd")
            EventLog.shared.log(kind: "apple_speech_engine_start_failed")
            throw error
        }

        spawnTask(replacingExisting: false)
        startProactiveRestartTimer()
        state = .listening
        EventLog.shared.log(kind: "apple_speech_listening sr=\(Int(format.sampleRate)) ch=\(format.channelCount)")
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

        let newReq = SFSpeechAudioBufferRecognitionRequest()
        newReq.shouldReportPartialResults = true
        newReq.taskHint = .dictation
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
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.finish()
        request = nil; task = nil
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
