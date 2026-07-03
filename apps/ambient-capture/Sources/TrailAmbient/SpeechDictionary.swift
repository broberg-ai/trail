// F201.14 — the Swift side of the shared speech dictionary. The DATA lives in
// SpeechDictionaryData.swift (generated from @broberg/speech-dictionary via
// scripts/gen-dictionary.sh); this file is the ENGINE — a byte-parity port of the
// package's applyCorrections(), so the app and the server (@trail/shared) correct
// identically.
//
// Parity with the npm impl (makeApplyCorrections):
//  1. sort corrections by `wrong` length DESC (longest match wins),
//  2. whole-word, Unicode-aware boundary: (?<![\p{L}\p{N}_]) … (?![\p{L}\p{N}_]),
//  3. case-INSENSITIVE match, replacement is the `right` value verbatim,
//  4. apply sequentially over the list.
//
// A correction RESTORES what the user really said (Apple merely misheard) — it is
// deterministic, no LLM, so it runs live on every streaming partial.
import Foundation

enum SpeechDictionary {
    private struct Rule { let regex: NSRegularExpression; let template: String }

    /// Compiled once. Longest `wrong` first — parity with the package's sort.
    private static let rules: [Rule] = SpeechDictionaryData.corrections
        .sorted { $0.0.count > $1.0.count }
        .compactMap { (wrong, right) in
            let escaped = NSRegularExpression.escapedPattern(for: wrong)
            let pattern = "(?<![\\p{L}\\p{N}_])\(escaped)(?![\\p{L}\\p{N}_])"
            guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
            return Rule(regex: re, template: NSRegularExpression.escapedTemplate(for: right))
        }

    /// Restore dev/domain terms the STT misheard. Whole-word, case-insensitive,
    /// longest-first — same result the engine produces from the same dictionary.
    static func applyCorrections(_ text: String) -> String {
        var result = text
        for rule in rules {
            let range = NSRange(result.startIndex..., in: result)
            result = rule.regex.stringByReplacingMatches(in: result, options: [], range: range, withTemplate: rule.template)
        }
        return result
    }

    /// Canonical names fed to SFSpeechAudioBufferRecognitionRequest.contextualStrings
    /// — biases the recogniser toward them BEFORE it mishears (pre-STT layer, the
    /// Apple equivalent of WhisperKit's initialPrompt).
    static var contextualStrings: [String] { SpeechDictionaryData.terms }
}
