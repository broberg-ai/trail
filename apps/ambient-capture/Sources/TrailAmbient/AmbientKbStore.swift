// F268.1 — AMBIENT HAR SIN EGEN VIDENBASE-NØGLE.
//
// Målt 10/9 2026 efter at 536 arbejdsnoter fra ambient landede i broberg.ai —
// den Trail hjemmesidens chat svarer fra, og som ejeren aldrig havde valgt til
// ambient. Der var to grunde, og ingen af dem var synlig fra menulinjen:
//
//   1. Ambient sendte på `trail.kbId`. Det er PRÆCIS den nøgle Ingest-vinduets
//      videnbase-vælger skrev i (IngestView), dengang den skrev uden konto.
//      At vælge en Trail at LÆGGE FILER I flyttede altså også hver eneste
//      diktering derhen. To handlinger, én nøgle.
//   2. Efter F263.8 flyttede vælgeren til `trail.kbId.<konto>`. Ambient blev
//      IKKE flyttet med, så den læste en nøgle ingen længere skrev — og faldt
//      tilbage til `trail.kbIds.first`. Rækkefølgen i parringens liste afgjorde
//      hvor arbejdsnoterne røg.
//
// Derfor: ambient har sin egen nøgle, og der er INGEN tilbagefald til «den
// første på listen». Er der ikke valgt noget, er svaret nil — og så sender
// ambient ingenting. Et tilbagefald der gætter kan ikke skelne «ejeren valgte
// denne» fra «ingen har valgt noget», og det er netop den forskel der her kostede
// 536 noter i den forkerte Trail.
import Foundation

enum AmbientKbStore {
    /// Sat af `--ambientkbtest` så prøven aldrig rører den rigtige Mac.
    nonisolated(unsafe) static var testNavnerum: String?

    private static var d: UserDefaults {
        if let n = testNavnerum, let suite = UserDefaults(suiteName: n) { return suite }
        return .standard
    }

    static let noegle = "trail.ambient.kbId"
    /// Den gamle DELTE nøgle. Læses ÉN gang som startværdi, skrives aldrig.
    private static let gammelDeltNoegle = "trail.kbId"
    private static let idListe = "trail.kbIds"
    private static let navnListe = "trail.kbNames"
    private static let navnKort = "trail.kbNamesById"

    /// De videnbaser enheds-parringen faktisk gav adgang til.
    static var tilladte: [String] {
        (d.array(forKey: idListe) as? [String])?.filter { !$0.isEmpty } ?? []
    }

    /// Ambients mål. `nil` = intet valgt → der sendes ingenting.
    static var valgt: String? {
        get {
            if let v = d.string(forKey: noegle), !v.isEmpty {
                // Et valg der ikke længere er givet adgang til er ikke et valg.
                return tilladte.isEmpty || tilladte.contains(v) ? v : nil
            }
            // Engangs-overtagelse fra den gamle delte nøgle, så en Mac der kørte
            // før denne rettelse ikke går tavs. Kun hvis den stadig er tilladt.
            if let gammel = d.string(forKey: gammelDeltNoegle), !gammel.isEmpty,
               tilladte.isEmpty || tilladte.contains(gammel) {
                d.set(gammel, forKey: noegle)
                return gammel
            }
            return nil
        }
        set {
            if let v = newValue, !v.isEmpty { d.set(v, forKey: noegle) }
            else { d.removeObject(forKey: noegle) }
        }
    }

    /// Navnet på en videnbase. Rækkefølgen i `trail.kbNames` bruges KUN når den
    /// har præcis lige så mange elementer som id-listen — ellers parrer man
    /// navn og id på indeks der ikke hører sammen.
    static func navn(for id: String) -> String? {
        if let kort = d.dictionary(forKey: navnKort) as? [String: String],
           let n = kort[id], !n.isEmpty { return n }
        let navne = (d.array(forKey: navnListe) as? [String]) ?? []
        let ids = tilladte
        if navne.count == ids.count, let i = ids.firstIndex(of: id) { return navne[i] }
        return nil
    }

    /// Husk et navn vi har hentet fra motoren, uden at smide de andre væk.
    static func gemNavn(_ navn: String, for id: String) {
        var kort = (d.dictionary(forKey: navnKort) as? [String: String]) ?? [:]
        kort[id] = navn
        d.set(kort, forKey: navnKort)
    }

    /// Navnet på det ambient sender til lige nu — eller nil når intet er valgt.
    static var valgtNavn: String? {
        guard let id = valgt else { return nil }
        return navn(for: id) ?? String(id.prefix(8))
    }
}
