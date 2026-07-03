// F201.14 (step 3) — dictionary mining v1. Scans the RAW dictation corpus
// (DictationJournal, kept verbatim precisely so unknown mishearings survive) for
// tokens that look like garbled versions of a KNOWN canonical term but aren't in
// the ordbog yet, and reports them as candidate `wrong → right` pairs for Christian
// to approve. Deterministic, on-device, $0 — no LLM (the LLM-assisted v2 over the
// EU tier is the planned upgrade for hard multi-word phonetic cases).
//
// Heuristic: near-miss against terms[]. We KNOW the target vocabulary (cardmem,
// Trail, WhisperKit, …), so instead of guessing which random token is a mishearing
// (high noise), we look for n-grams (1–3 words) that are phonetically CLOSE to a
// canonical term but not equal to it. A phonetic collapse (Danish/English STT
// confusions: c→k, w→v, ph→f, …) + normalised Levenshtein catches "card mem" /
// "kortmem" → cardmem. A secondary section lists frequent unknown tokens (possible
// NEW terms/corrections the near-miss pass can't target).
//
// v1 = REPORT ONLY. Approval → writing the pair back to @broberg/speech-dictionary
// via the components edit-API is the deliberate next step (always Christian-approved).
import Foundation

enum MineTool {
    /// `--mine [corpus-path]` — mine the journal (or a given jsonl/txt file).
    static func run() -> Never {
        let args = CommandLine.arguments
        var path: String? = nil
        if let i = args.firstIndex(of: "--mine"), i + 1 < args.count, !args[i + 1].hasPrefix("-") {
            path = args[i + 1]
        }
        let url = path.map { URL(fileURLWithPath: $0) } ?? DictationJournal.journalURL
        print(report(for: loadCorpus(url), source: url.path))
        exit(0)
    }

    // MARK: Corpus

    /// One raw utterance per element. Accepts the journal's JSONL ({text:…}) or a
    /// plain-text file (one utterance per line) for testing.
    static func loadCorpus(_ url: URL) -> [String] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [] }
        return raw.split(separator: "\n").compactMap { line in
            let s = String(line).trimmingCharacters(in: .whitespaces)
            guard !s.isEmpty else { return nil }
            if s.hasPrefix("{"), let d = s.data(using: .utf8),
               let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let t = o["text"] as? String { return t }
            return s
        }
    }

    // MARK: Mining

    struct NearMiss { let observed: String; let suggested: String; let freq: Int; let score: Double }

    /// Small Danish function-word set — never a dev-term, so excluded from mining.
    static let stopwords: Set<String> = [
        "og", "i", "at", "det", "den", "der", "som", "en", "et", "på", "til", "med",
        "for", "er", "jeg", "du", "vi", "han", "hun", "de", "skal", "kan", "så", "nu",
        "men", "af", "om", "har", "vil", "ikke", "være", "bare", "lige", "også", "her",
        "hvad", "hvem", "hvor", "hvordan", "ind", "ud", "op", "ned", "kom", "kunne",
        "vandringsmanden", "nordenvinden",
    ]

    static func mine(_ lines: [String]) -> (near: [NearMiss], unknown: [(String, Int)]) {
        let terms = SpeechDictionaryData.terms
        let termsLower = Set(terms.map { $0.lowercased() })
        let knownWrongs = Set(SpeechDictionaryData.corrections.map { $0.0.lowercased() })

        var unknownFreq: [String: Int] = [:]
        var best: [String: (suggested: String, score: Double, freq: Int)] = [:]

        for line in lines {
            let toks = tokenize(line)
            // Unigram frequency of unknown, term-length tokens (possible new terms).
            for t in toks where t.count >= 4 && !stopwords.contains(t)
                && !termsLower.contains(t) && !knownWrongs.contains(t) {
                unknownFreq[t, default: 0] += 1
            }
            // Near-miss: 1–3 word grams close to a canonical term.
            for n in 1...3 where toks.count >= n {
                for i in 0...(toks.count - n) {
                    let gram = Array(toks[i..<i + n])
                    let observed = gram.joined(separator: " ")
                    let collapsed = collapse(gram.joined())
                    guard collapsed.count >= 4,
                          !termsLower.contains(observed),        // already the correct token
                          !knownWrongs.contains(observed) else { continue }   // already handled
                    if n == 1 && stopwords.contains(gram[0]) { continue }
                    guard let (term, score) = bestMatch(collapsed, terms: terms), score <= 0.34 else { continue }
                    if let ex = best[observed] {
                        best[observed] = (score < ex.score ? term : ex.suggested,
                                          min(score, ex.score), ex.freq + 1)
                    } else {
                        best[observed] = (term, score, 1)
                    }
                }
            }
        }

        var near: [NearMiss] = []
        for (observed, v) in best {
            // Drop non-corrections (observed already equals the suggested term).
            if collapse(observed) == collapse(v.suggested)
                && observed.lowercased() == v.suggested.lowercased() { continue }
            near.append(NearMiss(observed: observed, suggested: v.suggested, freq: v.freq, score: v.score))
        }
        near.sort { lhs, rhs in
            lhs.score != rhs.score ? lhs.score < rhs.score : lhs.freq > rhs.freq
        }
        var unknown: [(String, Int)] = []
        for (t, f) in unknownFreq where f >= 2 { unknown.append((t, f)) }
        unknown.sort { $0.1 > $1.1 }
        return (near, unknown)
    }

    static func report(for lines: [String], source: String) -> String {
        let (near, unknown) = mine(lines)
        var out = "MINE corpus=\(source) utterances=\(lines.count)\n"
        out += "--- Near-miss candidates (observed → suggested term) ---\n"
        if near.isEmpty { out += "  (none)\n" }
        for c in near {
            out += String(format: "  \"%@\" → %@  (freq %d, score %.2f)\n", c.observed, c.suggested, c.freq, c.score)
        }
        out += "--- Frequent unknown tokens (freq ≥ 2, not in ordbog/terms) ---\n"
        if unknown.isEmpty { out += "  (none)\n" }
        for (t, f) in unknown { out += "  \(t)  ×\(f)\n" }
        out += "MINE done: \(near.count) near-miss, \(unknown.count) frequent-unknown\n"
        return out
    }

    // MARK: Tokenise + phonetics

    /// Lowercase words, punctuation stripped. Keeps Danish letters + hyphens.
    static func tokenize(_ text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzæøå0123456789-").inverted)
            .filter { !$0.isEmpty }
    }

    /// Phonetic skeleton: apply the STT confusions Danish speech makes for English
    /// dev terms, so "kortmem"/"card mem" and "cardmem" reduce to the same form.
    static func collapse(_ s: String) -> String {
        var t = s.lowercased()
        let subs: [(String, String)] = [
            ("ph", "f"), ("qu", "kv"), ("ck", "k"), ("x", "ks"), ("w", "v"),
            ("c", "k"), ("z", "s"), ("é", "e"), ("å", "o"), ("ø", "o"), ("æ", "e"),
        ]
        for (a, b) in subs { t = t.replacingOccurrences(of: a, with: b) }
        // Collapse doubled letters (committe → komite-ish parity both sides).
        var out = ""
        var prev: Character? = nil
        for ch in t where ch != " " { if ch != prev { out.append(ch) }; prev = ch }
        return out
    }

    /// Best canonical term for a collapsed candidate: min normalised Levenshtein.
    static func bestMatch(_ collapsed: String, terms: [String]) -> (String, Double)? {
        var bestTerm: String? = nil
        var bestScore = Double.greatestFiniteMagnitude
        for term in terms {
            let ct = collapse(term)
            guard !ct.isEmpty else { continue }
            let d = Double(levenshtein(collapsed, ct)) / Double(max(collapsed.count, ct.count))
            if d < bestScore { bestScore = d; bestTerm = term }
        }
        return bestTerm.map { ($0, bestScore) }
    }

    static func levenshtein(_ a: String, _ b: String) -> Int {
        let x = Array(a), y = Array(b)
        if x.isEmpty { return y.count }
        if y.isEmpty { return x.count }
        var prev = Array(0...y.count)
        var cur = [Int](repeating: 0, count: y.count + 1)
        for i in 1...x.count {
            cur[0] = i
            for j in 1...y.count {
                cur[j] = x[i - 1] == y[j - 1]
                    ? prev[j - 1]
                    : min(prev[j - 1], prev[j], cur[j - 1]) + 1
            }
            swap(&prev, &cur)
        }
        return prev[y.count]
    }

    // MARK: --minetest (gate) — prove the heuristic on a synthetic corpus.

    static func runTest() -> Never {
        // Known mishearings of a canonical term (cardmem) + clean control words.
        let corpus = [
            "vi skal have kortmem med i planen",       // kortmem → cardmem (near-miss)
            "det er card mem der driver boardet",      // card mem → cardmem (split)
            "jeg skal committe koden nu og reviewe",   // clean: no false positive
            "kortmem er nede igen",                    // kortmem again → freq 2
        ]
        let (near, _) = mine(corpus)
        var pass = true
        func expect(_ cond: Bool, _ msg: String) {
            print("\(cond ? "✓" : "✗") \(msg)"); if !cond { pass = false }
        }
        let toCardmem = near.filter { $0.suggested.lowercased() == "cardmem" }.map { $0.observed }
        expect(toCardmem.contains("kortmem"), "kortmem → cardmem surfaced (\(toCardmem))")
        expect(toCardmem.contains("card mem"), "\"card mem\" → cardmem surfaced")
        // No false positive: a clean dev sentence's words must not be flagged.
        let falsePos = near.filter { ["committe", "koden", "reviewe", "planen", "boardet"].contains($0.observed) }
        expect(falsePos.isEmpty, "no false positives on clean words (\(falsePos.map { $0.observed }))")
        print(pass ? "MINETEST PASS" : "MINETEST FAIL")
        exit(pass ? 0 : 1)
    }
}
