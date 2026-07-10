// F201.6.6 — the owner's enrolled voice-print + the speaker gate. Persists ONLY
// the derived embedding (a non-invertible feature vector) locally under
// Application Support; never audio, never network — Trail's capture guarantee.
//
// Rollout is ship-dark: with no enrolled print the gate FAILS OPEN (drops
// nothing), so capture behaves exactly as today until the owner enrolls. Once
// enrolled, non-owner utterances are gated out before they become candidates.
import Foundation

/// The stored owner centroid + acceptance threshold.
struct VoicePrint: Codable {
    var embedding: [Float]     // averaged, L2-normalised owner centroid
    var sampleCount: Int       // how many enrolment utterances built it
    var threshold: Float       // cosine acceptance threshold (tunable)
    var updatedAt: String

    /// Conservative default: high enough to reject clearly-different voices,
    /// low enough not to reject the owner across normal day-to-day variation.
    /// Tuned with data (the F201.6.6 corpus) as evidence accrues.
    static let defaultThreshold: Float = 0.55
}

enum SpeakerGate {
    private static let dir: URL = {
        let d = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TrailAmbient", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    static var printURL: URL { dir.appendingPathComponent("voiceprint.json") }

    /// The enrolled print, or nil if the owner hasn't enrolled yet.
    static func loadPrint() -> VoicePrint? {
        guard let data = try? Data(contentsOf: printURL) else { return nil }
        return try? JSONDecoder().decode(VoicePrint.self, from: data)
    }

    static var isEnrolled: Bool { loadPrint() != nil }

    /// Remove the enrolled print (re-enroll from scratch / privacy reset).
    static func clear() { try? FileManager.default.removeItem(at: printURL) }

    /// Enroll (or re-enroll) from owner sample utterances (each a 16 kHz mono
    /// buffer). Averages their embeddings into an L2-normalised centroid and
    /// persists it. Returns the stored print, or nil if none of the samples had
    /// enough voiced audio to embed.
    @discardableResult
    static func enroll(fromSamples samples: [[Float]],
                       threshold: Float = VoicePrint.defaultThreshold) -> VoicePrint? {
        let embs = samples.compactMap { SpeakerEmbedding.embed($0) }
        guard let first = embs.first else { return nil }

        var centroid = [Float](repeating: 0, count: first.count)
        for e in embs { for i in 0..<centroid.count { centroid[i] += e[i] } }
        var norm: Float = 0
        for v in centroid { norm += v * v }
        norm = norm.squareRoot()
        if norm > 1e-9 { for i in 0..<centroid.count { centroid[i] /= norm } }

        let print = VoicePrint(embedding: centroid, sampleCount: embs.count,
                               threshold: threshold,
                               updatedAt: ISO8601DateFormatter().string(from: Date()))
        if let data = try? JSONEncoder().encode(print) { try? data.write(to: printURL) }
        return print
    }

    /// The gate. Is this utterance the owner? Fails OPEN (owner=true) when not
    /// enrolled yet or when the clip is too short to embed — so we never drop the
    /// owner's real speech on uncertainty; only a confident non-match is rejected.
    static func isOwner(_ samples: [Float]) -> (owner: Bool, similarity: Float) {
        guard let print = loadPrint() else { return (true, 1) }            // not enrolled → inert
        guard let emb = SpeakerEmbedding.embed(samples) else { return (true, 0) }  // too short → keep
        let sim = SpeakerEmbedding.cosine(emb, print.embedding)
        return (sim >= print.threshold, sim)
    }
}
