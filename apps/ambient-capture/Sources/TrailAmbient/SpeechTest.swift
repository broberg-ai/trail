// F201.6.7 verification — `TrailAmbient --speechtest [clip] [expectedWord]`. The
// Apple-STT twin of --sttest: proves on-device Danish recognition through the
// SAME engine the HUD now uses (SFSpeechRecognizer, da-DK) WITHOUT a live mic.
// macOS' own Danish voice (`say -v Sara`) generates a known sentence →
// AppleSpeech.transcribeFile transcribes it on-device → we assert the expected
// Danish word is present. Evidence that the streaming path recognises Danish,
// not assertion.
//
// NOT in the offline test.sh gate — SFSpeechRecognizer's on-device model may
// download on first use for a locale (needs network once). Run manually to prove.
import Foundation
import Speech

enum SpeechTest {
    static func run() -> Never {
        let args = CommandLine.arguments
        var clip: String? = nil
        var expected = "dansk"
        if let i = args.firstIndex(of: "--speechtest") {
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
        // SFSpeechURLRecognitionRequest wants a real container; `say -o … .aiff`
        // gives one macOS reads natively.
        let phrase = "Vi bruger Apples talegenkendelse fordi den skriver dansk tekst mens man taler."
        let path: String
        var tempToClean: String? = nil
        if let clip {
            path = clip
        } else {
            let tmp = NSTemporaryDirectory() + "speechtest-\(ProcessInfo.processInfo.processIdentifier).aiff"
            guard say(phrase, voice: "Sara", to: tmp) else {
                print("SPEECHTEST FAIL — `say -v Sara` could not generate the Danish clip")
                return false
            }
            path = tmp
            tempToClean = tmp
        }
        defer { if let t = tempToClean { try? FileManager.default.removeItem(atPath: t) } }

        // Authorization: --speechtest is interactive-once (the first run prompts
        // for Speech Recognition; the grant sticks after). Report clearly if not
        // yet authorized rather than silently failing.
        let authed = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
        }
        guard authed else {
            print("SPEECHTEST FAIL — Speech Recognition not authorized (grant it once, then re-run)")
            return false
        }

        let t0 = Date()
        guard let text = await AppleSpeech.transcribeFile(path: path, locale: "da-DK") else {
            print("SPEECHTEST FAIL — recognizer returned no result (on-device da-DK model may need one online run to download)")
            return false
        }
        let ms = Int(Date().timeIntervalSince(t0) * 1000)
        let hit = text.lowercased().contains(expected.lowercased())
        print("SPEECHTEST source_phrase=\"\(phrase)\"")
        print("SPEECHTEST transcript=\"\(text)\"")
        print("SPEECHTEST expected_word=\"\(expected)\" hit=\(hit) transcribe_ms=\(ms) engine=SFSpeechRecognizer/da-DK")
        print(hit ? "SPEECHTEST PASS" : "SPEECHTEST FAIL")
        return hit
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
