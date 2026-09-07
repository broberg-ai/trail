// F263.8 — flere konti i Ambient, én nøgle pr. konto.
//
// HVORFOR IKKE VEJEN GENNEM app.trailmem.com, som planen først sagde. Målt i
// kontrol-planets proxy (apps/admin-server/src/proxy.ts): den bytter kaldets
// nøgle ud med MOTORENS egen bearer, før den sender videre —
//
//     const bearer = eng?.bearer ?? null;
//
// — så en enhed der taler med motoren GENNEM proxyen aldrig præsenterer sin
// egen ambient-nøgle for motoren. Rute-spærren fra F263.7 ville slet ikke
// gælde, og enheden ville få hele API'et: indstillinger, nøgler, brugere,
// sletning. Det er præcis det kortets første betingelse forbyder, og det ville
// have set fuldstændig færdigt ud på skærmen.
//
// DERFOR: én ambient-nøgle PR. KONTO, gemt hver for sig i Keychain, og
// Ambient taler direkte med motoren som hidtil. Konto-vælgeren skifter hvilken
// nøgle der bruges — ikke hvilket lag der spørger.
//
// Det giver tre ting gratis, som den anden vej skulle have bygget:
//   · Rute-spærren gælder, fordi nøglen faktisk NÅR motoren.
//   · Vælger, ikke fuldmagt: en nøgle kan kun opstå i en konto man kan logge
//     ind i, så listen kan ikke rumme en konto man ikke må.
//   · Tilbagekald pr. konto: hver nøgle står i DEN kontos Indstillinger →
//     API-nøgler. Tilbagekald én, og de øvrige kører videre — hvilket også
//     betyder at ét tilbagekald IKKE lukker de andre.
import Foundation
import Security

extension Notification.Name {
    /// Konto-listen eller det aktive valg har ændret sig — Ingest-vinduet
    /// genindlæser sin liste på den.
    static let trailKontoerAendret = Notification.Name("TrailAmbient.kontoerAendret")
    /// «Tilføj konto…» blev valgt i Ingest-vinduet. AppDelegate ejer
    /// parringen (og dens to-koders-spærre), så vinduet beder den om det
    /// frem for at starte en anden parring ved siden af.
    static let trailTilfoejKonto = Notification.Name("TrailAmbient.tilfoejKonto")
}

/// En konto Ambient faktisk har en nøgle til.
struct ConnectedTenant: Codable, Identifiable, Equatable {
    let slug: String
    var name: String?
    var deviceName: String?
    var email: String?
    var kbIds: [String]
    var kbNames: [String]

    var id: String { slug }
    var visningsnavn: String { name ?? slug }
}

enum TenantStore {
    /// Sat af `--tenanttest` så prøven aldrig rører den rigtige Keychain eller
    /// de rigtige indstillinger. Nil i normal drift.
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
    /// Nøglen fra før F263.8 — én konto, ét Keychain-item. Bliver liggende:
    /// ingen naken omlægning, den ryddes først når den nye vej er bevist.
    private static let arvetKeychainAccount = "trail-api-token"

    // MARK: - Konti

    static var kontoer: [ConnectedTenant] {
        guard let data = d.data(forKey: listeNoegle),
              let liste = try? JSONDecoder().decode([ConnectedTenant].self, from: data)
        else { return [] }
        return liste
    }

    private static func skriv(_ liste: [ConnectedTenant]) {
        guard let data = try? JSONEncoder().encode(liste) else { return }
        d.set(data, forKey: listeNoegle)
    }

    /// Den valgte konto. Peger den på noget der ikke findes (fx efter et
    /// tilbagekald), falder den til den første — aldrig til ingenting, for et
    /// tomt valg og «ikke forbundet» ser ens ud på skærmen.
    static var aktivSlug: String? {
        get {
            let liste = kontoer
            if let s = d.string(forKey: aktivNoegle), liste.contains(where: { $0.slug == s }) { return s }
            return liste.first?.slug
        }
        set {
            guard let s = newValue, kontoer.contains(where: { $0.slug == s }) else { return }
            d.set(s, forKey: aktivNoegle)
            varsl()
        }
    }

    static var aktivKonto: ConnectedTenant? {
        guard let s = aktivSlug else { return nil }
        return kontoer.first { $0.slug == s }
    }

    /// Gem (eller opdatér) en konto og dens nøgle. Kaldes når en parring
    /// lykkes. Samme konto igen = nøglen skiftes ud, ikke en dublet i listen.
    static func gem(
        slug: String,
        token: String,
        name: String? = nil,
        deviceName: String? = nil,
        email: String? = nil,
        kbIds: [String] = [],
        kbNames: [String] = []
    ) {
        let s = slug.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !s.isEmpty, !token.isEmpty else { return }
        gemToken(token, for: s)
        var liste = kontoer.filter { $0.slug != s }
        liste.append(ConnectedTenant(
            slug: s, name: name, deviceName: deviceName, email: email,
            kbIds: kbIds, kbNames: kbNames
        ))
        liste.sort { $0.visningsnavn.localizedCaseInsensitiveCompare($1.visningsnavn) == .orderedAscending }
        skriv(liste)
        d.set(s, forKey: aktivNoegle)
        varsl()
    }

    /// Fjern én konto lokalt. Bemærk: dette tilbagekalder INTET i skyen —
    /// nøglen lever videre i den kontos Indstillinger → API-nøgler til den
    /// bliver tilbagekaldt DÉR. At lade som om lokal glemsel var et
    /// tilbagekald ville være den farligste slags grøn.
    static func fjern(slug: String) {
        sletToken(for: slug)
        skriv(kontoer.filter { $0.slug != slug })
        if d.string(forKey: aktivNoegle) == slug { d.removeObject(forKey: aktivNoegle) }
        varsl()
    }

    static func ryd() {
        for k in kontoer { sletToken(for: k.slug) }
        d.removeObject(forKey: listeNoegle)
        d.removeObject(forKey: aktivNoegle)
        varsl()
    }

    // MARK: - Nøgler

    static func token(for slug: String) -> String? {
        laesKeychain(account: "trail-api-token:\(slug)")
    }

    /// Nøglen for den valgte konto. Findes ingen konti endnu, bruges den
    /// ARVEDE nøgle fra før F263.8 — så en allerede parret Mac bliver ved med
    /// at virke uden at parre om.
    static func aktivToken() -> String? {
        if let s = aktivSlug, let t = token(for: s) { return t }
        return laesKeychain(account: arvetKeychainAccount)
    }

    /// Løfter en Mac der var parret FØR F263.8 ind i den nye form: én konto,
    /// samme nøgle. Den arvede Keychain-post bliver liggende urørt.
    /// Idempotent — kører den to gange, sker der ikke noget anden gang.
    @discardableResult
    static func migrerArvetParring() -> Bool {
        guard kontoer.isEmpty,
              let token = laesKeychain(account: arvetKeychainAccount),
              let slug = d.string(forKey: "trail.tenant")?.lowercased(),
              !slug.isEmpty
        else { return false }
        gem(
            slug: slug,
            token: token,
            deviceName: d.string(forKey: "trail.deviceName"),
            email: d.string(forKey: "trail.email"),
            kbIds: d.stringArray(forKey: "trail.kbIds") ?? [],
            kbNames: d.stringArray(forKey: "trail.kbNames") ?? []
        )
        return true
    }

    /// Sig til at listen har flyttet sig. Kun i rigtig drift — en prøve skal
    /// ikke sparke UI'et.
    private static func varsl() {
        guard testNavnerum == nil else { return }
        NotificationCenter.default.post(name: .trailKontoerAendret, object: nil)
    }

    /// Den valgte videnbase huskes PR. KONTO. Én fælles nøgle ville bære et
    /// id fra den forrige konto med over — det ville falde tilbage til den
    /// første base uden at sige hvorfor, og valget ville aldrig sidde fast.
    static func kbNoegle(for slug: String?) -> String {
        guard let s = slug, !s.isEmpty else { return "trail.kbId" }
        return "trail.kbId.\(s)"
    }

    // MARK: - Keychain

    private static func gemToken(_ token: String, for slug: String) {
        let account = "trail-api-token:\(slug)"
        sletKeychain(account: account)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(token.utf8),
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    private static func sletToken(for slug: String) {
        sletKeychain(account: "trail-api-token:\(slug)")
    }

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
