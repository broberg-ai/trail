// F201.9 — off-screen HUD render for design iteration. `--previewhud <dir>`
// rasterizes the panel (empty, search-results, and chat-answer states) to
// PNGs via SwiftUI ImageRenderer — no Screen Recording permission needed, so
// the look can be checked + tuned before shipping.
import SwiftUI
import AppKit

@MainActor
enum HudPreview {
    static func render(toDir dir: String) -> Never {
        let base = URL(fileURLWithPath: dir)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)

        // Empty search state.
        write(model: HudModel(), name: "hud-empty", to: base)

        // Search results.
        let searchModel = HudModel()
        searchModel.mode = .search
        searchModel.query = "Acme"
        searchModel.ran = true
        searchModel.hits = [
            NeuronHit(id: "1", title: "Acme — pricing-samtale", path: "/neurons/entities/", filename: "acme-pricing.md",
                      highlight: "Kunden var <mark>nervøs for levering</mark>; aftalt at vende tilbage torsdag med et revideret tilbud."),
            NeuronHit(id: "2", title: "Arbejdssession 14:20 — Acme CRM", path: "/neurons/sessions/", filename: "session-1420.md",
                      highlight: "Gennemgik <mark>Acme</mark>-dealen i CRM; noterede rabat-ønske på 10%."),
            NeuronHit(id: "3", title: "Beslutning: månedlig plan", path: "/neurons/decisions/", filename: "monthly-plan.md",
                      highlight: "Vi valgte den <mark>månedlige</mark> plan i stedet for årlig fakturering."),
        ]
        write(model: searchModel, name: "hud-search", to: base)

        // Chat answer.
        let chatModel = HudModel()
        chatModel.mode = .ask
        chatModel.query = "Hvad lovede jeg Acme?"
        chatModel.ran = true
        chatModel.answer = ChatAnswer(
            answer: "Du lovede Acme at vende tilbage torsdag med et revideret tilbud, der adresserer deres bekymring om levering. De bad også om 10% rabat, som endnu ikke er bekræftet.",
            citations: [
                Citation(id: "1", path: "/neurons/entities/", filename: "acme-pricing.md"),
                Citation(id: "2", path: "/neurons/sessions/", filename: "session-1420.md"),
            ]
        )
        write(model: chatModel, name: "hud-chat", to: base)

        print("HUDPREVIEW wrote 3 states to \(base.path)")
        exit(0)
    }

    private static func write(model: HudModel, name: String, to base: URL) {
        let view = HudView(model: model, onClose: {}, previewText: model.query)
            .frame(width: 688)
            .background(Color(red: 0.16, green: 0.15, blue: 0.14)) // desktop-ish backdrop
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let img = renderer.nsImage,
              let tiff = img.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: base.appendingPathComponent("\(name).png"))
    }
}
