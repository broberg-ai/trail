// F201.6.1 verification — `TrailAmbient --audiotest [wav]`. Proves the parts of
// the audio path that DON'T need a mic grant or real sound: VAD segmentation on
// a synthesised buffer, the WAV encode→decode→VAD round-trip, and the deny-list
// predicate the live tap gates on. The live AVAudioEngine mic capture needs a
// TCC grant + real speech, so it's proven interactively; the risky logic (VAD +
// resample) is proven here, deterministic — the same split as F201.5's --ocrtest.
import Foundation

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
