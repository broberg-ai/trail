// F201.6 — records the live mic audio to a file during dictation, so the SAVED
// transcript is produced by BATCH transcription (WhisperKit, faithful over the
// whole clip) at stop instead of the lossy 45s-restart streaming recognizer
// (which dropped ~half of a real 2m49s dictation). Every tap buffer is converted
// to a fixed 16 kHz mono WAV, so an AirPods A2DP↔HFP format flip mid-dictation
// can't corrupt the single output file (WhisperKit wants 16 kHz mono anyway). The
// .wav is ALSO kept as the truest raw source — re-transcribable with a better
// model later (Christian 2026-07-03).
import AVFoundation

final class AudioRecorder {
    let url: URL
    private var file: AVAudioFile?
    private var converter: AVAudioConverter?
    private var converterInput: AVAudioFormat?
    private static let target = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!

    init?(url: URL) {
        self.url = url
        do { file = try AVAudioFile(forWriting: url, settings: Self.target.settings) }
        catch { return nil }
    }

    /// Append one tap buffer (any format), converting to the fixed target format.
    func append(_ buffer: AVAudioPCMBuffer) {
        guard let file, buffer.frameLength > 0 else { return }
        if buffer.format == Self.target {
            try? file.write(from: buffer)
            return
        }
        if converter == nil || converterInput != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: Self.target)
            converterInput = buffer.format
        }
        guard let converter else { return }
        let ratio = Self.target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: Self.target, frameCapacity: capacity) else { return }
        var supplied = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        if err == nil, out.frameLength > 0 { try? file.write(from: out) }
    }

    /// Close the file. Returns the URL only if audio was actually written.
    func finish() -> URL? {
        file = nil // closing the writer flushes the WAV header
        let frames = (try? AVAudioFile(forReading: url).length) ?? 0
        return frames > 0 ? url : nil
    }

    /// Directory for kept recordings (the durable raw audio).
    static func newRecordingURL() -> URL {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TrailAmbient/recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970)
        return dir.appendingPathComponent("dictation-\(stamp).wav")
    }
}
