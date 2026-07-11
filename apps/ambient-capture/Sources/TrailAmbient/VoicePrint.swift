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

    /// Neural (WeSpeaker 256-d) cosine threshold. Measured on real audio: the
    /// owner scores ~0.93 same-recording, a different person ~0.01–0.09 — a huge
    /// margin, so 0.4 rejects non-owners with headroom while tolerating the
    /// owner's cross-session variation. Tunable per-print; sims are logged.
    static let defaultThreshold: Float = 0.4
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

    /// Enroll (or re-enroll) from a live owner recording (16 kHz mono). The
    /// neural embedder (NeuralSpeaker) windows + averages internally, so we pass
    /// the whole take. Returns the stored print, or nil if the models aren't
    /// available yet or there's too little speech.
    @discardableResult
    static func enroll(_ samples: [Float],
                       threshold: Float = VoicePrint.defaultThreshold) async -> VoicePrint? {
        guard let emb = await NeuralSpeaker.shared.embed(samples) else { return nil }
        let print = VoicePrint(embedding: emb, sampleCount: 1,
                               threshold: threshold,
                               updatedAt: ISO8601DateFormatter().string(from: Date()))
        if let data = try? JSONEncoder().encode(print) { try? data.write(to: printURL) }
        return print
    }

    /// The gate. Is this utterance the owner? Fails OPEN (owner=true) when not
    /// enrolled yet or when the clip can't be embedded — so we never drop the
    /// owner's real speech on uncertainty; only a confident non-match is rejected.
    static func isOwner(_ samples: [Float]) async -> (owner: Bool, similarity: Float) {
        guard let print = loadPrint() else { return (true, 1) }                       // not enrolled → inert
        guard let emb = await NeuralSpeaker.shared.embed(samples) else { return (true, 0) }  // no models/too short → keep
        let sim = NeuralSpeaker.similarity(emb, print.embedding)
        return (sim >= print.threshold, sim)
    }
}
