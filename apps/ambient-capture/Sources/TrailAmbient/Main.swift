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
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = AppDelegate()
        app.delegate = delegate
        app.run()
    }
}
