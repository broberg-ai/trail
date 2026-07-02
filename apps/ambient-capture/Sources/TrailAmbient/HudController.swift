// F201.9 — the floating HUD panel + global hotkey wiring. A borderless,
// non-activating panel that can still become key (so the search field takes
// keystrokes) without stealing focus from the call/app you're in. ⌃⌥T
// toggles it; Escape or clicking a result closes it.
import AppKit
import SwiftUI

/// NSPanel that accepts key focus despite being borderless — required for
/// the SwiftUI TextField to receive input.
final class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // A borderless, non-activating panel doesn't reliably get the Edit menu's
    // ⌘V routing (the app isn't fully active), so catch the standard editing
    // shortcuts here and forward them to the first responder (the SwiftUI
    // TextField's field editor). Belt-and-suspenders with the AppDelegate Edit
    // menu — this path works even when the app isn't the active app.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command {
            let sel: Selector?
            switch event.charactersIgnoringModifiers {
            case "v": sel = #selector(NSText.paste(_:))
            case "c": sel = #selector(NSText.copy(_:))
            case "x": sel = #selector(NSText.cut(_:))
            case "a": sel = #selector(NSText.selectAll(_:))
            case "z": sel = Selector(("undo:"))
            default:  sel = nil
            }
            if let sel, NSApp.sendAction(sel, to: nil, from: self) { return true }
        }
        return super.performKeyEquivalent(with: event)
    }
}

@MainActor
final class HudController {
    private var panel: KeyablePanel?
    private let model = HudModel()
    private var hotKey: HotKey?
    private var escMonitor: Any?

    init() {
        hotKey = HotKey { [weak self] in self?.toggle() }
    }

    func toggle() { (panel?.isVisible ?? false) ? hide() : show() }

    private func show() {
        guard DeviceAuth.loadToken() != nil else {
            // Not connected — nudge toward the menubar connect flow instead
            // of showing an empty HUD.
            NSSound.beep()
            return
        }
        model.reset()
        let panel = self.panel ?? makePanel()
        self.panel = panel
        center(panel)
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // Escape closes while the panel is up.
        escMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
            if e.keyCode == 53 { self?.hide(); return nil }
            return e
        }
    }

    private func hide() {
        panel?.orderOut(nil)
        if let m = escMonitor { NSEvent.removeMonitor(m); escMonitor = nil }
    }

    private func makePanel() -> KeyablePanel {
        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 688, height: 140),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // Let macOS draw the drop shadow on the panel. Because the panel is
        // non-opaque and the SwiftUI card is a rounded, opaque shape, the
        // shadow follows the rounded corners — a soft shadow, NOT the hard grey
        // rectangle we removed. (The card no longer draws its own .shadow().)
        panel.hasShadow = true
        // F201.9 fix — let the user drag the panel around by its background
        // (a borderless panel has no title bar, so this is the only drag affordance).
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        // NSHostingController auto-resizes the window to the SwiftUI content,
        // so the panel GROWS as results arrive instead of clipping them
        // (the "der sker ikke noget" bug — a fixed-size panel hid the hits).
        let controller = NSHostingController(rootView: HudView(model: model, onClose: { [weak self] in self?.hide() }))
        controller.sizingOptions = [.preferredContentSize]
        panel.contentViewController = controller
        // F201.9 fix — the SwiftUI card is a rounded rect, so its four corners
        // are transparent. Force the hosting view's backing clear so those
        // corners show the desktop, not a grey window backing (the "firkantede
        // grå ramme" Christian reported). This is what actually removes it.
        controller.view.wantsLayer = true
        controller.view.layer?.backgroundColor = NSColor.clear.cgColor
        return panel
    }

    private func center(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let f = panel.frame
        let x = screen.frame.midX - f.width / 2
        // Slightly above centre — where a launcher naturally sits.
        let y = screen.frame.midY + screen.frame.height * 0.12
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }
}
