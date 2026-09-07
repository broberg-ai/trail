// F263.8 — beviset for konto-lageret. `TrailAmbient --tenanttest`.
//
// Appen har ingen XCTest-target; husets form her er en flagkørsel der skriver
// PASS/FAIL og bruges af scripts/test.sh. Prøven kører i sit EGET navnerum
// (UserDefaults-suite + Keychain-service), så den aldrig rører den rigtige
// parring på Christians Mac.
//
// DEN VIGTIGSTE PRØVE ER DEN ARVEDE: en Mac der var parret FØR denne ændring
// skal blive ved med at virke uden at parre om. Går den i stykker, er
// symptomet at Ingest-vinduet siger «ikke forbundet» på en maskine der ER
// forbundet — og det ville ligne en netværksfejl, ikke en migrering.
import Foundation
import Security

enum TenantTest {
    static func run() {
        let navnerum = "tenanttest-\(UUID().uuidString.prefix(8))"
        TenantStore.testNavnerum = navnerum
        defer {
            TenantStore.ryd()
            sletArvet(navnerum: navnerum)
            UserDefaults.standard.removePersistentDomain(forName: navnerum)
            TenantStore.testNavnerum = nil
        }
        TenantStore.ryd()

        var fejl: [String] = []
        func kraev(_ ok: Bool, _ hvad: String) {
            print(ok ? "  ok   \(hvad)" : "  FEJL \(hvad)")
            if !ok { fejl.append(hvad) }
        }

        // 1 — tom start
        kraev(TenantStore.kontoer.isEmpty, "ingen konti fra start")
        kraev(TenantStore.aktivToken() == nil, "ingen nøgle fra start")

        // 2 — to konti, hver sin nøgle
        TenantStore.gem(slug: "broberg-ai", token: "trail_aaa", name: "Broberg AI")
        TenantStore.gem(slug: "sanne-andersen", token: "trail_bbb", name: "Sanne Andersen")
        kraev(TenantStore.kontoer.count == 2, "to konti gemt")
        kraev(TenantStore.token(for: "broberg-ai") == "trail_aaa", "broberg-ai har sin egen nøgle")
        kraev(TenantStore.token(for: "sanne-andersen") == "trail_bbb", "sanne-andersen har sin egen nøgle")
        // Den bærende: to konti må ALDRIG dele nøgle. Deler de, taler man med
        // den forkerte kunde uden at noget ser forkert ud.
        kraev(TenantStore.token(for: "broberg-ai") != TenantStore.token(for: "sanne-andersen"),
              "de to nøgler er FORSKELLIGE")

        // 3 — det aktive valg styrer hvilken nøgle der bruges
        TenantStore.aktivSlug = "broberg-ai"
        kraev(TenantStore.aktivToken() == "trail_aaa", "aktiv=broberg-ai → dens nøgle")
        TenantStore.aktivSlug = "sanne-andersen"
        kraev(TenantStore.aktivToken() == "trail_bbb", "aktiv=sanne-andersen → dens nøgle")

        // 4 — NEGATIV KONTROL: en konto der ikke er forbundet kan ikke vælges,
        //     og valget må ikke falde tavst tilbage til noget andet.
        TenantStore.aktivSlug = "en-fremmed-konto"
        kraev(TenantStore.aktivSlug == "sanne-andersen", "ukendt konto ændrer IKKE valget")
        kraev(TenantStore.token(for: "en-fremmed-konto") == nil, "ukendt konto har ingen nøgle")

        // 5 — samme konto igen erstatter nøglen, laver ikke en dublet
        TenantStore.gem(slug: "broberg-ai", token: "trail_ccc", name: "Broberg AI")
        kraev(TenantStore.kontoer.count == 2, "genparring giver ikke en dublet")
        kraev(TenantStore.token(for: "broberg-ai") == "trail_ccc", "genparring skifter nøglen ud")

        // 6 — fjern én konto: de øvrige er urørt (det lokale sidestykke til at
        //     et tilbagekald i én konto ikke lukker de andre)
        TenantStore.fjern(slug: "broberg-ai")
        kraev(TenantStore.token(for: "broberg-ai") == nil, "fjernet konto har ingen nøgle")
        kraev(TenantStore.token(for: "sanne-andersen") == "trail_bbb", "den anden konto er URØRT")
        kraev(TenantStore.kontoer.map(\.slug) == ["sanne-andersen"], "listen har kun den tilbageværende")

        // 7 — hver konto husker sin egen videnbase
        kraev(TenantStore.kbNoegle(for: "a") != TenantStore.kbNoegle(for: "b"),
              "valgt videnbase huskes pr. konto")

        // 8 — DEN ARVEDE PARRING. Ingen konti, men en gammel nøgle + slug.
        TenantStore.ryd()
        let d = UserDefaults(suiteName: navnerum)!
        d.set("broberg-ai", forKey: "trail.tenant")
        skrivArvet(token: "trail_arvet", navnerum: navnerum)
        kraev(TenantStore.aktivToken() == "trail_arvet",
              "en Mac parret FØR F263.8 virker uden migrering")
        kraev(TenantStore.migrerArvetParring(), "migreringen kører")
        kraev(TenantStore.kontoer.map(\.slug) == ["broberg-ai"], "den arvede parring blev til en konto")
        kraev(TenantStore.token(for: "broberg-ai") == "trail_arvet", "samme nøgle, nu pr. konto")
        kraev(!TenantStore.migrerArvetParring(), "migreringen er idempotent")

        print(fejl.isEmpty
              ? "TENANTTEST PASS (\(0) fejl)"
              : "TENANTTEST FAIL: \(fejl.joined(separator: " · "))")
        exit(fejl.isEmpty ? 0 : 1)
    }

    // Den arvede Keychain-post skrives direkte, i prøvens eget service-navn.
    private static func service(_ navnerum: String) -> String {
        "com.broberg.trail-ambient.test.\(navnerum)"
    }

    private static func skrivArvet(token: String, navnerum: String) {
        sletArvet(navnerum: navnerum)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service(navnerum),
            kSecAttrAccount as String: "trail-api-token",
            kSecValueData as String: Data(token.utf8),
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    private static func sletArvet(navnerum: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service(navnerum),
            kSecAttrAccount as String: "trail-api-token",
        ]
        SecItemDelete(q as CFDictionary)
    }
}
