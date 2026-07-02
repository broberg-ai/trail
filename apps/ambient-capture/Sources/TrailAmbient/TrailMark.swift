// F201.3 — the Trail mark, drawn programmatically (one source, no bundled
// SVG rasterizer). Same three concentric circles as the admin TopNav logo +
// favicon.svg: outer ring, faint mid ring, filled accent core (#e8a87c).
//
// Menubar state encoding:
//   capturing → accent core FILLED (the "recording" tell)
//   paused    → accent core as an OUTLINE (nothing being written)
//
// Menubar theming (Christian 2026-07-02, the Web Clipper pattern): the ring
// must INVERT with the menubar appearance — dark ink on a light menubar,
// light on a dark one — while the orange core stays orange. A template
// image would flatten the core to one tint, so instead the menubar image
// uses NSImage's drawingHandler, which re-executes at RENDER time under the
// menubar's effective appearance: labelColor resolves correctly per theme.
// (The first version froze labelColor at build time via lockFocus — on a
// dark menubar the ring rendered near-invisible. That was the "jeg kan
// ikke se et menubar ikon" bug.)
import AppKit

enum TrailMark {
    /// Trail accent — #e8a87c, the brand core colour.
    static let accent = NSColor(red: 0xE8/255.0, green: 0xA8/255.0, blue: 0x7C/255.0, alpha: 1)

    /// Draw the mark into `bounds` of the CURRENT graphics context.
    /// `ringColor` resolves against the context's appearance when it is a
    /// dynamic colour (labelColor) — that is what makes the menubar variant
    /// invert per theme.
    static func draw(in bounds: NSRect, filled: Bool, ringColor: NSColor) {
        let s = min(bounds.width, bounds.height) / 32.0
        func rect(cx: CGFloat, cy: CGFloat, r: CGFloat) -> NSRect {
            NSRect(
                x: bounds.minX + (cx - r) * s,
                y: bounds.minY + (cy - r) * s,
                width: r * 2 * s,
                height: r * 2 * s
            )
        }

        // Outer ring (stroke-width 2), inset so the stroke stays inside.
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
    }

    /// Static render at `size` px with a FIXED ring colour — for the app
    /// icon, where the tile background is known and never changes theme.
    static func image(size: CGFloat, filled: Bool, ringColor: NSColor) -> NSImage {
        let img = NSImage(size: NSSize(width: size, height: size))
        img.lockFocus()
        draw(in: NSRect(x: 0, y: 0, width: size, height: size), filled: filled, ringColor: ringColor)
        img.unlockFocus()
        return img
    }

    /// Menubar drawing size — the menubar's full usable glyph height
    /// (22 pt; the bar itself is 24). Christian 2026-07-02: "brug max
    /// størrelsen" — 18 px drowned next to neighbouring items.
    static let menubarSize: CGFloat = 22

    /// Menubar status-item image. The drawing handler runs every time
    /// AppKit renders the image, under the menubar's appearance, so
    /// labelColor inverts with the theme (Web Clipper pattern) while the
    /// accent core stays orange. Non-template on purpose — a template
    /// would flatten the orange core to the tint colour.
    static func menubarImage(filled: Bool) -> NSImage {
        let img = NSImage(size: NSSize(width: menubarSize, height: menubarSize), flipped: false) { bounds in
            draw(in: bounds, filled: filled, ringColor: .labelColor)
            return true
        }
        img.isTemplate = false
        return img
    }
}
