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

        let v = IngestNSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 680, height: 620),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        v.title = S.ingestWindowTitle
        v.titlebarAppearsTransparent = true
        v.isReleasedWhenClosed = false
        // F263.8 — VINDUET BLIVER STÅENDE TIL DU LUKKER DET.
        //
        // Ejeren 8/9, med skærmbillede: «hvordan skulle jeg ellers kunne komme
        // over i Finder og finde filer jeg kan trække IND i dialogen?»
        //
        // Målt: intet i koden lukkede vinduet. Appen er .accessory — menulinje,
        // intet Dock-ikon — så et klik i en anden app sendte vinduet BAGOM, og
        // der var ingen vej til at hente det frem igen. Fra brugerens stol er
        // «bagom uden vej tilbage» og «lukket» det samme, og et drop-felt man
        // ikke kan se mens man leder efter filen, er intet drop-felt.
        //
        // .floating holder det synligt mens man er i Finder. Det lukkes med
        // Escape, ⌘W eller den røde knap — ejerens eget forslag, og det rigtige:
        // et vindue der forsvinder af sig selv kan man ikke trække noget ind i.
        v.level = .floating
        // Følg med til det skrivebord man arbejder på, og læg dig over et
        // fuldskærms-vindue frem for at blive efterladt på et andet skrivebord.
        v.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        // Husk størrelse og placering mellem åbninger — man arbejder i det her
        // vindue, og et der hopper til midten hver gang er et man flytter hver gang.
        v.setFrameAutosaveName("trail-ingest-window")
        if v.frame.origin == .zero { v.center() }
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

/// Escape lukker vinduet. NSWindow sender `cancelOperation` op ad
/// responder-kæden når Escape trykkes; uden den her ender den som et bip.
final class IngestNSWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) { performClose(sender) }
    // Et vindue uden titellinje-fokus skal stadig kunne modtage tastetryk —
    // ellers ville Escape kun virke når et felt tilfældigvis havde fokus.
    override var canBecomeKey: Bool { true }
}

/// Vinduets delegate — holder styr på at pollingen stopper når det lukkes.
@MainActor
final class LukVagt: NSObject, NSWindowDelegate {
    static let delt = LukVagt()
    var vedLuk: (() -> Void)?
    func windowWillClose(_ notification: Notification) { vedLuk?() }
}
