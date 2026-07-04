// F201.6.1 verification — `TrailAmbient --audiotest [wav]`. Proves the parts of
// the audio path that DON'T need a mic grant or real sound: VAD segmentation on
// a synthesised buffer, the WAV encode→decode→VAD round-trip, and the deny-list
// predicate the live tap gates on. The live AVAudioEngine mic capture needs a
// TCC grant + real speech, so it's proven interactively; the risky logic (VAD +
// resample) is proven here, deterministic — the same split as F201.5's --ocrtest.
import Foundation
import AVFoundation

enum AudioTest {
    static func run() -> Never {
        var pass = 0, fail = 0
        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            print("\(ok ? "✓" : "✗") \(name)\(detail.isEmpty ? "" : "  — \(detail)")")
            ok ? (pass += 1) : (fail += 1)
        }

        let vad = VAD()
        let sr = 16_000

        // A canonical utterance: 1s silence · 2s tone · 1s silence.
        var buf = [Float](repeating: 0, count: sr)
        buf += tone(freq: 1000, seconds: 2.0, amp: 0.3, sr: sr)
        buf += [Float](repeating: 0, count: sr)

        // AC1 — VAD finds exactly the tone span, bounds within tolerance.
        let segs = vad.segments(buf)
        check("silence→tone→silence → exactly 1 segment", segs.count == 1, "got \(segs.count)")
        if let s = segs.first {
            let startOk = abs(s.startSeconds - 1.0) < 0.1        // tone starts at 1.0s
            let endOk = abs(s.endSeconds - 3.0) < 0.5            // + one hangover window
            check("segment bounds ≈ [1.0s, 3.0s]", startOk && endOk, "[\(fmt(s.startSeconds)), \(fmt(s.endSeconds))]")
        }
        check("pure silence → 0 segments", vad.segments([Float](repeating: 0, count: 3 * sr)).isEmpty)

        // AC1 — a 50 ms click below minSpeechMs is dropped (not emitted as speech).
        var click = [Float](repeating: 0, count: sr)
        click += tone(freq: 1000, seconds: 0.05, amp: 0.3, sr: sr)
        click += [Float](repeating: 0, count: sr)
        check("50ms click (< minSpeech) → dropped", vad.segments(click).isEmpty, "got \(vad.segments(click).count)")

        // AC2 — WAV round-trip: encode the buffer, decode it back, segment it.
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("audiotest-\(ProcessInfo.processInfo.processIdentifier).wav")
        let wrote = AudioWatcher.writeWav(buf, to: tmp)
        check("wrote temp WAV", wrote, tmp.lastPathComponent)
        if wrote {
            if let fileSegs = AudioWatcher.segments(fromFile: tmp.path) {
                check("decoded WAV → 1 segment (encode→decode→VAD)", fileSegs.count == 1, "got \(fileSegs.count)")
            } else {
                check("decoded WAV → 1 segment (encode→decode→VAD)", false, "decode failed")
            }
            try? FileManager.default.removeItem(at: tmp)
        }

        // AC3 — deny-list predicate (the same Settings.isDenyListed the live tap
        // gates on) matches a deny-listed app and passes a normal one.
        check("deny-list matches 1Password", Settings.isDenyListed("1Password"))
        check("deny-list passes a normal app", !Settings.isDenyListed("Google Chrome"))

        // AC4 (F201.6 crash regression) — AudioRecorder must accept the LIVE mic
        // tap format (24 kHz float32 mono — the exact format that trapped inside
        // Core Audio on 2026-07-04) and write a valid 16 kHz Int16 WAV WITHOUT
        // crashing. The old code converted to Int16 and wrote that to an
        // AVAudioFile whose processingFormat is Float32 → CAAssertRtn/SIGTRAP.
        // With the fix this converts to the file's write format and succeeds; a
        // regression would SIGTRAP this test binary and fail the gate.
        let recURL = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("audiorec-\(ProcessInfo.processInfo.processIdentifier).wav")
        if let rec = AudioRecorder(url: recURL),
           let micFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24_000, channels: 1, interleaved: false),
           let pcm = AVAudioPCMBuffer(pcmFormat: micFmt, frameCapacity: 12_000) {
            let samples = tone(freq: 440, seconds: 0.5, amp: 0.3, sr: 24_000)
            pcm.frameLength = AVAudioFrameCount(samples.count)
            samples.withUnsafeBufferPointer { src in
                pcm.floatChannelData![0].update(from: src.baseAddress!, count: samples.count)
            }
            for _ in 0..<4 { rec.append(pcm) }   // old Int16 write would SIGTRAP here
            let out = rec.finish()
            check("AudioRecorder: 24kHz float tap → WAV, no crash", out != nil, out == nil ? "no frames written" : "")
            if let out, let f = try? AVAudioFile(forReading: out) {
                let ok = f.length > 0 && f.fileFormat.sampleRate == 16_000
                check("AudioRecorder WAV = 16kHz Int16, frames>0", ok, "sr=\(Int(f.fileFormat.sampleRate)) len=\(f.length)")
            }
            try? FileManager.default.removeItem(at: recURL)
        } else {
            check("AudioRecorder: 24kHz float tap → WAV, no crash", false, "could not build recorder/buffer")
        }

        // AC2 (optional) — segment a real WAV passed after --audiotest.
        if let i = CommandLine.arguments.firstIndex(of: "--audiotest"),
           i + 1 < CommandLine.arguments.count, !CommandLine.arguments[i + 1].hasPrefix("-") {
            let path = CommandLine.arguments[i + 1]
            if let fileSegs = AudioWatcher.segments(fromFile: path) {
                print("AUDIOTEST file=\(path) segments=\(fileSegs.count)")
                for (n, s) in fileSegs.enumerated() {
                    print("  seg \(n): \(fmt(s.startSeconds))s → \(fmt(s.endSeconds))s (\(fmt(s.durationSeconds))s)")
                }
            } else {
                print("AUDIOTEST file=\(path) — could not decode")
            }
        }

        print("\nAUDIOTEST: \(pass)/\(pass + fail) checks passed")
        exit(fail == 0 ? 0 : 1)
    }

    private static func tone(freq: Double, seconds: Double, amp: Float, sr: Int) -> [Float] {
        let n = Int(seconds * Double(sr))
        return (0..<n).map { amp * Float(sin(2 * Double.pi * freq * Double($0) / Double(sr))) }
    }

    private static func fmt(_ d: Double) -> String { String(format: "%.2f", d) }
}
