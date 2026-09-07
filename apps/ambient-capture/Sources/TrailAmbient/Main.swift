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
