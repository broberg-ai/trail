// F263.14 — vagten der ser efter arbejde, også når vinduet er lukket.
//
// En menulinje-app der kun virker mens man kigger på den, er ikke en motor.
// Indtil nu blev køen kun læst mens Ingest-vinduet stod åbent (15s-timeren i
// IngestWindowController), så en kilde droppet på app.trailmem.com kunne ligge
// til nogen tilfældigvis åbnede vinduet — eller til buddy prikkede, hvilket er
// dét led vi netop fjerner.
//
// INGEN AppKit: samme grund som EngineControl og SessionSpawner — adfærden skal
// kunne køre på en maskine uden skærm.
import Foundation

actor IngestWatcher {
    static let shared = IngestWatcher()

    private var opgave: Task<Void, Never>?
    /// Hvornår vi sidst SATTE noget i gang pr. konto. Uden den ville en kø der
    /// tager fem minutter at dræne, udløse fem opstarter.
    private var sidstStartet: [String: Date] = [:]
    private let karantaene: TimeInterval = 300

    func start() {
        guard opgave == nil else { return }
        opgave = Task { [weak self] in
            while !Task.isCancelled {
                await self?.runde()
                // 60s. Langsommere end vinduets 15s, fordi det her kører altid:
                // et minuts ekstra ventetid koster ingenting, en poll hvert 15.
                // sekund døgnet rundt koster batteri for ingenting.
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
            }
        }
    }

    func stop() { opgave?.cancel(); opgave = nil }

    /// Ét gennemløb: for hver konto, spørg motoren om der venter arbejde uden
    /// at nogen har taget det, og åbn i så fald en session.
    @discardableResult
    func runde() async -> [String] {
        guard TenantStore.harNoegle else { return [] }
        var startede: [String] = []
        for konto in TenantStore.kontoer {
            guard let status = try? await IngestClient.status(tenant: konto.slug) else { continue }
            // Venter der intet, eller har nogen ALLEREDE taget det, er der
            // intet at gøre. `workers` er en måling af hvem der arbejder —
            // ikke et flag om hvem der burde.
            guard status.waiting > 0, status.workers.isEmpty else { continue }
            if let sidst = sidstStartet[konto.slug],
               Date().timeIntervalSince(sidst) < karantaene { continue }
            sidstStartet[konto.slug] = Date()
            let udfald = SessionSpawner.startIngest(tenant: konto.slug)
            // Logger BÅDE succes og fejl. En vagt der kun logger når den
            // lykkes, kan ikke skelnes fra en der aldrig kørte.
            await EventLog.shared.log(kind: udfald.erOk ? "ingest_session_spawn" : "ingest_session_spawn_failed")
            print("[watcher] \(konto.slug): \(udfald)")
            startede.append("\(konto.slug): \(udfald)")
        }
        return startede
    }
}
