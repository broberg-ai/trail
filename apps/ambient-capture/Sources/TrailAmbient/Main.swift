// F201.3 — entry point. Accessory activation policy = no Dock icon, no
// app switcher entry; presence lives in the menubar status item (Christian's
// 2026-07-02 decision — the item doubles as the privacy recording-indicator).
import AppKit

@main
@MainActor
struct TrailAmbientMain {
    static func main() {
        if CommandLine.arguments.contains("--selftest") {
            SelfTest.run()
        }
        if CommandLine.arguments.contains("--ocrtest") {
            ScreenOCRTest.run()
        }
        if CommandLine.arguments.contains("--audiotest") {
            AudioTest.run()
        }
        if CommandLine.arguments.contains("--sttest") {
            SttTest.run()
        }
        if CommandLine.arguments.contains("--speechtest") {
            SpeechTest.run()
        }
        if CommandLine.arguments.contains("--neuraltest") {
            NeuralSpeakerTest.run()
        }
        if CommandLine.arguments.contains("--dicttest") {
            DictTest.run()
        }
        if let i = CommandLine.arguments.firstIndex(of: "--enginetrigger") {
            let t = CommandLine.arguments.count > i + 1 ? CommandLine.arguments[i + 1] : "broberg-ai"
            let sess = CommandLine.arguments.count > i + 2 ? CommandLine.arguments[i + 2] : "trail"
            EngineTest.trigger(tenant: t, session: sess); exit(0)
        }
        if CommandLine.arguments.contains("--enginetoggletest") {
            EngineTest.toggle(); exit(0)
        }
        // F263.8 — sæt den personlige nøgle uden at den nogensinde står i argv.
        // `ps` viser argumenter til enhver bruger på maskinen; stdin gør ikke.
        if CommandLine.arguments.contains("--setkey") {
            guard let linje = readLine(strippingNewline: true)?
                    .trimmingCharacters(in: .whitespacesAndNewlines), !linje.isEmpty else {
                print("SETKEY: ingen nøgle på stdin"); exit(1)
            }
            TenantStore.personligNoegle = linje
            let gemt = TenantStore.personligNoegle
            // Læs den TILBAGE frem for at melde succes på at kaldet ikke fejlede.
            print(gemt == linje ? "SETKEY OK (\(linje.prefix(6))… \(linje.count) tegn)" : "SETKEY FEJL: nøglen kunne ikke læses tilbage")
            exit(gemt == linje ? 0 : 1)
        }
        // F263.8 — måleren. Siger HVAD der gik galt frem for at give en tom
        // liste, som ikke kan skelnes fra «du har ingen konti».
        if CommandLine.arguments.contains("--tenantsprobe") {
            print("harNoegle=\(TenantStore.harNoegle)")
            Task {
                do {
                    let liste = try await IngestClient.tenants()
                    print("TENANTSPROBE OK \(liste.count): \(liste.map(\.slug).joined(separator: ", "))")
                    TenantStore.gemKontoer(liste)
                    print("gemt=\(TenantStore.kontoer.map(\.slug).joined(separator: ", ")) aktiv=\(TenantStore.aktivSlug ?? "-")")
                    exit(0)
                } catch {
                    print("TENANTSPROBE FEJL: \(error.localizedDescription)")
                    exit(1)
                }
            }
            RunLoop.main.run()
        }
        if CommandLine.arguments.contains("--tenanttest") {
            TenantTest.run(); exit(0)
        }
        if CommandLine.arguments.contains("--enginetest") {
            EngineTest.run(); exit(0)
        }
        if CommandLine.arguments.contains("--minetest") {
            MineTool.runTest()
        }
        if CommandLine.arguments.contains("--transcribefile") {
            TranscribeFileTest.run()
        }
        if CommandLine.arguments.contains("--mine") {
            MineTool.run()
        }
        if let i = CommandLine.arguments.firstIndex(of: "--loginitem"),
           i + 1 < CommandLine.arguments.count {
            LoginItem.runCLI(CommandLine.arguments[i + 1])
        }
        if let i = CommandLine.arguments.firstIndex(of: "--genicon"),
           i + 1 < CommandLine.arguments.count {
            IconGen.write(toDir: CommandLine.arguments[i + 1])
        }
        if let i = CommandLine.arguments.firstIndex(of: "--previewhud"),
           i + 1 < CommandLine.arguments.count {
            HudPreview.render(toDir: CommandLine.arguments[i + 1])
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
