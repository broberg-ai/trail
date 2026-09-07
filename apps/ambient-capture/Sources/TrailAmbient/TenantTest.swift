// F263.8 — beviset for konto-lageret. `TrailAmbient --tenanttest`.
//
// Appen har ingen XCTest-target; husets form her er en flagkørsel der skriver
// PASS/FAIL og køres af scripts/test.sh. Prøven kører i sit EGET navnerum
// (UserDefaults-suite + Keychain-service), så den aldrig rører den rigtige
// nøgle på Christians Mac.
//
// Modellen er Web Clippers: ÉN personlig nøgle, og konto-listen kommer fra
// serveren (/api/v1/me/tenants). Det der kan prøves lokalt er derfor lageret
// og valget — ikke listen selv, som er serverens svar.
import Foundation
import Security

enum TenantTest {
    static func run() {
        let navnerum = "tenanttest-\(UUID().uuidString.prefix(8))"
        TenantStore.testNavnerum = navnerum
        defer {
            TenantStore.ryd()
            UserDefaults.standard.removePersistentDomain(forName: navnerum)
            TenantStore.testNavnerum = nil
        }
        TenantStore.ryd()

        var fejl: [String] = []
        func kraev(_ ok: Bool, _ hvad: String) {
            print(ok ? "  ok   \(hvad)" : "  FEJL \(hvad)")
            if !ok { fejl.append(hvad) }
        }

        let a = ConnectedTenant(slug: "broberg-ai", name: "Broberg.ai", role: "owner")
        let b = ConnectedTenant(slug: "sanne-andersen", name: "Sanne Andersen", role: "owner")

        // 1 — tom start
        kraev(TenantStore.personligNoegle == nil, "ingen nøgle fra start")
        kraev(TenantStore.kontoer.isEmpty, "ingen konti fra start")
        kraev(!TenantStore.harNoegle, "harNoegle er falsk uden nøgle")

        // 2 — nøglen gemmes og LÆSES TILBAGE
        TenantStore.personligNoegle = "trail_hemmelig"
        kraev(TenantStore.personligNoegle == "trail_hemmelig", "nøglen læses tilbage som den blev skrevet")
        kraev(TenantStore.harNoegle, "harNoegle er sand med nøgle")

        // 3 — serverens liste gemmes, og den FØRSTE bliver valgt
        TenantStore.gemKontoer([a, b])
        kraev(TenantStore.kontoer.map(\.slug) == ["broberg-ai", "sanne-andersen"],
              "listen gemmes i serverens rækkefølge")
        kraev(TenantStore.aktivSlug == "broberg-ai", "første konto vælges når intet er valgt")

        // 4 — skift konto
        TenantStore.aktivSlug = "sanne-andersen"
        kraev(TenantStore.aktivSlug == "sanne-andersen", "kontoen kan skiftes")
        kraev(TenantStore.aktivKonto?.name == "Sanne Andersen", "den valgte konto slås korrekt op")

        // 5 — NEGATIV KONTROL: en konto der ikke står i serverens liste kan
        //     ikke vælges, og valget må ikke falde tavst tilbage til en anden.
        TenantStore.aktivSlug = "en-fremmed-konto"
        kraev(TenantStore.aktivSlug == "sanne-andersen", "ukendt konto ændrer IKKE valget")

        // 6 — mister man et medlemskab, falder valget til den første, ikke til
        //     ingenting: et tomt valg og «ikke forbundet» ser ens ud på skærmen.
        TenantStore.gemKontoer([a])
        kraev(TenantStore.aktivSlug == "broberg-ai", "valget følger med når en konto forsvinder")

        // 7 — valgt videnbase huskes pr. konto
        kraev(TenantStore.kbNoegle(for: "a") != TenantStore.kbNoegle(for: "b"),
              "valgt videnbase huskes pr. konto")

        // 8 — ryd fjerner BÅDE nøgle og liste. En glemt nøgle med en stående
        //     konto-liste ville vise konti man ikke længere kan nå.
        TenantStore.ryd()
        kraev(TenantStore.personligNoegle == nil, "ryd fjerner nøglen")
        kraev(TenantStore.kontoer.isEmpty, "ryd fjerner konto-listen")
        kraev(TenantStore.aktivSlug == nil, "ryd fjerner valget")

        print(fejl.isEmpty ? "TENANTTEST PASS" : "TENANTTEST FAIL: \(fejl.joined(separator: " · "))")
        exit(fejl.isEmpty ? 0 : 1)
    }
}
