// F201.6.2 verification — `TrailAmbient --sttest [clip] [expectedWord]`. Proves
// on-device Danish STT WITHOUT a live mic: macOS' own Danish voice (`say -v
// Sara`) generates a known Danish sentence → WhisperKit transcribes it → we
// assert the expected Danish word is present. This settles the WhisperKit-vs-
// Apple Danish-quality question with evidence, not assertion.
//
// NOT in the offline test.sh gate — it downloads the model on first run (needs
// network once) and is heavier than the gate should be. Run manually to prove.
import Foundation

enum SttTest {
    static func run() -> Never {
        let args = CommandLine.arguments
        var clip: String? = nil
        var expected = "dansk"
        if let i = args.firstIndex(of: "--sttest") {
            if i + 1 < args.count, !args[i + 1].hasPrefix("-") { clip = args[i + 1] }
            if i + 2 < args.count, !args[i + 2].hasPrefix("-") { expected = args[i + 2] }
        }
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        Task.detached {
            ok = await evaluate(clip: clip, expected: expected)
            sem.signal()
        }
        sem.wait()
        exit(ok ? 0 : 1)
    }

    private static func evaluate(clip: String?, expected: String) async -> Bool {
        let phrase = "Vi vælger WhisperKit fordi den er markant bedre til dansk transskription."
        let path: String
        var tempToClean: String? = nil
        if let clip {
            path = clip
        } else {
            let tmp = NSTemporaryDirectory() + "sttest-\(ProcessInfo.processInfo.processIdentifier).aiff"
            guard say(phrase, voice: "Sara", to: tmp) else {
                print("STTEST FAIL — `say -v Sara` could not generate the Danish clip")
                return false
            }
            path = tmp
            tempToClean = tmp
        }
        defer { if let t = tempToClean { try? FileManager.default.removeItem(atPath: t) } }
        do {
            let t0 = Date()
            let text = try await Whisper.shared.transcribe(path: path, language: "da")
            let ms = Int(Date().timeIntervalSince(t0) * 1000)
            let hit = text.lowercased().contains(expected.lowercased())
            print("STTEST source_phrase=\"\(phrase)\"")
            print("STTEST transcript=\"\(text)\"")
            print("STTEST expected_word=\"\(expected)\" hit=\(hit) transcribe_ms=\(ms) model=\(Whisper.modelName)")
            print(hit ? "STTEST PASS" : "STTEST FAIL")
            return hit
        } catch {
            print("STTEST FAIL — \(error.localizedDescription)")
            return false
        }
    }

    /// Generate speech with a named macOS voice to an audio file.
    private static func say(_ text: String, voice: String, to path: String) -> Bool {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        p.arguments = ["-v", voice, "-o", path, text]
        do { try p.run(); p.waitUntilExit(); return p.terminationStatus == 0 }
        catch { return false }
    }
}
