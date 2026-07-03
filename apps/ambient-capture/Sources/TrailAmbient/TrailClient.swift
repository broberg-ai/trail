// F201.9 — HUD network client. Read-only search + chat against the granted
// KB, using the ambient-scoped Keychain token (the scope gate on the engine
// permits exactly these two + candidate-write, nothing else). Everything is
// the user's OWN Trail — this is the "look it up mid-call" surface.
import Foundation

struct NeuronHit: Identifiable {
    let id: String          // documentId
    let title: String
    let path: String
    let filename: String
    let highlight: String
    var slug: String { filename.hasSuffix(".md") ? String(filename.dropLast(3)) : filename }
}

struct Citation: Identifiable {
    let id: String          // documentId
    let path: String
    let filename: String
    var slug: String { filename.hasSuffix(".md") ? String(filename.dropLast(3)) : filename }
}

struct ChatAnswer {
    let answer: String
    let citations: [Citation]
}

enum TrailClient {
    private static let engine = "https://engine-001.trailmem.com"
    private static let app = "https://app.trailmem.com"

    private static var token: String? { DeviceAuth.loadToken() }
    private static var kbId: String? {
        UserDefaults.standard.string(forKey: "trail.kbId")
            ?? (UserDefaults.standard.array(forKey: "trail.kbIds") as? [String])?.first
    }

    /// Admin deep-link for a Neuron slug (opens in the browser).
    static func neuronURL(slug: String) -> URL? {
        guard let kb = kbId else { return nil }
        let encoded = slug.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? slug
        return URL(string: "\(app)/kb/\(kb)/neurons/\(encoded)")
    }

    // MARK: Search (FTS5)

    static func search(_ query: String) async throws -> [NeuronHit] {
        guard let token, let kb = kbId,
              var comps = URLComponents(string: "\(engine)/api/v1/knowledge-bases/\(kb)/search") else { return [] }
        comps.queryItems = [.init(name: "q", value: query), .init(name: "limit", value: "12")]
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return [] }
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let docs = root?["documents"] as? [[String: Any]] ?? []
        return docs.compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            return NeuronHit(
                id: id,
                title: (d["title"] as? String) ?? (d["filename"] as? String) ?? "Neuron",
                path: (d["path"] as? String) ?? "",
                filename: (d["filename"] as? String) ?? "",
                highlight: (d["highlight"] as? String) ?? ""
            )
        }
    }

    // MARK: Chat (synthesised answer + citations)

    static func chat(_ message: String) async throws -> ChatAnswer {
        guard let token, let kb = kbId,
              let url = URL(string: "\(engine)/api/v1/chat") else {
            return ChatAnswer(answer: "Ikke forbundet til Trail.", citations: [])
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["message": message, "knowledgeBaseId": kb])
        let (data, resp) = try await URLSession.shared.data(for: req)
        let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            return ChatAnswer(answer: (root["error"] as? String) ?? "Kunne ikke hente svar.", citations: [])
        }
        let cites = (root["citations"] as? [[String: Any]] ?? []).compactMap { c -> Citation? in
            guard let id = c["documentId"] as? String else { return nil }
            return Citation(id: id, path: (c["path"] as? String) ?? "", filename: (c["filename"] as? String) ?? "")
        }
        return ChatAnswer(answer: (root["answer"] as? String) ?? "(tomt svar)", citations: cites)
    }

    // MARK: Save a voice note as a Trail candidate (F201.6.4)

    enum SaveResult { case saved, duplicate, failed }

    /// POST a finished voice transcript to the queue as an ambient candidate.
    /// Mirrors @trail/ambient-gate's body shape (kind `external-feed`, connector
    /// `trail-ambient-capture`) so it flows through the SAME engine pipeline:
    /// F197 secret-redaction (server-side in createCandidate), F201.11 distill
    /// (raw transcript → clean titled knowledge, or noise-filtered), and the
    /// F201.8/.12 auto-approval policy. The ambient-scoped token is allow-listed
    /// for exactly this endpoint (auth.ts AMBIENT_ALLOWED).
    static func saveNote(_ text: String) async -> SaveResult {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let token, let kb = kbId,
              let url = URL(string: "\(engine)/api/v1/queue/candidates") else { return .failed }
        let meta: [String: Any] = [
            "connector": "trail-ambient-capture",
            "source": "audio",
            "capturedAt": ISO8601DateFormatter().string(from: Date()),
        ]
        let metaStr = (try? JSONSerialization.data(withJSONObject: meta))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{\"connector\":\"trail-ambient-capture\"}"
        let body: [String: Any] = [
            "knowledgeBaseId": kb,
            "kind": "external-feed",
            "title": noteTitle(from: trimmed),
            "content": trimmed,
            "metadata": metaStr,
        ]
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (_, resp) = try? await URLSession.shared.data(for: req),
              let code = (resp as? HTTPURLResponse)?.statusCode else { return .failed }
        if code == 201 { return .saved }
        if code == 409 { return .duplicate }  // engine-side external-feed de-dup
        return .failed
    }

    // MARK: Save a capture as a first-class Source (F201.13 — source-first)

    /// POST a finished capture to the source-first ambient path. The engine stores
    /// the raw VERBATIM as a kind='source' document and (Phase 2) compiles it into a
    /// Neuron with provenance — the raw is never rewritten or lost. `source`
    /// distinguishes capture origin ("audio" = Extraction, "prompt" = Prompt-Mode
    /// dual-write) so prompt dictations are filterable.
    ///
    /// Falls back to the legacy candidate path on 404 (engine hasn't enabled the
    /// source path yet) when `allowFallback` — so a deliberate Extraction save is
    /// never lost across the server rollout (no naked cutover). Prompt dual-writes
    /// pass allowFallback:false: the words already reached the session via inject,
    /// so the Source is a bonus that simply lands once the engine is deployed.
    static func saveSource(
        fileType: String = "ambient-speech",
        content: String,
        rawTranscript: String? = nil,
        source: String = "audio",
        allowFallback: Bool = true
    ) async -> SaveResult {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let token, let kb = kbId,
              let url = URL(string: "\(engine)/api/v1/knowledge-bases/\(kb)/ambient-source") else { return .failed }
        var body: [String: Any] = ["fileType": fileType, "content": trimmed, "source": source]
        // Only carry the raw when a correction actually changed the words.
        if let rawTranscript, rawTranscript != trimmed { body["rawTranscript"] = rawTranscript }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (_, resp) = try? await URLSession.shared.data(for: req),
              let code = (resp as? HTTPURLResponse)?.statusCode else { return .failed }
        if code == 201 { return .saved }
        // Source path not enabled on the engine yet → legacy candidate path.
        if code == 404 && allowFallback { return await saveNote(trimmed) }
        return .failed
    }

    /// A readable fallback title = first sentence (to a period/newline), ≤80 chars.
    /// The engine's distill may replace it; this is what shows if it doesn't.
    private static func noteTitle(from text: String) -> String {
        let firstSentence = text.split(whereSeparator: { $0 == "." || $0 == "\n" || $0 == "?" || $0 == "!" })
            .first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? text
        let base = firstSentence.isEmpty ? text : firstSentence
        return base.count <= 80 ? base : String(base.prefix(79)) + "…"
    }
}
