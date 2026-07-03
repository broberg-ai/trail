// F201.14 verification — `TrailAmbient --dicttest`. Headless, deterministic, no
// network: proves the Swift port of applyCorrections restores known mishearings,
// respects whole-word boundaries, and exposes the biasing terms. In the offline
// test.sh gate (unlike --speechtest, which needs a one-time model download), so a
// broken correction regex fails the build instead of shipping silently.
import Foundation

enum DictTest {
    static func run() -> Never {
        var pass = true
        func check(_ input: String, contains marker: String) {
            let out = SpeechDictionary.applyCorrections(input)
            let ok = out.contains(marker)
            print("\(ok ? "✓" : "✗") \"\(input)\" → \"\(out)\"  (contains \"\(marker)\")")
            if !ok { pass = false }
        }
        func unchanged(_ input: String) {
            let out = SpeechDictionary.applyCorrections(input)
            let ok = out == input
            print("\(ok ? "✓" : "✗") \"\(input)\" → \"\(out)\"  (whole-word: unchanged)")
            if !ok { pass = false }
        }

        // Known corrections restore the true word (case-insensitive).
        check("kartmem", contains: "cardmem")
        check("Karkmænd kører", contains: "cardmem")
        check("vi skal kommit koden", contains: "commit")
        check("puste til remote", contains: "pushe")
        check("vi bruger si-si-di", contains: "CI/CD")
        // Whole-word: a longer word that merely CONTAINS a wrong-key is untouched
        // ("polle" → "poll" must NOT fire inside "pollen").
        unchanged("pollen er gul i haven")

        // contextualStrings biasing terms are present.
        let terms = SpeechDictionary.contextualStrings
        let termsOK = terms.count >= 30 && terms.contains("cardmem")
        print("\(termsOK ? "✓" : "✗") contextualStrings: \(terms.count) terms, cardmem present=\(terms.contains("cardmem"))")
        if !termsOK { pass = false }

        print(pass ? "DICTTEST PASS" : "DICTTEST FAIL")
        exit(pass ? 0 : 1)
    }
}
