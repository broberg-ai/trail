// F263.3 — motor-kontakten. LÆSER buddys tilstand, holder ikke sin egen.
//
// INGEN AppKit-import her, med vilje (kortets krav): løkken taler kun HTTP, så
// nøjagtig samme adfærd senere kan køre på en maskine uden skærm.
//
// AMBIENT KOMPILERER IKKE. Den beder buddy om at sende «/local-ingest <kunde>»
// til en ÆGTE interaktiv Max-session, som selv claimer fra køen (F263.1) og
// kompilerer. Det er kæden der allerede har kørt otte kilder på to dage —
// Ambient overtager kun rollen som den der opdager arbejdet med det samme.
//
// `claude -p` findes ikke i denne fil og må aldrig komme til det: den vej
// afregnes mod API-et og ville gøre den «gratis lokale motor» til den dyre med
// et lokalt ansigt på. Spærret af scripts/guard-no-metered-claude.sh.
//
// KONTAKTEN ER BUDDYS, IKKE VORES. Vi kunne have gemt et flag i UserDefaults og
// vist det. Så ville der være TO steder der afgør om Macen tager arbejde, og de
// ville drive fra hinanden første gang nogen slog jobbet fra i buddys dashboard.
// buddy foreslog selv den her retning: «at Ambient LÆSER enabled og viser den,
// i stedet for at holde sin egen. Så er vinduet en visning af sandheden frem
// for en anden kopi af den.»
import Foundation

/// Fejl fra dæmonen, med en tekst fladen kan vise ordret.
struct EngineError: LocalizedError {
    let tekst: String
    var errorDescription: String? { tekst }
}

/// Ét af buddys dispatch-jobs, som det ser ud lige nu.
struct DispatchJob: Identifiable, Equatable {
    let id: String
    let command: String
    let targetSession: String
    let enabled: Bool
    let nextRunAt: Date?
}

/// Motorens tilstand som fladen viser den.
enum EngineState: Equatable {
    case til(naeste: Date?)     // alle local-ingest-jobs kører
    case fra                    // alle slået fra
    case blandet(til: Int, af: Int)   // NOGLE slået fra — vis det, vælg ikke ét
    case ukendt(String)         // dæmonen svarede ikke; sig det frem for at gætte
}

extension EngineState {
    /// Hent tilstanden. Ligger på typen så viewet ikke skal kende EngineControl.
    static func hent() async -> EngineState { await EngineControl.state() }
}

enum EngineControl {
    private static let daemon = "http://127.0.0.1:4123"

    /// De jobs der driver den lokale kompilering. MÅLT 7/9: der er TO, ikke ét
    /// — én pr. kunde (broberg-ai og sanne-andersen). En kontakt der kun tog
    /// det første ville melde «slået fra» mens den anden kunde stadig blev
    /// kompileret. Derfor behandles de som én gruppe.
    private static func erLokalIngest(_ j: DispatchJob) -> Bool {
        j.command.hasPrefix("/local-ingest")
    }

    private static func request(_ sti: String, method: String = "GET", body: [String: Any]? = nil) -> URLRequest? {
        guard let url = URL(string: daemon + sti) else { return nil }
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.timeoutInterval = 5
        // Dæmonen kræver denne header på sine lokale ruter.
        r.setValue("dashboard", forHTTPHeaderField: "x-buddy-origin")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return r
    }

    static func jobs() async -> Result<[DispatchJob], EngineError> {
        guard let req = request("/api/dispatch/jobs") else { return .failure(EngineError(tekst: "ugyldig adresse")) }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) }
        catch {
            // Den RIGTIGE fejl med, ikke kun vores egen overskrift. «buddy
            // kører ikke» og «systemet blokerede forbindelsen» er to helt
            // forskellige problemer, og de så ens ud indtil den her linje.
            return .failure(EngineError(tekst: "\(S.engineDaemonUnreachable): \(error.localizedDescription)"))
        }
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = root["jobs"] as? [[String: Any]] else {
            return .failure(EngineError(tekst: S.engineDaemonUnexpected))
        }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let iso2 = ISO8601DateFormatter()
        return .success(rows.compactMap { r in
            guard let id = r["id"] as? String else { return nil }
            let naeste = (r["nextRunAt"] as? String).flatMap { iso.date(from: $0) ?? iso2.date(from: $0) }
            return DispatchJob(
                id: id,
                command: r["command"] as? String ?? "",
                targetSession: r["targetSession"] as? String ?? "",
                enabled: (r["enabled"] as? Bool) ?? ((r["enabled"] as? Int) == 1),
                nextRunAt: naeste
            )
        })
    }

    static func state() async -> EngineState {
        switch await jobs() {
        case .failure(let f): return .ukendt(f.tekst)
        case .success(let alle):
            let vores = alle.filter(erLokalIngest)
            guard !vores.isEmpty else { return .ukendt(S.engineNoJobs) }
            let til = vores.filter { $0.enabled }
            if til.count == vores.count {
                return .til(naeste: vores.compactMap { $0.nextRunAt }.min())
            }
            if til.isEmpty { return .fra }
            return .blandet(til: til.count, af: vores.count - til.count)
        }
    }

    /// Slå ALLE local-ingest-jobs til/fra. Returnerer en fejl hvis bare ét
    /// afviste — halvt slået fra er den tilstand fladen ikke må kalde «fra».
    static func setEnabled(_ paa: Bool) async -> String? {
        switch await jobs() {
        case .failure(let f): return f.tekst
        case .success(let alle):
            let vores = alle.filter(erLokalIngest)
            guard !vores.isEmpty else { return S.engineNoJobs }
            for j in vores {
                guard let req = request("/api/dispatch/jobs/\(j.id)/enabled", method: "POST", body: ["enabled": paa]),
                      let (_, resp) = try? await URLSession.shared.data(for: req),
                      (200..<300).contains((resp as? HTTPURLResponse)?.statusCode ?? 0)
                else { return S.engineToggleFailed }
            }
            return nil
        }
    }

    /// «Der ligger arbejde NU» — bed buddy sende kommandoen til den kørende
    /// session med det samme, i stedet for at vente op til 120 sekunder på
    /// deres probe. Proben bliver stående som sikkerhedsnet: de to gør ikke
    /// det samme — den ene reagerer på en hændelse, den anden fanger det vi
    /// måtte misse.
    static func triggerNow(tenant: String) async -> String? {
        guard let req = request("/api/intercom/dispatch", method: "POST", body: [
            "targetSession": "trail",
            "repo": "broberg-ai/trail",
            "message": "/local-ingest \(tenant)",
            "severity": "info",
            "from": "trail-ambient",
        ]) else { return S.engineDaemonUnexpected }
        guard let (_, resp) = try? await URLSession.shared.data(for: req) else {
            return S.engineDaemonUnreachable
        }
        let kode = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(kode) { return nil }
        // 503 = ingen levende session. Det er IKKE en fejl der skal fejle
        // jobbet: kilden bliver liggende, leasen udløber, og skyen tager den
        // synligt (F263.5). Sig hvad der skete frem for at tie.
        if kode == 503 { return S.engineNoSession }
        return "\(S.engineDaemonUnexpected) (\(kode))"
    }
}
