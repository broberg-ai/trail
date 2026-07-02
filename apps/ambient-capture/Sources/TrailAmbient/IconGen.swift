// F201.3 — app-icon generator. Draws the Trail mark on a rounded, warm
// off-white tile (macOS app-icon convention) at every iconset size and
// writes PNGs into <dir>/AppIcon.iconset; bundle.sh runs `iconutil` on it.
// Same TrailMark source as the menubar — one logo, no external assets.
import AppKit

enum IconGen {
    private static let sizes: [(px: Int, name: String)] = [
        (16, "icon_16x16"), (32, "icon_16x16@2x"),
        (32, "icon_32x32"), (64, "icon_32x32@2x"),
        (128, "icon_128x128"), (256, "icon_128x128@2x"),
        (256, "icon_256x256"), (512, "icon_256x256@2x"),
        (512, "icon_512x512"), (1024, "icon_512x512@2x"),
    ]

    static func write(toDir dir: String) {
        let iconset = URL(fileURLWithPath: dir).appendingPathComponent("AppIcon.iconset")
        try? FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
        for size in sizes {
            let img = tile(px: CGFloat(size.px))
            guard let tiff = img.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else { continue }
            try? png.write(to: iconset.appendingPathComponent("\(size.name).png"))
        }
        print("ICONGEN wrote \(sizes.count) sizes to \(iconset.path)")
        exit(0)
    }

    private static func tile(px: CGFloat) -> NSImage {
        let img = NSImage(size: NSSize(width: px, height: px))
        img.lockFocus()
        defer { img.unlockFocus() }

        // Warm off-white rounded tile (matches the Trail palette bg).
        let inset = px * 0.06
        let body = NSRect(x: inset, y: inset, width: px - inset * 2, height: px - inset * 2)
        let tilePath = NSBezierPath(roundedRect: body, xRadius: px * 0.22, yRadius: px * 0.22)
        NSColor(red: 0xFA/255.0, green: 0xF7/255.0, blue: 0xF3/255.0, alpha: 1).setFill()
        tilePath.fill()

        // Trail mark centred at ~64% of the tile, dark ink ring.
        let markSize = px * 0.64
        let mark = TrailMark.image(
            size: markSize,
            filled: true,
            ringColor: NSColor(red: 0x1A/255.0, green: 0x17/255.0, blue: 0x15/255.0, alpha: 1)
        )
        mark.draw(in: NSRect(x: (px - markSize) / 2, y: (px - markSize) / 2, width: markSize, height: markSize))
        return img
    }
}
