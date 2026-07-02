// F201.3 verification — headless proof of the pause gate, invoked with
// `TrailAmbient --selftest`. macOS TCC (Accessibility, Screen Recording)
// requires a human to approve prompts in System Settings, so the menubar
// render, window-title capture, and menu-driven pause can only be verified
// interactively. This gate — "a paused watcher emits zero events, a running
// one emits" — is the part we CAN prove deterministically, no clicks.
import AppKit

@MainActor
enum SelfTest {
    static func run() -> Never {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/TrailAmbient", isDirectory: true)
        let logURL = dir.appendingPathComponent("focus.jsonl")
        try? FileManager.default.removeItem(at: logURL)

        let watcher = FocusWatcher()

        // Paused → activation must be ignored.
        watcher.paused = true
        watcher.simulateActivation(name: "PausedApp")
        pump(0.5)

        // Resumed → activation must be captured.
        watcher.paused = false
        watcher.simulateActivation(name: "ResumedApp")
        pump(0.5)

        let contents = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
        let sawPaused = contents.contains("\"app\":\"PausedApp\"")
        let sawResumed = contents.contains("\"app\":\"ResumedApp\"")

        // Menubar icon must render VISIBLE pixels under BOTH themes — the
        // v1 icon froze labelColor at build time and vanished on a dark
        // menubar (Christian: "jeg kan ikke se et menubar ikon").
        let lightPx = visiblePixels(appearance: .aqua)
        let darkPx = visiblePixels(appearance: .darkAqua)

        print("SELFTEST paused_emitted=\(sawPaused) resumed_emitted=\(sawResumed) icon_light_px=\(lightPx) icon_dark_px=\(darkPx)")
        let ok = !sawPaused && sawResumed && lightPx > 40 && darkPx > 40
        print(ok ? "SELFTEST PASS" : "SELFTEST FAIL")
        exit(ok ? 0 : 1)
    }

    /// Rasterize the menubar icon under a given appearance and count pixels
    /// that are meaningfully visible against that theme's menubar: alpha'd
    /// AND contrasting (dark theme → light pixels, light theme → dark ones).
    private static func visiblePixels(appearance name: NSAppearance.Name) -> Int {
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: 22, pixelsHigh: 22, bitsPerSample: 8,
            samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { return 0 }
        let img = TrailMark.menubarImage(filled: true)
        var count = 0
        NSAppearance(named: name)?.performAsCurrentDrawingAppearance {
            guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return }
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = ctx
            img.draw(in: NSRect(x: 0, y: 0, width: 22, height: 22))
            NSGraphicsContext.restoreGraphicsState()
        }
        for x in 0..<22 {
            for y in 0..<22 {
                guard let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.5 else { continue }
                let luma = 0.299 * c.redComponent + 0.587 * c.greenComponent + 0.114 * c.blueComponent
                // Contrast against the menubar: light bar (~1.0) needs dark
                // pixels, dark bar (~0.1) needs light ones. Orange core
                // (luma ≈ 0.7) counts as visible on both.
                if name == .darkAqua ? luma > 0.45 : luma < 0.75 { count += 1 }
            }
        }
        return count
    }

    /// Spin the run loop so the watcher's debounce Timer can fire.
    private static func pump(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }
}
