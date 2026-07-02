// F201.3 — the Trail mark, drawn programmatically (one source, no bundled
// SVG rasterizer). Same three concentric circles as the admin TopNav logo +
// favicon.svg: outer ring, faint mid ring, filled accent core (#e8a87c).
//
// Menubar state encoding:
//   capturing → accent core FILLED (the "recording" tell)
//   paused    → accent core as an OUTLINE (nothing being written)
import AppKit

enum TrailMark {
    /// Trail accent — #e8a87c, the brand core colour.
    static let accent = NSColor(red: 0xE8/255.0, green: 0xA8/255.0, blue: 0x7C/255.0, alpha: 1)

    /// Render the mark at `size` px. `ringColor` lets the menubar use the
    /// theme-adaptive label colour while the app icon uses the brand ink.
    static func image(size: CGFloat, filled: Bool, ringColor: NSColor) -> NSImage {
        let img = NSImage(size: NSSize(width: size, height: size))
        img.lockFocus()
        defer { img.unlockFocus() }

        // viewBox 0 0 32 32 scaled to `size`.
        let s = size / 32.0
        func rect(cx: CGFloat, cy: CGFloat, r: CGFloat) -> NSRect {
            NSRect(x: (cx - r) * s, y: (cy - r) * s, width: r * 2 * s, height: r * 2 * s)
        }

        // Outer ring (stroke-width 2).
        let outer = NSBezierPath(ovalIn: rect(cx: 16, cy: 16, r: 14).insetBy(dx: s, dy: s))
        outer.lineWidth = 2 * s
        ringColor.setStroke()
        outer.stroke()

        // Faint mid ring.
        let mid = NSBezierPath(ovalIn: rect(cx: 16, cy: 16, r: 9))
        mid.lineWidth = 0.9 * s
        accent.withAlphaComponent(0.55).setStroke()
        mid.stroke()

        // Accent core — filled (capturing) or outline (paused).
        let core = NSBezierPath(ovalIn: rect(cx: 16, cy: 16, r: 3.5))
        if filled {
            accent.setFill()
            core.fill()
        } else {
            core.lineWidth = 1.4 * s
            accent.setStroke()
            core.stroke()
        }
        return img
    }

    /// Menubar status-item image: theme-adaptive ring, ~18px, non-template
    /// so the orange core survives (a template would flatten it to one tint).
    static func menubarImage(filled: Bool) -> NSImage {
        let img = image(size: 18, filled: filled, ringColor: .labelColor)
        img.isTemplate = false
        return img
    }
}
