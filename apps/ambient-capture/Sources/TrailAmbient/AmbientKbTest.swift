// F268.1 — beviset for at ambient IKKE gætter sin videnbase. `--ambientkbtest`.
//
// Prøven findes på grund af én måling: 536 arbejdsnoter landede i broberg.ai
// fordi opslaget faldt tilbage til `trail.kbIds.first` når intet var valgt.
// Prøve 1 er derfor en NEGATIV KONTROL — den er rød på præcis den gamle kode,
// og det er hele grunden til at den står først.
import Foundation

enum AmbientKbTest {
    static func run() {
        let navnerum = "ambientkbtest-\(UUID().uuidString.prefix(8))"
        AmbientKbStore.testNavnerum = navnerum
        let d = UserDefaults(suiteName: navnerum)!
        defer {
            UserDefaults.standard.removePersistentDomain(forName: navnerum)
            AmbientKbStore.testNavnerum = nil
        }

        var fejl: [String] = []
        func kraev(_ ok: Bool, _ hvad: String) {
            print(ok ? "  ok   \(hvad)" : "  FEJL \(hvad)")
            if !ok { fejl.append(hvad) }
        }
        func nulstil() {
            for k in ["trail.ambient.kbId", "trail.kbId", "trail.kbIds",
                      "trail.kbNames", "trail.kbNamesById"] { d.removeObject(forKey: k) }
        }

        let a = "kb-aaaa", b = "kb-bbbb", c = "kb-cccc"

        // 1 — NEGATIV KONTROL. Adgang til tre videnbaser, INTET valgt.
        //     Den gamle kode svarede `a` her. Et gæt kan ikke skelne «ejeren
        //     valgte denne» fra «ingen har valgt noget» — og forskellen kostede
        //     536 noter i den forkerte Trail.
        nulstil()
        d.set([a, b, c], forKey: "trail.kbIds")
        kraev(AmbientKbStore.valgt == nil, "intet valgt → nil, ikke listens første")
        kraev(AmbientKbStore.valgtNavn == nil, "intet valgt → intet navn at vise")

        // 2 — valget skrives og LÆSES TILBAGE
        AmbientKbStore.valgt = b
        kraev(AmbientKbStore.valgt == b, "valget læses tilbage som det blev skrevet")
        kraev(d.string(forKey: "trail.ambient.kbId") == b, "valget står i ambients EGEN nøgle")

        // 3 — Ingest-vinduets nøgle må ikke kunne flytte ambient bagefter.
        //     Det var mekanismen: én nøgle til to handlinger.
        d.set(c, forKey: "trail.kbId")
        kraev(AmbientKbStore.valgt == b, "Ingest-vinduets valg flytter IKKE ambient")

        // 4 — men en Mac der kørte FØR rettelsen må ikke gå tavs: den gamle
        //     delte nøgle overtages én gang som startværdi.
        nulstil()
        d.set([a, b, c], forKey: "trail.kbIds")
        d.set(c, forKey: "trail.kbId")
        kraev(AmbientKbStore.valgt == c, "gammel delt nøgle overtages som startværdi")
        d.removeObject(forKey: "trail.kbId")
        kraev(AmbientKbStore.valgt == c, "overtagelsen er gemt, ikke genberegnet hver gang")

        // 5 — et valg der ikke længere er givet adgang til er ikke et valg,
        //     og må ikke falde tavst tilbage til en anden videnbase.
        nulstil()
        d.set([a, b], forKey: "trail.kbIds")
        d.set(c, forKey: "trail.ambient.kbId")
        kraev(AmbientKbStore.valgt == nil, "et id uden adgang giver nil, ikke listens første")

        // 6 — navn og id må ALDRIG parres på indeks når listerne ikke er lige
        //     lange. Målt på den rigtige Mac: 5 id'er, 1 navn — parring på
        //     indeks ville have navngivet den forkerte Trail.
        nulstil()
        d.set([a, b, c], forKey: "trail.kbIds")
        d.set(["Kun ét navn"], forKey: "trail.kbNames")
        kraev(AmbientKbStore.navn(for: b) == nil, "ulige lange lister → intet navn, ikke et forkert")
        d.set(["Første", "Anden", "Tredje"], forKey: "trail.kbNames")
        kraev(AmbientKbStore.navn(for: b) == "Anden", "lige lange lister → navnet parres korrekt")

        // 7 — et hentet navn gemmes uden at smide de andre væk. Den gamle form
        //     overskrev hele listen med ét navn.
        AmbientKbStore.gemNavn("Nyt navn", for: a)
        kraev(AmbientKbStore.navn(for: a) == "Nyt navn", "hentet navn vinder over listen")
        kraev(AmbientKbStore.navn(for: c) == "Tredje", "de andre navne overlever")

        print(fejl.isEmpty ? "AMBIENTKBTEST PASS" : "AMBIENTKBTEST FAIL: \(fejl.joined(separator: " · "))")
        exit(fejl.isEmpty ? 0 : 1)
    }
}
