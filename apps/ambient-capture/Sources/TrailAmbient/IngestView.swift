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
    @Published var valgtKb: String =
        UserDefaults.standard.string(forKey: TenantStore.kbNoegle(for: TenantStore.aktivSlug)) ?? ""
    /// F263.8 — de konti Ambient faktisk har en nøgle til.
    @Published var kontoer: [ConnectedTenant] = TenantStore.kontoer
    @Published var aktivKonto: String = TenantStore.aktivSlug ?? ""
    @Published var kilder: [IngestSource] = []
    @Published var status: CompileStatus = .tom
    @Published var fejl: String?
    @Published var uploaderAntal: Int = 0
    @Published var fane: Fane = .koe
    @Published var harHentet = false
    /// Motorens tilstand LÆST fra buddy — ikke vores egen kopi.
    @Published var motor: EngineState = .ukendt("")
    @Published var motorSkifter = false

    enum Fane: Hashable { case koe, faerdig }

    var iKoe: [IngestSource] { kilder.filter { $0.erIKoe } }
    var faerdige: [IngestSource] { kilder.filter { !$0.erIKoe } }

    /// Navnet på den valgte videnbase — til vinduets undertitel.
    var kbNavn: String { kbs.first { $0.id == valgtKb }?.name ?? TrailClient.cachedKbName }

    func hentAlt() async {
        await hentKontoer()
        await hentKbs()
        await opdater()
        await opdaterMotor()
    }

    /// F263.8 — skift konto. Nøglen skiftes i TenantStore, og ALT hentes
    /// forfra fra API'et. Listen må aldrig blive stående fra den forrige
    /// konto: en kildeliste der hører til en anden kunde er værre end en tom.
    func skiftKonto(til slug: String) async {
        guard slug != aktivKonto else { return }
        TenantStore.aktivSlug = slug
        aktivKonto = slug
        kilder = []
        kbs = []
        status = .tom
        fejl = nil
        harHentet = false
        valgtKb = UserDefaults.standard.string(forKey: TenantStore.kbNoegle(for: slug)) ?? ""
        await hentAlt()
    }

    /// Hent konto-listen fra serveren — /api/v1/me/tenants, samme rute Web
    /// Clipper bruger. Fejler den, beholdes den forrige liste: en tom vælger
    /// og «du har ingen konti» ser ens ud, og kun den ene er sandt.
    func hentKontoer() async {
        guard TenantStore.harNoegle else { kontoer = []; aktivKonto = ""; return }
        do {
            let r = try await IngestClient.tenants()
            TenantStore.gemKontoer(r)
            genlaesKontoer()
            fejl = nil
        } catch {
            fejl = error.localizedDescription
        }
    }

    /// Læs den lokale cache igen (efter et skift eller en ny nøgle).
    func genlaesKontoer() {
        kontoer = TenantStore.kontoer
        aktivKonto = TenantStore.aktivSlug ?? ""
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

    /// Sidste tilstand vi FAKTISK har målt, og hvornår.
    private var sidstKendt: EngineState?
    private var sidstMaalt: Date?
    private var fejlIStribe = 0

    /// ÉT fejlet opslag er ikke en måling af at motoren er slukket.
    ///
    /// Målt 8/9 på ejerens Mac: buddys dæmon taber ca. hver ottende forbindelse
    /// på 127.0.0.1:4123 (7 af 8 svarede under 0,01s, én droppede). Appen
    /// spørger hvert 15. sekund, så statuslinjen skiftede tilstand flere gange
    /// i timen — uden at noget som helst havde ændret sig.
    ///
    /// Nu beholdes den sidst målte tilstand, og fejlen står som en NOTE i
    /// stedet for at overskrive svaret. Først efter tre fejl i træk (45
    /// sekunder) opgiver vi og siger ukendt — for da er det sandsynligvis
    /// dæmonen der er nede, og dét er værd at vide.
    func opdaterMotor() async {
        let ny = await EngineState.hent()
        if case .ukendt = ny {
            fejlIStribe += 1
            if fejlIStribe < 3, let kendt = sidstKendt {
                motor = kendt
                return
            }
            motor = ny
            return
        }
        fejlIStribe = 0
        sidstKendt = ny
        sidstMaalt = Date()
        motor = ny
    }

    /// «for 20s siden» — kun når det sidste opslag fejlede, så et tal på
    /// skærmen aldrig kan forveksles med en frisk måling.
    var motorAlder: Int? {
        guard fejlIStribe > 0, let t = sidstMaalt else { return nil }
        return max(0, Int(Date().timeIntervalSince(t)))
    }

    /// Slå den lokale motor til/fra. Skriver til buddys job og LÆSER tilstanden
    /// tilbage bagefter — knappen viser aldrig sit eget ønske som et faktum.
    func skiftMotor(til paa: Bool) async {
        motorSkifter = true
        defer { motorSkifter = false }
        if let f = await EngineControl.setEnabled(paa) { fejl = f }
        await opdaterMotor()
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

    /// Indsat tekst gemmes som en .md-fil og lægges op ad NØJAGTIG samme vej
    /// som en droppet fil. Ingen anden skrivevej: to veje ind i basen er to
    /// steder kontrakten skal rettes, og den ene bliver glemt.
    func indsaet(titel: String, tekst: String) async {
        let rent = tekst.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rent.isEmpty else { return }
        let t = titel.trimmingCharacters(in: .whitespacesAndNewlines)
        // Tidsstemplet i filnavnet gør en indsat note umulig at forveksle med
        // en dublet — web-fladen gør det samme, af samme grund.
        let stempel = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let base = t.isEmpty ? "note-\(stempel)" : "\(sikkertNavn(t))-\(stempel)"
        let krop = t.isEmpty ? rent : "# \(t)\n\n\(rent)"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(base).md")
        do { try krop.write(to: url, atomically: true, encoding: .utf8) }
        catch { fejl = error.localizedDescription; return }
        defer { try? FileManager.default.removeItem(at: url) }
        await upload([url])
    }

    private func sikkertNavn(_ s: String) -> String {
        let tilladt = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let r = s.unicodeScalars.map { tilladt.contains($0) ? Character($0) : "-" }
        return String(String(r).prefix(60))
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
        // F263.3 — «der ligger arbejde NU». Uden den ville en kilde man lige
        // har sluppet ligge op til 120 sekunder før buddys probe opdager den.
        // Proben bliver stående som sikkerhedsnet: de to gør ikke det samme.
        if case .til = motor, let slug = tenantSlug() {
            if let f = await EngineControl.triggerNow(tenant: slug) { fejl = f }
        }
        await opdaterMotor()
    }

    /// Kundens slug — buddys jobs er navngivet med den, ikke med et id.
    private func tenantSlug() -> String? {
        guard let t = DeviceAuth.gemtTenant?.lowercased(), !t.isEmpty else { return nil }
        return t
    }
}

// MARK: - Farver
//
// Ingest-vinduet bruger APPENS palet (Palette i HudView.swift), ikke sin egen.
// Første udgave havde sin egen lyse cremefarvede kopi, fordi mockuppen var
// tegnet lys — og så stod vinduet lyst inde i en app hvis HUD er mørk. Ejeren
// så det på første skærmbillede. To paletter i ét program er to steder en
// farve skal rettes.

// MARK: - Vinduet

struct IngestView: View {
    @ObservedObject var model: IngestModel
    @State private var slipper = false
    @State private var viserIndsaet = false
    @State private var viserNoegle = false
    @State private var noegleUdkast = ""
    @State private var indsaetTitel = ""
    @State private var indsaetTekst = ""

    var body: some View {
        VStack(spacing: 0) {
            vaerktoejslinje
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let f = model.fejl { fejlbanner(f) }
                    dropfelt
                    HStack { Spacer(); indsaetKnap; Spacer() }
                    faneVaelger
                    liste
                }
                .padding(18)
            }
            .background(indholdsBaggrund)
            Divider().background(Palette.hairline)
            statuslinje
        }
        .frame(minWidth: 620, minHeight: 520)
        .background(indholdsBaggrund)
        // F263.7 — MØRK TILSTAND GJORDE HALVDELEN AF TEKSTEN USYNLIG.
        // Ejeren så det med det samme på det første skærmbillede: «Drop files
        // here» var der ikke. Den var der — hvid på cremefarvet. SwiftUI giver
        // Text systemets label-farve, og på en Mac i mørkt tema er den hvid,
        // mens Trails flade med vilje er lys.
        //
        // Fejlformen er kendt: kun de tekster JEG havde farvet (Palette.fgMuted, Palette.accent)
        // overlevede, så fladen så *næsten* rigtig ud — og et skærmbillede uden
        // en manglende overskrift ligner et layout-valg, ikke en fejl.
        //
        // Fladen er en LYS flade. Det er ikke en undladelse af at understøtte
        // mørk tilstand: paletten ER Trails cremefarvede, den blev godkendt
        // sådan, og en halvt omfarvet udgave ville være en tredje palet.
        .foregroundColor(Palette.fg)
        .task { await model.hentAlt() }
        .sheet(isPresented: $viserIndsaet) { indsaetArk }
        .sheet(isPresented: $viserNoegle) { noegleArk }
        // En ny parring lander som en ny konto mens vinduet står åbent —
        // uden det her ville vælgeren mangle den til vinduet blev lukket.
        .onReceive(NotificationCenter.default.publisher(for: .trailKontoerAendret)) { _ in
            let foer = model.aktivKonto
            model.genlaesKontoer()
            if model.aktivKonto != foer { Task { await model.hentAlt() } }
        }
    }

    // MARK: Værktøjslinje

    /// Samme lodrette forløb som HUD'en, så de to flader ligner ét program.
    private var indholdsBaggrund: some View {
        LinearGradient(colors: [Palette.bgTop, Palette.bgBottom],
                       startPoint: .top, endPoint: .bottom)
    }

    private var vaerktoejslinje: some View {
        HStack(spacing: 10) {
            Text(S.ingestWindowTitle).font(.system(size: 13, weight: .semibold))
            // F263.8 — KONTO-VÆLGEREN. Hvert punkt er en konto Ambient har en
            // nøgle til; at skifte skifter hvilken nøgle der bruges, og alt
            // hentes forfra fra motoren.
            //
            // Listen kan ikke rumme en konto ejeren ikke må: en nøgle opstår
            // kun ved en godkendelse i den konto, på app.trailmem.com, med
            // hans egen session. Derfor er «Tilføj konto…» ikke en bekvemhed —
            // det ER adgangskontrollen, og den ligger dér hvor den hører til.
            kontoVaelger
            Spacer()
            if model.kbs.count > 1 {
                Picker("", selection: Binding(
                    get: { model.valgtKb },
                    set: { ny in
                        model.valgtKb = ny
                        UserDefaults.standard.set(
                            ny, forKey: TenantStore.kbNoegle(for: model.aktivKonto))
                        Task { await model.opdater() }
                    })) {
                    ForEach(model.kbs) { kb in Text(kb.name).tag(kb.id) }
                }
                .labelsHidden()
                .frame(maxWidth: 200)
                .accessibilityIdentifier("ingest-kb-picker")
            } else if !model.kbNavn.isEmpty {
                Text(model.kbNavn).font(.system(size: 12)).foregroundColor(Palette.fgMuted)
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
        .background(Palette.bgTop)
    }

    /// Ét punkt pr. forbundet konto + en vej til at tilføje en. Er der kun én,
    /// står den stadig som en menu: den bærer «Tilføj konto…», og en etiket
    /// ville skjule at der er noget at gøre.
    private var kontoVaelger: some View {
        Menu {
            ForEach(model.kontoer) { k in
                Button {
                    Task { await model.skiftKonto(til: k.slug) }
                } label: {
                    if k.slug == model.aktivKonto {
                        Label(k.visningsnavn, systemImage: "checkmark")
                    } else {
                        Text(k.visningsnavn)
                    }
                }
            }
            if !model.kontoer.isEmpty { Divider() }
            Button(S.ingestAddTenant) { viserNoegle = true }
                .accessibilityIdentifier("ingest-add-tenant")
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "person.crop.circle").font(.system(size: 11))
                Text(model.aktivKonto.isEmpty
                     ? (TenantStore.harNoegle ? S.ingestNoTenant : S.ingestNoKey)
                     : (model.kontoer.first { $0.slug == model.aktivKonto }?.visningsnavn
                        ?? model.aktivKonto))
                    .font(.system(size: 11.5))
            }
            .foregroundColor(Palette.fgMuted)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help(S.ingestTenantHelp)
        .accessibilityIdentifier("ingest-tenant-picker")
    }

    /// Ét felt, én gang: samme slags nøgle Web Clipper bruger. Herefter kommer
    /// konto-listen fra serveren og der skal ikke parres pr. konto.
    private var noegleArk: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(S.ingestKeyPrompt).font(.system(size: 14, weight: .semibold))
            Text(S.ingestKeyHelp).font(.system(size: 11.5)).foregroundColor(Palette.fgMuted)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("trail_…", text: $noegleUdkast)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("ingest-key-field")
            HStack {
                Spacer()
                Button(S.ingestKeyCancel) { viserNoegle = false }
                    .accessibilityIdentifier("ingest-key-cancel")
                Button(S.ingestKeySave) {
                    TenantStore.personligNoegle = noegleUdkast
                    noegleUdkast = ""
                    viserNoegle = false
                    Task { await model.hentAlt() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(noegleUdkast.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("ingest-key-save")
            }
        }
        .padding(18)
        .frame(width: 420)
        .background(Palette.bgTop)
    }

    // MARK: Drop-felt

    private var dropfelt: some View {
        VStack(spacing: 6) {
            Image(systemName: "arrow.up.doc")
                .font(.system(size: 26, weight: .light))
                .foregroundColor(Palette.fg.opacity(0.45))
            Text(slipper ? "\(S.ingestUploading)…" : S.ingestDropTitle)
                .font(.system(size: 13, weight: .semibold))
            Text(S.ingestAccepted)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(Palette.fgMuted)
            if model.uploaderAntal > 0 {
                Text("\(S.ingestUploading) \(model.uploaderAntal)…")
                    .font(.system(size: 11)).foregroundColor(Palette.accent)
            } else {
                Text(S.ingestDropHint).font(.system(size: 11.5)).foregroundColor(Palette.accent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 26)
        .background(RoundedRectangle(cornerRadius: 12).fill(Palette.card))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                .foregroundColor(slipper ? Palette.accent : Palette.hairline)
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

    /// Mockuppens «Indsæt tekst…». Den findes fordi det meste man vil lære
    /// Trail ikke er en fil — det er et afsnit fra en mail, en note, et
    /// referat. Uden den skal man først gemme en fil for at kunne aflevere
    /// tre linjer.
    private var indsaetKnap: some View {
        Button {
            indsaetTitel = ""; indsaetTekst = ""; viserIndsaet = true
        } label: {
            Label(S.ingestPaste, systemImage: "doc.on.clipboard")
                .font(.system(size: 12))
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("ingest-paste-open")
    }

    private var indsaetArk: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(S.ingestPaste).font(.system(size: 14, weight: .semibold))
            TextField(S.ingestPasteTitle, text: $indsaetTitel)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("ingest-paste-title")
            TextEditor(text: $indsaetTekst)
                .font(.system(size: 12.5))
                .frame(minHeight: 220)
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Palette.hairline))
                .accessibilityIdentifier("ingest-paste-body")
            if indsaetTekst.isEmpty {
                Text(S.ingestPastePlaceholder).font(.system(size: 11)).foregroundColor(Palette.fgMuted)
            }
            HStack {
                Spacer()
                Button(S.ingestCancel) { viserIndsaet = false }
                    .accessibilityIdentifier("ingest-paste-cancel")
                Button(S.ingestPasteSave) {
                    let titel = indsaetTitel, tekst = indsaetTekst
                    viserIndsaet = false
                    Task { await model.indsaet(titel: titel, tekst: tekst) }
                }
                .keyboardShortcut(.defaultAction)
                // Tom tekst kan ikke gemmes. En knap der «lykkes» på ingenting
                // er den slags grøn vi bruger dagen på at fjerne.
                .disabled(indsaetTekst.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityIdentifier("ingest-paste-save")
            }
        }
        .padding(18)
        .frame(width: 520)
        .background(Palette.bgBottom)
        .foregroundColor(Palette.fg)
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
                    .font(.system(size: 12)).foregroundColor(Palette.fgMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 18).padding(.horizontal, 12)
            } else {
                ForEach(Array(raekker.enumerated()), id: \.element.id) { i, k in
                    raekke(k)
                    if i < raekker.count - 1 { Divider().background(Palette.hairline) }
                }
            }
        }
        .background(RoundedRectangle(cornerRadius: 9).fill(Palette.card))
        .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(Palette.hairline))
        .accessibilityIdentifier("ingest-source-list")
    }

    private func raekke(_ k: IngestSource) -> some View {
        HStack(spacing: 10) {
            Text(k.fileType.uppercased())
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .foregroundColor(Palette.fgMuted)
                .frame(width: 38, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                Text(k.visningsnavn).font(.system(size: 12.5, weight: .medium)).lineLimit(1)
                if let s = undertekst(k) {
                    Text(s).font(.system(size: 11)).foregroundColor(Palette.fgMuted).lineLimit(1)
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
            k.erFejlet ? (S.ingestStateFailed, Palette.err)
            : k.awaitingLocalCompile ? (S.ingestStateWaiting, Palette.fgMuted)
            : k.erIKoe ? (S.ingestStateCompiling, Palette.accent)
            : ("\(k.neuronCount) \(S.ingestNeuronsSuffix)", Palette.ok)
        return Text(tekst)
            .font(.system(size: 10.5, weight: .medium))
            .foregroundColor(farve)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(farve.opacity(0.13)))
    }

    // MARK: Fejl + status

    private func fejlbanner(_ tekst: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundColor(Palette.err)
            Text(tekst).font(.system(size: 12)).foregroundColor(Palette.err)
            Spacer()
            Button(S.ingestRetry) { Task { await model.opdater() } }
                .buttonStyle(.borderless).font(.system(size: 12))
                .accessibilityIdentifier("ingest-error-retry")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Palette.err.opacity(0.07)))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.err.opacity(0.3)))
        .accessibilityIdentifier("ingest-error")
    }

    /// Statuslinjen SIGER hvem der kompilerer. Den gætter ikke, og den påstår
    /// ikke «lokal» før en arbejder faktisk har taget et job — en tilsluttet
    /// maskine er ikke det samme som en maskine der arbejder (F263.4).
    /// Statuslinjen SIGER hvem der kompilerer — og kontakten SKRIVER til
    /// buddys job, ikke til et flag vi selv holder. To steder der afgør om
    /// Macen tager arbejde ville drive fra hinanden første gang nogen slog
    /// jobbet fra i buddys dashboard.
    private var statuslinje: some View {
        let arbejder = model.status.workers.first
        return HStack(spacing: 9) {
            Circle().fill(prikFarve).frame(width: 7, height: 7)
            Text(motorTekst).font(.system(size: 12, weight: .medium))
            // Alderen står FØRST når den findes: den kvalificerer alt til
            // højre for sig, og en læser der stopper efter to ord skal have
            // fanget at tallet ikke er nyt.
            if let g = motorAldersNote {
                Text("· \(g)").font(.system(size: 11)).foregroundColor(Palette.fgMuted)
                    .accessibilityIdentifier("ingest-engine-stale")
            }
            if let n = motorNote {
                Text("· \(n)").font(.system(size: 11)).foregroundColor(Palette.fgMuted)
                    .accessibilityIdentifier("ingest-engine-why")
            }
            Spacer()
            if arbejder != nil || motorErTil {
                Text("$0")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundColor(Palette.ok)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(RoundedRectangle(cornerRadius: 5).fill(Palette.ok.opacity(0.12)))
            }
            if motorKanSkiftes {
                Toggle("", isOn: Binding(
                    get: { motorErTil },
                    set: { ny in Task { await model.skiftMotor(til: ny) } }))
                    .toggleStyle(.switch)
                    .labelsHidden()
                    .disabled(model.motorSkifter)
                    .accessibilityIdentifier("ingest-engine-toggle")
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(Palette.bgTop)
        .accessibilityIdentifier("ingest-engine-status")
    }

    private var motorErTil: Bool { if case .til = model.motor { return true }; return false }

    /// Kontakten vises KUN når vi ved hvad den står på. Er buddy nede, ville en
    /// afbryder i «fra»-stilling påstå noget vi ikke har målt.
    private var motorKanSkiftes: Bool {
        switch model.motor {
        case .til, .fra, .blandet: return true
        case .ukendt: return false
        }
    }

    private var prikFarve: Color {
        switch model.motor {
        case .til: return Palette.ok
        case .blandet: return Palette.accent
        case .fra, .ukendt: return Palette.fgMuted
        }
    }

    private var motorTekst: String {
        switch model.motor {
        case .til: return S.engineOn
        case .fra: return S.engineOff
        case .blandet: return S.engineMixedFmt
        // «Ved ikke» må ALDRIG renderes som en tilstand — og slet ikke som den
        // DYRE. Her stod S.ingestEngineCloud: kunne appen ikke nå buddy, sagde
        // statuslinjen «Skyen kompilerer», mens denne Mac i virkeligheden
        // kompilerede (målt 8/9: buddy timede ud, jobbene kørte, skærmen løj).
        //
        // Hele grunden til at linjen findes er at svare på HVEM der kompilerer
        // og hvad det koster. At gætte det svar — i den forkerte retning — når
        // målingen fejler, er værre end at sige at man ikke ved det.
        //
        // Tre linjer længere oppe stod det rigtige ræsonnement allerede om
        // KONTAKTEN («en afbryder i fra-stilling ville påstå noget vi ikke har
        // målt»). Etiketten ved siden af gjorde præcis det den kontakt lod være.
        case .ukendt: return S.ingestEngineUnknown
        }
    }

    /// Den lille forklaring efter prikken. Uden den læses «Skyen kompilerer»
    /// som et valg man kan lave om et sted man ikke kan finde.
    private var motorNote: String? {
        switch model.motor {
        case .til(let naeste):
            guard let naeste else { return nil }
            let sek = max(0, Int(naeste.timeIntervalSinceNow))
            return "\(S.engineNextIn) \(sek)s"
        case .fra: return nil
        case .blandet(let til, let af): return "\(til)/\(til + af)"
        case .ukendt(let hvorfor): return hvorfor.isEmpty ? S.ingestEngineNotSetUp : hvorfor
        }
    }

    /// Står der en ALDER, er tallet ved siden af ikke nyt. Uden den ville en
    /// bevaret tilstand se ud som en frisk måling — samme løgn, blot pænere.
    private var motorAldersNote: String? {
        guard let sek = model.motorAlder else { return nil }
        return "\(S.ingestEngineStale) \(sek)s"
    }
}
