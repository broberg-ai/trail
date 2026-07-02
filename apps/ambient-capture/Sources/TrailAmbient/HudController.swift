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
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 120),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let host = NSHostingView(rootView: HudView(model: model, onClose: { [weak self] in self?.hide() }))
        host.frame = panel.contentView?.bounds ?? .zero
        host.autoresizingMask = [.width, .height]
        panel.contentView?.addSubview(host)
        // Size the panel to the SwiftUI content.
        host.setFrameSize(host.fittingSize)
        panel.setContentSize(host.fittingSize)
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
