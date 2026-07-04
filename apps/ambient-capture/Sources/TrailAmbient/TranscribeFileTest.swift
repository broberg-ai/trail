// F201.6 — `TrailAmbient --transcribefile <path>`. Batch-transcribe a whole audio
// file with WhisperKit (one pass, no 45s streaming-restart boundary loss) and
// PRINT the raw + ordbog-corrected text. This is the reusable test harness for the
// batch-at-stop rebuild: Christian records a known passage into a Voice Memo once,
// and this transcribes that same file again and again while we iterate — no
// re-recording. The output is diffed by eye/script against the known passage so
// "it's faithful" is a comparison, not a claim.
import Foundation

enum TranscribeFileTest {
    static func run() -> Never {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: "--transcribefile"), i + 1 < args.count else {
            print("usage: --transcribefile <path-to-audio>")
            exit(2)
        }
        let path = args[i + 1]
        guard FileManager.default.fileExists(atPath: path) else {
            print("TRANSCRIBE FAIL — no file at \(path)")
            exit(2)
        }
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        Task.detached {
            do {
                let t0 = Date()
                let raw = try await Whisper.shared.transcribe(path: path, language: "da")
                let ms = Int(Date().timeIntervalSince(t0) * 1000)
                let corrected = SpeechDictionary.applyCorrections(raw)
                print("TRANSCRIBE ms=\(ms) raw_chars=\(raw.count) model=\(Whisper.modelName)")
                print("\n--- RAW (WhisperKit) ---\n\(raw)")
                print("\n--- ORDBOG-CORRECTED ---\n\(corrected)")
                ok = !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            } catch {
                print("TRANSCRIBE FAIL: \(error)")
            }
            sem.signal()
        }
        sem.wait()
        exit(ok ? 0 : 1)
    }
}
