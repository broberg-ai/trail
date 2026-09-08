// F263.8 — konti i Ambient, bygget på PRÆCIS det mønster Web Clipper allerede
// bruger. Ejeren 7/9: «Web Clipper har adgang til ALLE tenants og ALLE trails
// med 1 dev nøgle. Kunne du måske have brugt den udgave i stedet for?»
//
// Han havde ret, og jeg havde bygget en parallel mekanisme ved siden af en der
// virkede. Målt i apps/web-clipper/src/popup/Popup.tsx:
//
//     GET /api/v1/me/tenants          konto-listen, fra medlemskaberne
//     h['X-Trail-Tenant'] = tenant    vælg konto pr. kald
//     app.trailmem.com                én personlig nøgle
//
// Én nøgle, alle konti, alle Trails. Ingen parring pr. konto, ingen udlogning.
//
// DEN ENE DETALJE DER SKAL MED (Web Clippers F215.4, og den kostede dem en
// rigtig fejl): kaldet må IKKE bære browser-/system-cookies. Gjorde det det,
// kunne en indlogget session overtrumfe nøglen — vælgeren sagde én konto og
// kaldet gik til en anden. URLSession sender cookies fra den delte butik med
// som standard, så `httpShouldHandleCookies = false` er den samme spærre set
// fra vores side.
//
// Enheds-parringen (F201) er URØRT og bruges stadig af capture + HUD. Det her
// er Ingest-fladens vej, ved siden af — ingen naken omlægning.
import Foundation
import Security

extension Notification.Name {
    /// Konto-listen eller det aktive valg har flyttet sig.
    static let trailKontoerAendret = Notification.Name("TrailAmbient.kontoerAendret")
}

/// En konto nøglen må vælge — som `/api/v1/me/tenants` beskriver den.
struct ConnectedTenant: Codable, Identifiable, Equatable {
    let slug: String
    let name: String
    let role: String?

    var id: String { slug }
    var visningsnavn: String { name }
}

enum TenantStore {
    /// Sat af `--tenanttest` så prøven aldrig rører den rigtige Keychain.
    nonisolated(unsafe) static var testNavnerum: String?

    private static var d: UserDefaults {
        if let n = testNavnerum, let suite = UserDefaults(suiteName: n) { return suite }
        return .standard
    }
    private static var keychainService: String {
        if let n = testNavnerum { return "com.broberg.trail-ambient.test.\(n)" }
        return "com.broberg.trail-ambient"
    }

    private static let listeNoegle = "trail.tenants"
    private static let aktivNoegle = "trail.activeTenant"
    private static let noegleAccount = "trail-personal-token"

    // MARK: - Nøglen

    /// Den personlige nøgle — samme slags Web Clipper bruger, mintet i
    /// Indstillinger → API-nøgler på app.trailmem.com.
    static var personligNoegle: String? {
        get { laesKeychain(account: noegleAccount) }
        set {
            sletKeychain(account: noegleAccount)
            guard let v = newValue?.trimmingCharacters(in: .whitespacesAndNewlines), !v.isEmpty
            else { varsl(); return }
            let q: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: noegleAccount,
                kSecValueData as String: Data(v.utf8),
            ]
            SecItemAdd(q as CFDictionary, nil)
            varsl()
        }
    }

    static var harNoegle: Bool { personligNoegle != nil }

    // MARK: - Konti

    /// Sidst hentede konto-liste. Kun en CACHE så vinduet kan tegne med det
    /// samme — sandheden er `/api/v1/me/tenants`, og listen skrives kun af den.
    static var kontoer: [ConnectedTenant] {
        guard let data = d.data(forKey: listeNoegle),
              let liste = try? JSONDecoder().decode([ConnectedTenant].self, from: data)
        else { return [] }
        return liste
    }

    /// Skriv listen serveren svarede. Er det aktive valg ikke længere med —
    /// et medlemskab kan være væk — falder valget til den første, aldrig til
    /// ingenting: et tomt valg og «ikke forbundet» ser ens ud på skærmen.
    static func gemKontoer(_ liste: [ConnectedTenant]) {
        guard let data = try? JSONEncoder().encode(liste) else { return }
        d.set(data, forKey: listeNoegle)
        if let s = d.string(forKey: aktivNoegle), liste.contains(where: { $0.slug == s }) {
            // valget står ved magt
        } else if let f = liste.first?.slug {
            d.set(f, forKey: aktivNoegle)
        }
        varsl()
    }

    /// Den valgte konto. Sendes som `X-Trail-Tenant` på hvert kald.
    static var aktivSlug: String? {
        get {
            let liste = kontoer
            if let s = d.string(forKey: aktivNoegle), liste.contains(where: { $0.slug == s }) { return s }
            return liste.first?.slug
        }
        set {
            // En konto der ikke står i listen må ikke kunne vælges — serveren
            // ville alligevel afvise den, og et tavst fald tilbage til en anden
            // konto er præcis den fejl man ikke opdager.
            guard let s = newValue, kontoer.contains(where: { $0.slug == s }) else { return }
            d.set(s, forKey: aktivNoegle)
            varsl()
        }
    }

    static var aktivKonto: ConnectedTenant? {
        guard let s = aktivSlug else { return nil }
        return kontoer.first { $0.slug == s }
    }

    static func ryd() {
        personligNoegle = nil
        d.removeObject(forKey: listeNoegle)
        d.removeObject(forKey: aktivNoegle)
        varsl()
    }

    private static func varsl() {
        guard testNavnerum == nil else { return }
        NotificationCenter.default.post(name: .trailKontoerAendret, object: nil)
    }

    /// Den valgte videnbase huskes PR. KONTO. Én fælles nøgle ville bære et id
    /// fra den forrige konto med over, falde tilbage til den første uden at
    /// sige hvorfor, og valget ville aldrig sidde fast.
    static func kbNoegle(for slug: String?) -> String {
        guard let s = slug, !s.isEmpty else { return "trail.kbId" }
        return "trail.kbId.\(s)"
    }

    // MARK: - Keychain

    private static func laesKeychain(account: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func sletKeychain(account: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(q as CFDictionary)
    }
}

/// F263.8 — maskinens navn, som det står i et claim på et kompilerings-job.
/// Samme streng begge steder, så fladen kan afgøre om det er DENNE Mac der
/// arbejder — og ikke bare «en eller anden session».
enum Vaert {
    static let navn: String = {
        let n = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
        return "\(n) · cc"
    }()
}
