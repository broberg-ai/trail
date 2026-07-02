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
}
