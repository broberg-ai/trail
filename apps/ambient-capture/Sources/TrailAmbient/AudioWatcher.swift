// F201.6.1 — audio capture + VAD segmentation (mic; system-audio tap is F201.6.3).
//
// Mirrors ScreenWatcher's shape exactly: a privacy deny-list guard FIRST, then a
// separate TCC grant (mic) that ships dark when missing (logs
// audio_watcher_untrusted, captures nothing — no crash, no half-wired path). The
// live mic tap (AVAudioEngine) resamples to 16 kHz mono and feeds VAD; on a
// completed speech segment the samples are handed on for STT (F201.6.2). Raw
// audio lives only as PCM in memory for the segment's lifetime and is never
// persisted long-term nor network-sent — the egress guarantee, same as frames.
//
// The risky, testable core (WAV → PCM → VAD) is static + async-free so
// `--audiotest` proves it headlessly; the live engine needs a mic grant + real
// sound, so it's proven interactively.
@preconcurrency import AVFoundation

actor AudioWatcher {
    static let shared = AudioWatcher()

    private var vad = VAD()
    private let engine = AVAudioEngine()
    private var recording = false
    /// Rolling 16 kHz mono buffer of the current utterance-in-progress.
    private var buffer: [Float] = []
    /// App the deny-list is currently evaluated against (updated on focus change).
    private var frontApp: String = ""

    // MARK: TCC (ship-dark, mirrors ScreenWatcher.requestScreenRecordingIfNeeded)

    nonisolated static var isMicGranted: Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
    }

    /// Prompt for the mic on first run (system remembers the answer). No-op once
    /// decided; the grant needs no relaunch (unlike Screen Recording).
    nonisolated static func requestMicIfNeeded() {
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            AVCaptureDevice.requestAccess(for: .audio) { _ in }
        }
    }

    /// Track the frontmost app so the live tap can honour the deny-list without a
    /// per-buffer AX lookup (called from the focus watcher on activation).
    func setFrontApp(_ app: String) { frontApp = app }

    var isRecording: Bool { recording }

    // MARK: Capture-now ("optag nu", ⌃⌥R) — press to record, press to transcribe.

    /// Start a solo capture: mic tap → 16 kHz mono → buffer. Ships dark without a
    /// mic grant (logs audio_watcher_untrusted, returns false). Idempotent.
    @discardableResult
    func record() -> Bool {
        guard !recording else { return true }
        guard Self.isMicGranted else {
            Task { @MainActor in EventLog.shared.log(kind: "audio_watcher_untrusted") }
            return false
        }
        let input = engine.inputNode
        let hwFormat = input.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: hwFormat, to: Self.mono16k) else {
            Task { @MainActor in EventLog.shared.log(kind: "audio_watcher_no_converter") }
            return false
        }
        buffer.removeAll(keepingCapacity: true)
        input.installTap(onBus: 0, bufferSize: 4096, format: hwFormat) { [weak self] buf, _ in
            guard let self, let mono = Self.resample(buf, with: converter) else { return }
            Task { await self.ingest(mono) }
        }
        do {
            try engine.start()
            recording = true
            Task { @MainActor in EventLog.shared.log(kind: "audio_capture_started") }
            return true
        } catch {
            input.removeTap(onBus: 0)
            Task { @MainActor in EventLog.shared.log(kind: "audio_watcher_start_failed") }
            return false
        }
    }

    /// Stop recording, VAD-segment what was captured, transcribe each segment
    /// on-device, and return the joined transcript ("" if nothing was said).
    func finishAndTranscribe() async -> String {
        guard recording else { return "" }
        recording = false
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        let samples = buffer
        buffer.removeAll(keepingCapacity: false)
        let segments = vad.segments(samples)
        guard !segments.isEmpty else { return "" }
        var parts: [String] = []
        for seg in segments {
            let slice = Array(samples[seg.startSample ..< min(seg.endSample, samples.count)])
            if let text = try? await Whisper.shared.transcribe(samples: slice), !text.isEmpty {
                parts.append(text)
            }
        }
        return parts.joined(separator: " ")
    }

    /// Feed resampled mono frames through the deny-list guard into the buffer,
    /// only while recording. Privacy guard FIRST — a deny-listed app's audio
    /// never even buffers.
    private func ingest(_ mono: [Float]) {
        guard recording else { return }
        if Settings.isDenyListed(frontApp) { return }
        buffer.append(contentsOf: mono)
        let cap = 5 * 60 * 16_000  // ~5 min cap on a single capture
        if buffer.count > cap { buffer.removeFirst(buffer.count - cap) }
    }

    // MARK: Static core — WAV → PCM → VAD (headlessly testable, AC1/AC2)

    static let mono16k = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!

    /// Decode any audio file the system can read into 16 kHz mono float samples.
    static func decodeToMono16k(path: String) -> [Float]? {
        let url = URL(fileURLWithPath: path)
        guard let file = try? AVAudioFile(forReading: url) else { return nil }
        let srcFormat = file.processingFormat
        guard let srcBuf = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: AVAudioFrameCount(file.length)) else { return nil }
        do { try file.read(into: srcBuf) } catch { return nil }
        guard let converter = AVAudioConverter(from: srcFormat, to: mono16k) else { return nil }
        return resample(srcBuf, with: converter)
    }

    /// Run VAD over a decoded file — the `--audiotest <wav>` path (AC2).
    static func segments(fromFile path: String, vad: VAD = VAD()) -> [VAD.Segment]? {
        guard let samples = decodeToMono16k(path: path) else { return nil }
        return vad.segments(samples)
    }

    /// Write mono 16 kHz float samples to a WAV — used to export a detected
    /// segment for STT (F201.6.2) and to prove the decode round-trip in tests.
    @discardableResult
    static func writeWav(_ samples: [Float], to url: URL) -> Bool {
        guard let file = try? AVAudioFile(forWriting: url, settings: mono16k.settings),
              let buf = AVAudioPCMBuffer(pcmFormat: mono16k, frameCapacity: AVAudioFrameCount(max(1, samples.count)))
        else { return false }
        buf.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { src in
            if let base = src.baseAddress { buf.floatChannelData![0].update(from: base, count: samples.count) }
        }
        do { try file.write(from: buf); return true } catch { return false }
    }

    /// Convert an arbitrary PCM buffer to a flat 16 kHz mono float array.
    static func resample(_ input: AVAudioPCMBuffer, with converter: AVAudioConverter) -> [Float]? {
        let ratio = mono16k.sampleRate / input.format.sampleRate
        let outCapacity = AVAudioFrameCount(Double(input.frameLength) * ratio + 1024)
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: mono16k, frameCapacity: outCapacity) else { return nil }
        var fed = false
        var err: NSError?
        converter.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return input
        }
        if err != nil { return nil }
        guard let ch = outBuf.floatChannelData else { return nil }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(outBuf.frameLength)))
    }
}
