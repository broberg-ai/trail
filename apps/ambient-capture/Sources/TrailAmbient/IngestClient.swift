// F263.7 — netværkslaget bag Ingest-vinduet.
//
// Læser og skriver med den AMBIENT-scopede Keychain-nøgle, ad de fem ruter der
// blev åbnet for enheden i F263.7 (se AMBIENT_ALLOWED i
// apps/server/src/middleware/auth.ts). Ikke én rute mere: fladen kan liste
// videnbaser og kilder, lægge en fil op og spørge hvem der kompilerer —
// og ikke røre indstillinger, nøgler, brugere eller sletning.
//
// SVARET SKAL VÆRE ET SVAR. Hver funktion returnerer et Result med en
// læsbar fejl frem for at give tom liste ved fejl: en tom kildeliste og en
// mislykket forespørgsel ser ens ud på skærmen, og kun den ene er en god
// nyhed. Det er den fejlform hele huset er blevet ramt af i denne uge.
import Foundation

/// En kilde som Ingest-fladen viser den.
struct IngestSource: Identifiable, Equatable {
    let id: String
    let filename: String
    let title: String?
    let fileType: String
    let status: String
    let awaitingLocalCompile: Bool
    let neuronCount: Int
    let pageCount: Int?
    let errorMessage: String?

    var visningsnavn: String { title ?? filename }

    /// Kø eller Færdig — samme skel som web-fladen bruger.
    var erIKoe: Bool { awaitingLocalCompile || status == "processing" || status == "pending" }
    var erFejlet: Bool { status == "failed" }
}

/// Hvad motoren svarer om hvem der arbejder lige nu.
struct CompileStatus: Equatable {
    let waiting: Int
    let working: Int
    let workers: [String]
    static let tom = CompileStatus(waiting: 0, working: 0, workers: [])
}

struct KnowledgeBaseRef: Identifiable, Equatable {
    let id: String
    let slug: String
    let name: String
}

enum IngestError: LocalizedError {
    case ikkeForbundet
    case http(Int, String)
    case netvaerk(String)
    case uventetSvar

    var errorDescription: String? {
        switch self {
        case .ikkeForbundet:      return S.ingestNotConnected
        case .http(403, _):       return S.ingestForbidden
        case .http(let c, let b): return "\(S.ingestServerError) (\(c)) \(b)"
        case .netvaerk(let m):    return "\(S.ingestNetworkError) \(m)"
        case .uventetSvar:        return S.ingestUnexpected
        }
    }
}

enum IngestClient {
    private static let engine = "https://engine-001.trailmem.com"
    private static var token: String? { DeviceAuth.loadToken() }

    private static func request(_ path: String, method: String = "GET", token brug: String? = nil) throws -> URLRequest {
        guard let token = brug ?? token else { throw IngestError.ikkeForbundet }
        guard let url = URL(string: engine + path) else { throw IngestError.uventetSvar }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return r
    }

    private static func send(_ req: URLRequest) async throws -> Data {
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) }
        catch { throw IngestError.netvaerk(error.localizedDescription) }
        guard let http = resp as? HTTPURLResponse else { throw IngestError.uventetSvar }
        guard (200..<300).contains(http.statusCode) else {
            let krop = String(data: data, encoding: .utf8) ?? ""
            throw IngestError.http(http.statusCode, String(krop.prefix(200)))
        }
        return data
    }

    // MARK: - Læs

    static func knowledgeBases() async throws -> [KnowledgeBaseRef] {
        let data = try await send(try request("/api/v1/knowledge-bases"))
        guard let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { throw IngestError.uventetSvar }
        return rows.compactMap { r in
            guard let id = r["id"] as? String else { return nil }
            return KnowledgeBaseRef(
                id: id,
                slug: r["slug"] as? String ?? id,
                name: r["name"] as? String ?? (r["slug"] as? String ?? id)
            )
        }
    }

    static func sources(kbId: String) async throws -> [IngestSource] {
        let sti = "/api/v1/knowledge-bases/\(enc(kbId))/documents?kind=source&limit=200"
        let data = try await send(try request(sti))
        guard let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        else { throw IngestError.uventetSvar }
        return rows.compactMap(parseSource)
    }

    static func status() async throws -> CompileStatus {
        let data = try await send(try request("/api/v1/compile-jobs/status"))
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw IngestError.uventetSvar }
        return CompileStatus(
            waiting: o["waiting"] as? Int ?? 0,
            working: o["working"] as? Int ?? 0,
            workers: o["workers"] as? [String] ?? []
        )
    }

    /// F263.8 — «hvilken konto tilhører denne nøgle?».
    static func whoami(token: String) async throws -> (slug: String, name: String) {
        let data = try await send(try request("/api/v1/ambient/whoami", token: token))
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let slug = o["slug"] as? String, !slug.isEmpty
        else { throw IngestError.uventetSvar }
        return (slug, o["name"] as? String ?? slug)
    }

    /// Retter en konto der blev gemt under sit NAVN i stedet for sin slug.
    ///
    /// Parringen leverede kun navnet indtil i dag, så en allerede parret Mac
    /// bærer «Broberg.ai» hvor buddys jobs hedder «broberg-ai» — enhver
    /// «der ligger arbejde nu»-besked bar det forkerte navn, og 120-sekunders
    /// proben dækkede over det. Uden den her skulle man parre om for at rette
    /// noget man ikke kan se er galt.
    ///
    /// Fejler kaldet, laves der INGENTING. En reparation der gætter er værre
    /// end den forkerte værdi, for så kan man ikke se hvad der skete.
    @discardableResult
    static func repareerKontoSlugs() async -> Int {
        var rettet = 0
        for konto in TenantStore.kontoer {
            guard let t = TenantStore.token(for: konto.slug) else { continue }
            guard let svar = try? await whoami(token: t) else { continue }
            guard svar.slug != konto.slug else { continue }
            let varAktiv = TenantStore.aktivSlug == konto.slug
            TenantStore.fjern(slug: konto.slug)
            TenantStore.gem(
                slug: svar.slug, token: t, name: svar.name,
                deviceName: konto.deviceName, email: konto.email,
                kbIds: konto.kbIds, kbNames: konto.kbNames
            )
            if varAktiv { TenantStore.aktivSlug = svar.slug }
            rettet += 1
        }
        return rettet
    }

    // MARK: - Skriv

    /// Læg en fil op og PARKÉR den til lokal kompilering (`localCompile=true`),
    /// præcis som web-fladen gør. Uden den parameter ville kilden blive
    /// kompileret i skyen for penge — så den er ikke valgfri her.
    static func upload(kbId: String, fileURL: URL) async throws -> String {
        let sti = "/api/v1/knowledge-bases/\(enc(kbId))/documents/upload?localCompile=true"
        var req = try request(sti, method: "POST")
        let graense = "Boundary-\(UUID().uuidString)"
        req.setValue("multipart/form-data; boundary=\(graense)", forHTTPHeaderField: "Content-Type")

        let navn = fileURL.lastPathComponent
        let indhold: Data
        do { indhold = try Data(contentsOf: fileURL) }
        catch { throw IngestError.netvaerk(error.localizedDescription) }

        var krop = Data()
        krop.append("--\(graense)\r\n".data(using: .utf8)!)
        krop.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(navn)\"\r\n".data(using: .utf8)!)
        krop.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        krop.append(indhold)
        krop.append("\r\n--\(graense)--\r\n".data(using: .utf8)!)
        req.httpBody = krop

        let data = try await send(req)
        guard let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = o["id"] as? String else { throw IngestError.uventetSvar }
        return id
    }

    // MARK: -

    private static func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private static func parseSource(_ r: [String: Any]) -> IngestSource? {
        guard let id = r["id"] as? String else { return nil }
        // `awaitingLocalCompile` kommer som 0/1 fra SQLite gennem Drizzles
        // boolean-mode; tag imod begge former frem for at antage den ene.
        let venter: Bool
        if let b = r["awaitingLocalCompile"] as? Bool { venter = b }
        else if let n = r["awaitingLocalCompile"] as? Int { venter = n == 1 }
        else { venter = false }
        return IngestSource(
            id: id,
            filename: r["filename"] as? String ?? id,
            title: r["title"] as? String,
            fileType: r["fileType"] as? String ?? "",
            status: r["status"] as? String ?? "",
            awaitingLocalCompile: venter,
            neuronCount: r["neuronCount"] as? Int ?? 0,
            pageCount: r["pageCount"] as? Int,
            errorMessage: r["errorMessage"] as? String
        )
    }
}
