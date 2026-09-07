// F263.7 — Ingest-fladen inde i menulinje-appen.
//
// Web-fladen (apps/ingest-station) oversat til Mac-idiomer, efter den
// godkendte mockup: segmenteret knap i stedet for web-faner, videnbasen som
// pull-down i værktøjslinjen, og en statuslinje i bunden der navngiver
// MOTOREN. Trails palet er uændret — det er mekanikken der bliver Apple.
//
// TO TING DER IKKE ER PYNT:
//
//  1. STATUSLINJEN. Hele F263 handler om hvem der kompilerer og hvad det
//     koster. Det skal STÅ på fladen, ikke gættes ud fra at det går hurtigt.
//  2. EN TOM LISTE OG EN FEJLET FORESPØRGSEL SER ENS UD. Derfor har modellen
//     en `fejl`-tilstand ved siden af `kilder`, og fladen viser fejlen frem
//     for at tegne «ingen kilder». Det er husets gennemgående fejlform, og
//     den er billig at undgå her.
import SwiftUI
import AppKit
import UniformTypeIdentifiers

@MainActor
final class IngestModel: ObservableObject {
    @Published var kbs: [KnowledgeBaseRef] = []
    @Published var valgtKb: String = UserDefaults.standard.string(forKey: "trail.kbId") ?? ""
    @Published var kilder: [IngestSource] = []
    @Published var status: CompileStatus = .tom
    @Published var fejl: String?
    @Published var uploaderAntal: Int = 0
    @Published var fane: Fane = .koe
    @Published var harHentet = false

    enum Fane: Hashable { case koe, faerdig }

    var iKoe: [IngestSource] { kilder.filter { $0.erIKoe } }
    var faerdige: [IngestSource] { kilder.filter { !$0.erIKoe } }

    /// Navnet på den valgte videnbase — til vinduets undertitel.
    var kbNavn: String { kbs.first { $0.id == valgtKb }?.name ?? TrailClient.cachedKbName }

    func hentAlt() async {
        await hentKbs()
        await opdater()
    }

    private func hentKbs() async {
        do {
            let r = try await IngestClient.knowledgeBases()
            kbs = r
            if valgtKb.isEmpty || !r.contains(where: { $0.id == valgtKb }) {
                valgtKb = r.first?.id ?? ""
            }
        } catch {
            fejl = error.localizedDescription
        }
    }

    func opdater() async {
        guard !valgtKb.isEmpty else { harHentet = true; return }
        do {
            async let k = IngestClient.sources(kbId: valgtKb)
            async let s = IngestClient.status()
            kilder = try await k
            status = try await s
            fejl = nil
        } catch {
            // Sæt IKKE kilder = [] her. En tom liste efter en fejl er præcis
            // det svar der ikke kan skelnes fra «der er ingen kilder».
            fejl = error.localizedDescription
        }
        harHentet = true
    }

    func upload(_ urls: [URL]) async {
        guard !valgtKb.isEmpty else { return }
        uploaderAntal += urls.count
        defer { uploaderAntal = max(0, uploaderAntal - urls.count) }
        for u in urls {
            do { _ = try await IngestClient.upload(kbId: valgtKb, fileURL: u) }
            catch { fejl = "\(u.lastPathComponent): \(error.localizedDescription)" }
        }
        await opdater()
    }
}

// MARK: - Palet (Trails egen, ikke systemets)

private extension Color {
    static let tCream = Color(red: 0.980, green: 0.976, blue: 0.961)
    static let tInk   = Color(red: 0.102, green: 0.090, blue: 0.082)
    static let tMuted = Color(red: 0.541, green: 0.506, blue: 0.459)
    static let tLine  = Color(red: 0.906, green: 0.886, blue: 0.847)
    static let tAcc   = Color(red: 0.722, green: 0.463, blue: 0.180)
    static let tOk    = Color(red: 0.290, green: 0.486, blue: 0.349)
    static let tErr   = Color(red: 0.702, green: 0.329, blue: 0.247)
}

// MARK: - Vinduet

struct IngestView: View {
    @ObservedObject var model: IngestModel
    @State private var slipper = false

    var body: some View {
        VStack(spacing: 0) {
            vaerktoejslinje
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let f = model.fejl { fejlbanner(f) }
                    dropfelt
                    faneVaelger
                    liste
                }
                .padding(18)
            }
            .background(Color.tCream)
            Divider()
            statuslinje
        }
        .frame(minWidth: 620, minHeight: 520)
        .background(Color.tCream)
        .task { await model.hentAlt() }
    }

    // MARK: Værktøjslinje

    private var vaerktoejslinje: some View {
        HStack(spacing: 10) {
            Text(S.ingestWindowTitle).font(.system(size: 13, weight: .semibold))
            Spacer()
            if model.kbs.count > 1 {
                Picker("", selection: Binding(
                    get: { model.valgtKb },
                    set: { ny in
                        model.valgtKb = ny
                        UserDefaults.standard.set(ny, forKey: "trail.kbId")
                        Task { await model.opdater() }
                    })) {
                    ForEach(model.kbs) { kb in Text(kb.name).tag(kb.id) }
                }
                .labelsHidden()
                .frame(maxWidth: 200)
                .accessibilityIdentifier("ingest-kb-picker")
            } else if !model.kbNavn.isEmpty {
                Text(model.kbNavn).font(.system(size: 12)).foregroundColor(.tMuted)
            }
            Button { Task { await model.opdater() } } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help(S.ingestRetry)
            .accessibilityIdentifier("ingest-refresh")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: Drop-felt

    private var dropfelt: some View {
        VStack(spacing: 6) {
            Image(systemName: "arrow.up.doc")
                .font(.system(size: 26, weight: .light))
                .foregroundColor(.tInk.opacity(0.45))
            Text(slipper ? "\(S.ingestUploading)…" : S.ingestDropTitle)
                .font(.system(size: 13, weight: .semibold))
            Text(S.ingestAccepted)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(.tMuted)
            if model.uploaderAntal > 0 {
                Text("\(S.ingestUploading) \(model.uploaderAntal)…")
                    .font(.system(size: 11)).foregroundColor(.tAcc)
            } else {
                Text(S.ingestDropHint).font(.system(size: 11.5)).foregroundColor(.tAcc)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                .foregroundColor(slipper ? .tAcc : .tLine)
        )
        .contentShape(Rectangle())
        .onTapGesture { vaelgFiler() }
        .onDrop(of: [.fileURL], isTargeted: $slipper) { udbydere in
            Task {
                var urls: [URL] = []
                for u in udbydere {
                    if let item = try? await u.loadItem(forTypeIdentifier: UTType.fileURL.identifier),
                       let d = item as? Data,
                       let url = URL(dataRepresentation: d, relativeTo: nil) { urls.append(url) }
                }
                if !urls.isEmpty { await model.upload(urls) }
            }
            return true
        }
        .accessibilityIdentifier("ingest-dropzone")
    }

    private func vaelgFiler() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        if panel.runModal() == .OK {
            let urls = panel.urls
            Task { await model.upload(urls) }
        }
    }

    // MARK: Faner

    private var faneVaelger: some View {
        Picker("", selection: $model.fane) {
            Text("\(S.ingestTabQueue) \(model.iKoe.count)").tag(IngestModel.Fane.koe)
            Text("\(S.ingestTabDone) \(model.faerdige.count)").tag(IngestModel.Fane.faerdig)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: 260)
        .accessibilityIdentifier("ingest-tabs")
    }

    // MARK: Liste

    private var liste: some View {
        let raekker = model.fane == .koe ? model.iKoe : model.faerdige
        return VStack(spacing: 0) {
            if raekker.isEmpty {
                Text(model.fane == .koe ? S.ingestEmptyQueue : S.ingestEmptyDone)
                    .font(.system(size: 12)).foregroundColor(.tMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 18).padding(.horizontal, 12)
            } else {
                ForEach(Array(raekker.enumerated()), id: \.element.id) { i, k in
                    raekke(k)
                    if i < raekker.count - 1 { Divider().background(Color.tLine) }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Color.tLine))
        .accessibilityIdentifier("ingest-source-list")
    }

    private func raekke(_ k: IngestSource) -> some View {
        HStack(spacing: 10) {
            Text(k.fileType.uppercased())
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .foregroundColor(.tMuted)
                .frame(width: 38, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(k.visningsnavn).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
                if let s = undertekst(k) {
                    Text(s).font(.system(size: 11)).foregroundColor(.tMuted).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            maerkat(k)
        }
        .padding(.vertical, 9).padding(.horizontal, 12)
        .accessibilityIdentifier("ingest-source-row")
    }

    private func undertekst(_ k: IngestSource) -> String? {
        if k.erFejlet, let m = k.errorMessage { return m }
        if let p = k.pageCount, p > 0 { return "\(p) s." }
        return nil
    }

    private func maerkat(_ k: IngestSource) -> some View {
        let (tekst, farve): (String, Color) =
            k.erFejlet ? (S.ingestStateFailed, .tErr)
            : k.awaitingLocalCompile ? (S.ingestStateWaiting, .tMuted)
            : k.erIKoe ? (S.ingestStateCompiling, .tAcc)
            : ("\(k.neuronCount) \(S.ingestNeuronsSuffix)", .tOk)
        return Text(tekst)
            .font(.system(size: 10.5, weight: .medium))
            .foregroundColor(farve)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(farve.opacity(0.13)))
    }

    // MARK: Fejl + status

    private func fejlbanner(_ tekst: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(.tErr)
            Text(tekst).font(.system(size: 12)).foregroundColor(.tErr)
            Spacer()
            Button(S.ingestRetry) { Task { await model.opdater() } }
                .buttonStyle(.borderless).font(.system(size: 12))
                .accessibilityIdentifier("ingest-error-retry")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.tErr.opacity(0.07)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.tErr.opacity(0.3)))
        .accessibilityIdentifier("ingest-error")
    }

    /// Statuslinjen SIGER hvem der kompilerer. Den gætter ikke, og den påstår
    /// ikke «lokal» før en arbejder faktisk har taget et job — en tilsluttet
    /// maskine er ikke det samme som en maskine der arbejder (F263.4).
    private var statuslinje: some View {
        let arbejder = model.status.workers.first
        let (tekst, farve): (String, Color) =
            arbejder != nil ? ("\(S.ingestEngineThisMac) · \(arbejder!)", .tOk)
            : model.status.waiting > 0 ? (S.ingestEngineNobody, .tMuted)
            : (S.ingestEngineCloud, .tMuted)
        return HStack(spacing: 9) {
            Circle().fill(farve).frame(width: 7, height: 7)
            Text(tekst).font(.system(size: 12, weight: .medium))
            Spacer()
            if arbejder != nil {
                Text("$0")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundColor(.tOk)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 5).fill(Color.tOk.opacity(0.12)))
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Color(nsColor: .windowBackgroundColor))
        .accessibilityIdentifier("ingest-engine-status")
    }
}
