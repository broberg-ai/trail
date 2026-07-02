// F201.5 verification — `TrailAmbient --ocrtest`. Proves the parts of the
// screen-OCR path that DON'T need a human TCC grant: Vision recognizes text
// from an image, the delta-hash is stable for identical content and flips for
// different content, and it prints per-frame OCR cost (the CPU proxy the AC
// asks to be recorded). SCScreenshotManager itself (the actual frame grab)
// needs Screen Recording + a real window, so it's proven interactively; the
// recognizer + delta guard — the risky logic — are proven here, deterministic.
//
// The probe image is drawn with Core Graphics + Core Text (NOT NSImage/
// lockFocus, which hangs in a bare CLI with no window-server/app context).
import Foundation
import CoreGraphics
import CoreText

enum ScreenOCRTest {
    static func run() -> Never {
        let marker = "Trail Ambient OCR probe alpha bravo"
        let img1 = renderText(marker)
        let img2 = renderText("Something completely different here")

        let sem = DispatchSemaphore(value: 0)
        var ok = false
        Task.detached {
            ok = await evaluate(img1: img1, img2: img2)
            sem.signal()
        }
        sem.wait()
        exit(ok ? 0 : 1)
    }

    private static func evaluate(img1: CGImage, img2: CGImage) async -> Bool {
        let t0 = Date()
        let text = await ScreenWatcher.recognizeText(in: img1, maxChars: 4000)
        let ocrMs = Date().timeIntervalSince(t0) * 1000
        let lower = text.lowercased()
        let recognized = lower.contains("ambient") && lower.contains("probe") && lower.contains("trail")

        // Delta hash: identical image → identical hash (would static-skip);
        // different image → different hash (would OCR again).
        let h1 = ScreenWatcher.hash(img1)
        let deltaStable = h1 == ScreenWatcher.hash(img1)
        let deltaFlips = h1 != ScreenWatcher.hash(img2)

        print("OCRTEST recognized=\(recognized) delta_stable=\(deltaStable) delta_flips=\(deltaFlips) ocr_ms=\(Int(ocrMs))")
        print("OCRTEST text=\(text.replacingOccurrences(of: "\n", with: " ⏎ "))")
        let pass = recognized && deltaStable && deltaFlips
        print(pass ? "OCRTEST PASS" : "OCRTEST FAIL")
        return pass
    }

    /// Render a phrase to a white CGImage using Core Text — no app context.
    private static func renderText(_ text: String) -> CGImage {
        let w = 900, h = 220
        let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))

        let font = CTFontCreateWithName("Helvetica-Bold" as CFString, 52, nil)
        let attrs: [CFString: Any] = [
            kCTFontAttributeName: font,
            kCTForegroundColorAttributeName: CGColor(red: 0, green: 0, blue: 0, alpha: 1),
        ]
        let attr = CFAttributedStringCreate(nil, text as CFString, attrs as CFDictionary)!
        let line = CTLineCreateWithAttributedString(attr)
        ctx.textPosition = CGPoint(x: 30, y: 88)
        CTLineDraw(line, ctx)
        return ctx.makeImage()!
    }
}
