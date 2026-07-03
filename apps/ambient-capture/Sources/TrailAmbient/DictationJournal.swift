// F201.6.8 — the interim catch. The user's RAW spoken words, kept verbatim
// on-device BEFORE anything is sent to Trail.
//
// WHY (Christian, 2026-07-03): "Du burde have en interim catch af alt der bliver
// sagt INDEN du sender det til trail ellers er det en STOR fejl." Until now a
// dictation existed only downstream: TrailClient.saveNote → engine → F201.11
// distill REWROTE it into a bullet summary → the original words were gone
// ("men ikke det jeg sagde"). A failed POST, a distill rewrite, or a crash lost
// the raw speech entirely. Raw words must never depend on a lossy pipeline.
//
// Two files, both under ~/Library/Application Support/TrailAmbient/:
//   • dictations.jsonl        — append-only, one line per FINISHED dictation
//                               ({ts,text}). This is the durable verbatim record.
//   • dictations-inflight.txt — the live transcript, overwritten while speaking
//                               (throttled). If the app dies mid-sentence the
//                               partial survives here and is rolled into the
//                               journal on next launch (recoverInflight()).
import Foundation

enum DictationJournal {
    private static let dir: URL = {
        let d = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TrailAmbient", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static var journalURL: URL { dir.appendingPathComponent("dictations.jsonl") }
    private static var inflightURL: URL { dir.appendingPathComponent("dictations-inflight.txt") }

    private static var lastCheckpoint = Date.distantPast

    /// Append a finished transcript VERBATIM. Called the moment dictation stops,
    /// before TrailClient.saveNote — so the raw words are safe regardless of what
    /// the server pipeline does with them.
    static func append(_ text: String, recovered: Bool = false) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var obj: [String: Any] = ["ts": ISO8601DateFormatter().string(from: Date()), "text": trimmed]
        if recovered { obj["recovered"] = true }
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let json = String(data: data, encoding: .utf8) else { return }
        write(json + "\n", to: journalURL, append: true)
    }

    /// Overwrite the in-flight partial with the live transcript, throttled so a
    /// fast partial stream doesn't hammer the disk. Cheap crash insurance.
    static func checkpoint(_ text: String) {
        let now = Date()
        guard now.timeIntervalSince(lastCheckpoint) > 1.5 else { return }
        lastCheckpoint = now
        write(text, to: inflightURL, append: false)
    }

    /// Clean stop: the final was appended, so drop the partial.
    static func clearInflight() {
        lastCheckpoint = .distantPast
        try? FileManager.default.removeItem(at: inflightURL)
    }

    /// On launch, if a partial survived a crash, roll it into the journal as a
    /// recovered entry so no spoken words are ever lost.
    static func recoverInflight() {
        guard let text = try? String(contentsOf: inflightURL, encoding: .utf8),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        append(text, recovered: true)
        clearInflight()
    }

    private static func write(_ s: String, to url: URL, append: Bool) {
        if append, let h = try? FileHandle(forWritingTo: url) {
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: Data(s.utf8))
        } else {
            try? Data(s.utf8).write(to: url)
        }
    }
}
