// F201.9 — the HUD content. A search field + Søg/Spørg mode toggle over the
// user's own Trail. Enter runs it; results are Neuron hits (Søg) or a
// synthesised answer + citations (Spørg). Clicking any result opens the
// Neuron in the browser. Trail palette: warm bg, #e8a87c accent.
import SwiftUI

@MainActor
final class HudModel: ObservableObject {
    enum Mode: String, CaseIterable { case search = "Søg", ask = "Spørg" }
    @Published var mode: Mode = .search
    @Published var query = ""
    @Published var loading = false
    @Published var hits: [NeuronHit] = []
    @Published var answer: ChatAnswer?
    @Published var ran = false

    func run() {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !loading else { return }
        loading = true; ran = true; hits = []; answer = nil
        let mode = self.mode
        Task {
            do {
                if mode == .search {
                    let r = try await TrailClient.search(q)
                    await MainActor.run { self.hits = r; self.loading = false }
                } else {
                    let a = try await TrailClient.chat(q)
                    await MainActor.run { self.answer = a; self.loading = false }
                }
            } catch {
                await MainActor.run { self.loading = false }
            }
        }
    }

    func reset() { query = ""; hits = []; answer = nil; ran = false; loading = false }
}

struct HudView: View {
    @ObservedObject var model: HudModel
    var onClose: () -> Void
    @FocusState private var fieldFocused: Bool

    private let accent = Color(red: 0xE8/255.0, green: 0xA8/255.0, blue: 0x7C/255.0)

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.white.opacity(0.08))
            content
        }
        .frame(width: 560)
        .background(Color(red: 0.10, green: 0.09, blue: 0.08))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.10), lineWidth: 1))
        .onAppear { fieldFocused = true }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Circle().stroke(accent, lineWidth: 2).frame(width: 15, height: 15)
                .overlay(Circle().fill(accent).frame(width: 5, height: 5))
            TextField(model.mode == .search ? "Søg i din Trail…" : "Spørg din Trail…", text: $model.query)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .foregroundColor(.white)
                .focused($fieldFocused)
                .onSubmit { model.run() }
            Picker("", selection: $model.mode) {
                ForEach(HudModel.Mode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(width: 130)
            .onChange(of: model.mode) { _ in model.hits = []; model.answer = nil; model.ran = false }
        }
        .padding(14)
    }

    @ViewBuilder private var content: some View {
        if model.loading {
            row { ProgressView().controlSize(.small); Text("Slår op…").foregroundColor(.white.opacity(0.6)) }
        } else if model.mode == .search {
            if model.ran && model.hits.isEmpty {
                empty("Ingen Neuroner matcher.")
            } else {
                ScrollView { LazyVStack(spacing: 6) {
                    ForEach(model.hits) { hit in hitRow(hit) }
                }.padding(10) }.frame(maxHeight: 380)
            }
        } else {
            if let a = model.answer {
                ScrollView { VStack(alignment: .leading, spacing: 12) {
                    Text(a.answer).foregroundColor(.white).font(.system(size: 14)).textSelection(.enabled)
                    if !a.citations.isEmpty {
                        Text("Kilder").font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(0.5))
                        ForEach(a.citations) { c in citationRow(c) }
                    }
                }.padding(14) }.frame(maxHeight: 400)
            } else if model.ran {
                empty("Intet svar.")
            } else {
                empty("Tryk Enter for at spørge.")
            }
        }
    }

    private func hitRow(_ hit: NeuronHit) -> some View {
        Button { open(slug: hit.slug); onClose() } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(hit.title).foregroundColor(.white).font(.system(size: 14, weight: .medium)).lineLimit(1)
                    Spacer()
                    Text(hit.path).foregroundColor(.white.opacity(0.35)).font(.system(size: 10, design: .monospaced)).lineLimit(1)
                }
                if !hit.highlight.isEmpty {
                    Text(stripMarks(hit.highlight)).foregroundColor(.white.opacity(0.6)).font(.system(size: 12)).lineLimit(2)
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.04)).cornerRadius(8)
        }.buttonStyle(.plain)
    }

    private func citationRow(_ c: Citation) -> some View {
        Button { open(slug: c.slug); onClose() } label: {
            HStack(spacing: 6) {
                Image(systemName: "doc.text").foregroundColor(accent).font(.system(size: 11))
                Text(c.filename).foregroundColor(accent).font(.system(size: 12)).lineLimit(1)
                Spacer()
            }.padding(.vertical, 4)
        }.buttonStyle(.plain)
    }

    private func empty(_ s: String) -> some View {
        row { Text(s).foregroundColor(.white.opacity(0.4)).font(.system(size: 13)) }
    }

    private func row<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        HStack(spacing: 8) { c() }.padding(20).frame(maxWidth: .infinity, alignment: .center)
    }

    private func open(slug: String) { if let u = TrailClient.neuronURL(slug: slug) { NSWorkspace.shared.open(u) } }
    private func stripMarks(_ s: String) -> String {
        s.replacingOccurrences(of: "<mark>", with: "").replacingOccurrences(of: "</mark>", with: "")
    }
}
