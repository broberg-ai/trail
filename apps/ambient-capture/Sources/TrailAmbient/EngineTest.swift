// F263.3 — kørbart bevis på at motor-kontakten LÆSER rigtigt.
//
// `--enginetest` spørger buddys dæmon om de rigtige jobs og printer den
// tilstand fladen ville vise. Uden den er min gruppering, min JSON-parsning og
// min tidsstempel-læsning kun bevist ved at koden OVERSÆTTER — og en flade der
// viser «slået fra» mens jobbet kører, ville se helt normal ud.
//
// SÆRLIGT DEN BLANDEDE TILSTAND. Der er MÅLT to local-ingest-jobs (broberg-ai
// og sanne-andersen), ikke ét. En kontakt der kun så det første ville melde
// «slået fra» mens den anden kunde stadig blev kompileret. Prøven viser derfor
// ANTALLET, ikke bare tilstanden — så «jeg fandt ét job» og «jeg fandt begge»
// ikke er samme grønne linje.
//
// Kører dæmonen ikke, er det IKKE en fejl: prøven melder SKIPPED. En maskine
// uden buddy er en gyldig tilstand, og en prøve der fejler dér ville lære os
// at ignorere den.
import Foundation

enum EngineTest {
    /// F263.3 — bevis på at kontakten SKRIVER, ikke kun læser.
    ///
    /// Slår motoren fra, LÆSER TILSTANDEN TILBAGE fra dæmonen, slår den til
    /// igen, og læser tilbage igen. En knap der «virker» fordi den returnerede
    /// uden fejl er præcis det grønne vi bruger dagen på at fjerne — beviset
    /// er hvad dæmonen SIGER bagefter, ikke hvad kaldet svarede.
    ///
    /// Gendanner ALTID til tændt til sidst, også hvis noget undervejs fejler:
    /// en prøve der efterlader den lokale ingest slukket ville stoppe rigtigt
    /// arbejde uden at nogen opdagede det.
    static func toggle() {
        let sem = DispatchSemaphore(value: 0)
        var linjer: [String] = []
        Task {
            func tilstand() async -> String {
                switch await EngineState.hent() {
                case .til: return "til"
                case .fra: return "fra"
                case .blandet(let a, let b): return "blandet(\(a)/\(a+b))"
                case .ukendt(let h): return "ukendt(\(h))"
                }
            }
            let foer = await tilstand()
            linjer.append("foer=\(foer)")

            if let f = await EngineControl.setEnabled(false) { linjer.append("SLUK-FEJL=\(f)") }
            let efterSluk = await tilstand()
            linjer.append("efter_sluk=\(efterSluk)")

            if let f = await EngineControl.setEnabled(true) { linjer.append("TAEND-FEJL=\(f)") }
            let efterTaend = await tilstand()
            linjer.append("efter_taend=\(efterTaend)")

            let ok = efterSluk == "fra" && efterTaend == "til"
            linjer.append(ok ? "PASS" : "FAIL(kontakten skrev ikke igennem)")
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 30)
        print("ENGINETOGGLE " + linjer.joined(separator: " "))
    }


    /// F263.3 — bevis på den ØJEBLIKKELIGE trigger. Beder buddy sende
    /// «/local-ingest <kunde>» til den kørende session, som selv claimer og
    /// kompilerer. Ambient rører aldrig et job.
    static func trigger(tenant: String, session: String = "trail") {
        let sem = DispatchSemaphore(value: 0)
        var linje = "ENGINETRIGGER INCONCLUSIVE"
        Task {
            if let f = await EngineControl.triggerNow(tenant: tenant, session: session) {
                linje = "ENGINETRIGGER tenant=\(tenant) session=\(session) AFVIST(\(f))"
            } else {
                linje = "ENGINETRIGGER tenant=\(tenant) session=\(session) PASS(buddy tog imod)"
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 15)
        print(linje)
    }

    static func run() {
        let sem = DispatchSemaphore(value: 0)
        var resultat = "ENGINETEST INCONCLUSIVE"
        Task {
            switch await EngineControl.jobs() {
            case .failure(let f):
                resultat = "ENGINETEST SKIPPED — \(f.tekst)"
            case .success(let alle):
                let vores = alle.filter { $0.command.hasPrefix("/local-ingest") }
                let til = vores.filter { $0.enabled }.count
                let tilstand = await EngineState.hent()
                let navn: String
                switch tilstand {
                case .til(let n):
                    let sek = n.map { max(0, Int($0.timeIntervalSinceNow)) }
                    navn = "til(næste=\(sek.map(String.init) ?? "-")s)"
                case .fra: navn = "fra"
                case .blandet(let a, let b): navn = "blandet(\(a) til, \(b) fra)"
                case .ukendt(let h): navn = "ukendt(\(h))"
                }
                // Tallene FØR tilstanden: en tom liste og en fejlet
                // forespørgsel giver begge «fra» hvis man kun printer navnet.
                resultat = "ENGINETEST jobs_i_alt=\(alle.count) local_ingest=\(vores.count) "
                    + "enabled=\(til) tilstand=\(navn) "
                    + (vores.isEmpty ? "PASS(ingen jobs registreret)" : "PASS")
            }
            sem.signal()
        }
        _ = sem.wait(timeout: .now() + 10)
        print(resultat)
    }
}
