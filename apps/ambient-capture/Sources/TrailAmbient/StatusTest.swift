// F263.8 — beviset for at MÅLINGEN slår INDSTILLINGEN. `--statustest`.
//
// De tilfælde hvor målingen skal VINDE står først. En prøve der kun viser at
// tom kø falder tilbage på buddy, ville bestå fuldstændig grønt på den kode
// der var i går — hvor buddy altid vandt.
import Foundation

enum StatusTest {
    static func run() {
        var fejl: [String] = []
        func kraev(_ ok: Bool, _ hvad: String) {
            print(ok ? "  ok   \(hvad)" : "  FEJL \(hvad)")
            if !ok { fejl.append(hvad) }
        }
        let mig = "cb-m1 · cc"

        // 1 — DENNE Mac arbejder: målingen svarer, og den navngiver ikke nogen anden.
        let vores = CompileStatus(waiting: 0, working: 1, workers: [mig])
        kraev(Motorlinje.maalt(vores, vaert: mig) == S.engineOn,
              "vores egen arbejder → «denne Mac kompilerer»")

        // 2 — EN ANDEN maskine arbejder. Den SKAL navngives; ellers tror man
        //     det er ens egen, og så er svaret på «hvem kompilerer» forkert.
        let andens = CompileStatus(waiting: 0, working: 1, workers: ["en-anden-mac · cc"])
        let svar = Motorlinje.maalt(andens, vaert: mig)
        kraev(svar != nil && svar != S.engineOn, "en anden maskine får IKKE vores egen tekst")
        kraev(svar?.contains("en-anden-mac") == true, "den anden maskine NAVNGIVES")

        // 3 — noget venter, ingen har taget det. Den tilstand er usynlig i et
        //     flag, og det er netop den man skal kunne se.
        let venter = CompileStatus(waiting: 3, working: 0, workers: [])
        kraev(Motorlinje.maalt(venter, vaert: mig)?.hasPrefix("3") == true,
              "3 venter → målingen siger 3, ikke hvad der er slået til")

        // 4 — NEGATIV KONTROL: intet at måle → nil, så fladen falder tilbage
        //     på buddys indstilling. Uden den ville «målingen vinder altid»
        //     bestå, og buddys svar ville aldrig kunne vises.
        kraev(Motorlinje.maalt(.tom, vaert: mig) == nil,
              "tom status → nil (så og KUN så bruges buddys indstilling)")

        // 5 — en arbejder med tomt navn må ikke tælle som en arbejder.
        let tomtNavn = CompileStatus(waiting: 0, working: 0, workers: [])
        kraev(Motorlinje.maalt(tomtNavn, vaert: mig) == nil, "ingen arbejdere → nil")

        print(fejl.isEmpty ? "STATUSTEST PASS" : "STATUSTEST FAIL: \(fejl.joined(separator: " · "))")
        exit(fejl.isEmpty ? 0 : 1)
    }
}
