// F201.6 — records the live mic audio to a file during dictation, so the SAVED
// transcript is produced by BATCH transcription (WhisperKit, faithful over the
// whole clip) at stop instead of the lossy 45s-restart streaming recognizer
// (which dropped ~half of a real 2m49s dictation). The .wav is ALSO kept as the
// truest raw source — re-transcribable with a better model later (Christian
// 2026-07-03).
//
// The file is written as 16 kHz mono Int16 ON DISK (what WhisperKit wants). But
// AVAudioFile.write(from:) expects buffers in the file's *processingFormat* —
// which AVAudioFile makes Float32, NOT the on-disk Int16. Writing an Int16
// buffer traps inside Core Audio (CAAssertRtn → SIGTRAP → app crash, seen
// 2026-07-04). So every tap buffer is converted to `file.processingFormat`
// (Float32 16 kHz mono) and written; the file converts float→Int16 on disk. The
// converter also absorbs an AirPods A2DP↔HFP sample-rate flip mid-dictation.
import AVFoundation

final class AudioRecorder {
    let url: URL
    private var file: AVAudioFile?
    private var converter: AVAudioConverter?
    private var converterInput: AVAudioFormat?
    /// The format AVAudioFile.write(from:) requires — Float32 at the file's
    /// sample rate/channels, NOT the on-disk Int16. Read from the created file.
    private var writeFormat: AVAudioFormat?

    init?(url: URL) {
        self.url = url
        // 16 kHz mono Int16 on disk (WhisperKit-friendly).
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ]
        guard let f = try? AVAudioFile(forWriting: url, settings: settings) else { return nil }
        file = f
        writeFormat = f.processingFormat
    }

    /// Append one tap buffer (any format), converting to the file's write format.
    func append(_ buffer: AVAudioPCMBuffer) {
        guard let file, let writeFormat, buffer.frameLength > 0 else { return }
        if buffer.format == writeFormat {
            try? file.write(from: buffer)
            return
        }
        if converter == nil || converterInput != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: writeFormat)
            converterInput = buffer.format
        }
        guard let converter else { return }
        let ratio = writeFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let out = AVAudioPCMBuffer(pcmFormat: writeFormat, frameCapacity: capacity) else { return }
        var supplied = false
        var err: NSError?
        let status = converter.convert(to: out, error: &err) { _, s in
            if supplied { s.pointee = .noDataNow; return nil }
            supplied = true
            s.pointee = .haveData
            return buffer
        }
        if status != .error, err == nil, out.frameLength > 0 { try? file.write(from: out) }
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
