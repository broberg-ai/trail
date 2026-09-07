// F263.7 — vinduet der bærer Ingest-fladen.
//
// Et ALMINDELIGT vindue, ikke HUD'ens svævende panel: man arbejder i det,
// trækker filer ind i det, og lader det stå åbent ved siden af andet arbejde.
// HUD'en er det modsatte — den skal kunne komme frem uden at tage fokus fra
// et opkald, og forsvinde igen på Escape.
//
// ÉN APP PÅ MACEN (ejerens ordre 7/9 2026). Derfor bor dette vindue i
// menulinje-appen der allerede findes, og genbruger dens parring og dens
// token i Keychain — ikke et program mere at installere, signere og opdatere.
import AppKit
import SwiftUI

@MainActor
final class IngestWindowController {
    private var vindue: NSWindow?
    private let model = IngestModel()
    private var opdaterTimer: Timer?

    /// Åbn vinduet (eller hæv det, hvis det allerede står åbent).
    func vis() {
        if let v = vindue {
            v.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            Task { await model.opdater() }
            startOpdatering()
            return
        }

        let v = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 680, height: 620),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        v.title = S.ingestWindowTitle
        v.titlebarAppearsTransparent = true
        v.isReleasedWhenClosed = false
        v.center()
        v.contentView = NSHostingView(rootView: IngestView(model: model))
        v.delegate = LukVagt.delt
        LukVagt.delt.vedLuk = { [weak self] in self?.stopOpdatering() }
        vindue = v

        v.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startOpdatering()
    }

    /// Hvor mange kilder venter — til tælleren på menupunktet.
    var venterAntal: Int { model.iKoe.count }

    /// Opdatér mens vinduet er FREMME, og kun da. En menulinje-app der poller
    /// et lukket vindue bruger strøm på noget ingen kan se.
    private func startOpdatering() {
        stopOpdatering()
        opdaterTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.vindue?.isVisible == true else { return }
                await self.model.opdater()
            }
        }
    }

    private func stopOpdatering() {
        opdaterTimer?.invalidate()
        opdaterTimer = nil
    }
}

/// Vinduets delegate — holder styr på at pollingen stopper når det lukkes.
@MainActor
final class LukVagt: NSObject, NSWindowDelegate {
    static let delt = LukVagt()
    var vedLuk: (() -> Void)?
    func windowWillClose(_ notification: Notification) { vedLuk?() }
}
