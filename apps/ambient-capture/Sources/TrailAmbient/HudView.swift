// F201.9 — the HUD content. A Raycast/Spotlight-style launcher over the
// user's own Trail, in the Trail palette (warm near-black + #e8a87c accent).
// Søg → FTS Neuron hits; Spørg → synthesised answer + cited Neurons. Custom
// mode toggle (NO native segmented control — house rule). Enter runs it;
// clicking a result opens it in the browser.
import SwiftUI
import AVFoundation

@MainActor
final class HudModel: ObservableObject {
    enum Mode: String, CaseIterable { case search = "Søg", ask = "Spørg" }
    /// F201.6.5b — the in-HUD mic button's three states. `needsPermission` when
    /// macOS hasn't granted the mic yet (tap → prompt, or → System Settings if
    /// denied); `idle` when ready (tap → record); `recording` (tap → stop +
    /// transcribe on-device). Discoverable + reliable-prompt companion to the
    /// eyes-free ⌃⌥R global hotkey.
    enum MicState { case needsPermission, idle, recording, transcribing }
    @Published var mode: Mode = .search
    @Published var query = ""
    @Published var loading = false
    @Published var hits: [NeuronHit] = []
    @Published var answer: ChatAnswer?
    @Published var ran = false
    /// Mic button state + the last capture's transcript (shown inline so the
    /// user SEES what WhisperKit heard, instead of a file on disk).
    @Published var mic: MicState = AudioWatcher.isMicGranted ? .idle : .needsPermission
    @Published var transcript: String?
    /// F201.6.4 — where the last transcript is on its way to becoming a Neuron.
    enum SaveState { case saving, saved, duplicate, failed }
    @Published var saved: SaveState?

    /// Mic button tapped. Grant-first: an accessory app's launch-time prompt is
    /// unreliable (no front window), but the HUD is frontmost + app-active, so
    /// requesting here reliably surfaces the system dialog.
    func micTapped() {
        switch mic {
        case .needsPermission:
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            if status == .denied || status == .restricted {
                // Already denied — the prompt won't re-appear, so send the user
                // to the exact Privacy pane to flip it on.
                if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") {
                    NSWorkspace.shared.open(u)
                }
            } else {
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    Task { @MainActor in self.mic = granted ? .idle : .needsPermission }
                }
            }
        case .idle:
            transcript = nil
            Task {
                let ok = await AudioWatcher.shared.record()
                await MainActor.run { self.mic = ok ? .recording : .needsPermission }
            }
        case .recording:
            // Stop pressed. large-v3 transcription of a long clip takes several
            // seconds; flip to .transcribing SYNCHRONOUSLY so the button shows a
            // spinner immediately. Without it the button stayed red during the
            // wait, so the user pressed stop again ("det kommer langt tid efter",
            // Christian 2026-07-03) — and the re-entry overwrote the real
            // transcript with an empty one. This state also blocks that re-entry.
            mic = .transcribing
            Task {
                let text = await AudioWatcher.shared.finishAndTranscribe()
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                await MainActor.run {
                    self.mic = .idle
                    self.transcript = text   // "" → "no speech" hint in the banner
                    self.saved = trimmed.isEmpty ? nil : .saving
                }
                // F201.6.4 — a real transcript becomes a Trail Neuron. Only
                // deliberate speech is saved; an empty capture just shows the hint.
                guard !trimmed.isEmpty else { return }
                let result = await TrailClient.saveNote(trimmed)
                await MainActor.run {
                    switch result {
                    case .saved:     self.saved = .saved
                    case .duplicate: self.saved = .duplicate
                    case .failed:    self.saved = .failed
                    }
                }
            }
        case .transcribing:
            break   // ignore taps while a transcription is in flight
        }
    }

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

    func reset() {
        query = ""; hits = []; answer = nil; ran = false; loading = false
        transcript = nil; saved = nil
        // Re-read the grant on every open (it may have been granted since).
        if mic != .recording && mic != .transcribing {
            mic = AudioWatcher.isMicGranted ? .idle : .needsPermission
        }
    }
}

// Trail palette.
private enum Palette {
    static let accent = Color(red: 0xE8/255.0, green: 0xA8/255.0, blue: 0x7C/255.0)
    static let bgTop = Color(red: 0.13, green: 0.115, blue: 0.10)
    static let bgBottom = Color(red: 0.09, green: 0.08, blue: 0.072)
    static let card = Color.white.opacity(0.045)
    static let cardHover = Color.white.opacity(0.09)
    static let hairline = Color.white.opacity(0.08)
    static let fg = Color(red: 0.96, green: 0.94, blue: 0.91)
    static let fgMuted = Color.white.opacity(0.55)
    static let fgSubtle = Color.white.opacity(0.32)
}

struct HudView: View {
    @ObservedObject var model: HudModel
    var onClose: () -> Void
    /// When set (off-screen preview only), the query renders as static text
    /// instead of the live TextField — ImageRenderer can't rasterize an
    /// editable field (it shows a yellow placeholder). No effect at runtime.
    var previewText: String? = nil
    @FocusState private var fieldFocused: Bool
    /// Drives the recording dot's pulse.
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Rectangle().fill(Palette.hairline).frame(height: 1)
            if model.mic == .recording || model.mic == .transcribing || model.transcript != nil { audioBanner }
            content
            footer
        }
        .frame(width: 640)
        .background(
            LinearGradient(colors: [Palette.bgTop, Palette.bgBottom], startPoint: .top, endPoint: .bottom)
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Palette.hairline, lineWidth: 1))
        // No SwiftUI .shadow()/.padding() here: the padding created a 24px
        // transparent margin that rendered as an ugly grey rectangular frame
        // around the card. The card now fills the panel edge-to-edge; the drop
        // shadow is drawn by macOS on the panel itself (hasShadow = true).
        .onAppear { fieldFocused = true }
    }

    // MARK: Header — mark + field + custom mode toggle

    private var header: some View {
        HStack(spacing: 13) {
            TrailMarkView(size: 22)
            if let preview = previewText {
                Text(preview.isEmpty ? (model.mode == .search ? "Søg i din Trail…" : "Spørg din Trail…") : preview)
                    .font(.system(size: 19))
                    .foregroundColor(preview.isEmpty ? Palette.fgSubtle : Palette.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("", text: $model.query, prompt: Text(model.mode == .search ? "Søg i din Trail…" : "Spørg din Trail…").foregroundColor(Palette.fgSubtle))
                    .textFieldStyle(.plain)
                    .font(.system(size: 19, weight: .regular))
                    .foregroundColor(Palette.fg)
                    .focused($fieldFocused)
                    .onSubmit { model.run() }
            }
            modeToggle
            micButton
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
    }

    // MARK: Mic button (F201.6.5b) — grant + capture, right in the HUD.

    private var micButton: some View {
        Button { model.micTapped() } label: {
            ZStack {
                Circle()
                    .fill(model.mic == .recording ? Color.red.opacity(0.16) : Color.white.opacity(0.05))
                    .frame(width: 34, height: 34)
                if model.mic == .transcribing {
                    ProgressView().controlSize(.small).tint(Palette.accent)
                } else {
                    Image(systemName: micSymbol)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(micColor)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(model.mic == .transcribing)
        .help(micHelp)
    }

    private var micSymbol: String {
        switch model.mic {
        case .needsPermission: return "mic.slash"
        case .idle:            return "mic.fill"
        case .recording:       return "stop.fill"
        case .transcribing:    return "stop.fill"   // hidden behind the spinner
        }
    }
    private var micColor: Color {
        switch model.mic {
        case .needsPermission: return Palette.fgMuted
        case .idle:            return Palette.accent
        case .recording:       return .red
        case .transcribing:    return Palette.accent
        }
    }
    private var micHelp: String {
        switch model.mic {
        case .needsPermission: return "Giv adgang til mikrofonen for at optage tale"
        case .idle:            return "Optag tale (⌃⌥R)"
        case .recording:       return "Stop og transskribér"
        case .transcribing:    return "Transskriberer…"
        }
    }

    // Recording state / last transcript, shown inline so the result is visible.
    private var audioBanner: some View {
        HStack(spacing: 10) {
            if model.mic == .recording {
                Circle().fill(Color.red).frame(width: 9, height: 9)
                    .opacity(pulse ? 0.25 : 1)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
                    }
                    .onDisappear { pulse = false }
                Text("Optager… tryk mikrofonen igen for at stoppe")
                    .foregroundColor(Palette.fg).font(.system(size: 13))
                Spacer()
            } else if model.mic == .transcribing {
                ProgressView().controlSize(.small).tint(Palette.accent)
                Text("Transskriberer med large-v3… (et øjeblik)")
                    .foregroundColor(Palette.fg).font(.system(size: 13))
                Spacer()
            } else if let t = model.transcript {
                let empty = t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                Image(systemName: "waveform").foregroundColor(Palette.accent).font(.system(size: 13))
                VStack(alignment: .leading, spacing: 3) {
                    Text(empty ? "Ingen tale opfanget — prøv igen tættere på mikrofonen." : t)
                        .foregroundColor(empty ? Palette.fgMuted : Palette.fg)
                        .font(.system(size: 13)).lineLimit(3).textSelection(.enabled)
                    if let s = model.saved { savedLine(s) }
                }
                Spacer(minLength: 8)
                Button { model.transcript = nil; model.saved = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .semibold)).foregroundColor(Palette.fgSubtle)
                }.buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(model.mic == .recording ? Color.red.opacity(0.08) : Palette.accent.opacity(0.07))
        .overlay(Rectangle().fill(Palette.hairline).frame(height: 1), alignment: .bottom)
    }

    /// F201.6.4 — the transcript's journey into Trail, shown under the text.
    @ViewBuilder private func savedLine(_ s: HudModel.SaveState) -> some View {
        switch s {
        case .saving:
            HStack(spacing: 5) {
                ProgressView().controlSize(.mini).tint(Palette.fgMuted)
                Text("Gemmer i Trail…").font(.system(size: 11)).foregroundColor(Palette.fgMuted)
            }
        case .saved:
            Text("✓ Gemt i Trail").font(.system(size: 11, weight: .medium)).foregroundColor(Palette.accent)
        case .duplicate:
            Text("Allerede gemt (dublet)").font(.system(size: 11)).foregroundColor(Palette.fgMuted)
        case .failed:
            Text("Kunne ikke gemme i Trail — prøv igen").font(.system(size: 11)).foregroundColor(Color.red.opacity(0.85))
        }
    }

    private var modeToggle: some View {
        HStack(spacing: 3) {
            ForEach(HudModel.Mode.allCases, id: \.self) { m in
                let on = model.mode == m
                Button {
                    model.mode = m; model.hits = []; model.answer = nil; model.ran = false
                } label: {
                    Text(m.rawValue)
                        .font(.system(size: 12.5, weight: on ? .semibold : .medium))
                        .foregroundColor(on ? Color(red: 0.10, green: 0.08, blue: 0.06) : Palette.fgMuted)
                        .padding(.horizontal, 13).padding(.vertical, 6)
                        .background(on ? Palette.accent : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.05))
        .clipShape(Capsule())
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        if model.loading {
            centered { ProgressView().controlSize(.small).tint(Palette.accent); Text("Slår op…").foregroundColor(Palette.fgMuted) }
        } else if model.mode == .search {
            if model.ran && model.hits.isEmpty {
                centered { hintMark("Ingen Neuroner matcher endnu.") }
            } else if model.hits.isEmpty {
                centered { hintMark("Skriv og tryk ↵ for at søge i din viden.") }
            } else {
                scroll(maxHeight: 400) { VStack(spacing: 7) { ForEach(model.hits) { hitRow($0) } }.padding(14) }
            }
        } else {
            if let a = model.answer {
                scroll(maxHeight: 420) { VStack(alignment: .leading, spacing: 14) {
                    Text(a.answer).foregroundColor(Palette.fg).font(.system(size: 14.5)).lineSpacing(3).textSelection(.enabled)
                    if !a.citations.isEmpty {
                        Text("KILDER").font(.system(size: 10.5, weight: .semibold)).tracking(0.8).foregroundColor(Palette.fgSubtle)
                        VStack(alignment: .leading, spacing: 5) { ForEach(a.citations) { citationRow($0) } }
                    }
                }.padding(18) }
            } else if model.ran {
                centered { hintMark("Intet svar.") }
            } else {
                centered { hintMark("Stil et spørgsmål, tryk ↵ — Trail svarer med kilder.") }
            }
        }
    }

    private func hitRow(_ hit: NeuronHit) -> some View {
        HoverButton { open(slug: hit.slug); onClose() } content: { hovering in
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(hit.title).foregroundColor(Palette.fg).font(.system(size: 14.5, weight: .medium)).lineLimit(1)
                    Spacer(minLength: 12)
                    Text(hit.path).foregroundColor(Palette.fgSubtle).font(.system(size: 10.5, design: .monospaced)).lineLimit(1)
                }
                if !hit.highlight.isEmpty {
                    Text(stripMarks(hit.highlight)).foregroundColor(Palette.fgMuted).font(.system(size: 12.5)).lineLimit(2).lineSpacing(1)
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(hovering ? Palette.cardHover : Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(hovering ? Palette.accent.opacity(0.4) : .clear, lineWidth: 1))
        }
    }

    private func citationRow(_ c: Citation) -> some View {
        HoverButton { open(slug: c.slug); onClose() } content: { hovering in
            HStack(spacing: 7) {
                Image(systemName: "doc.text.fill").foregroundColor(Palette.accent).font(.system(size: 11))
                Text(c.filename.replacingOccurrences(of: ".md", with: "")).foregroundColor(hovering ? Palette.accent : Palette.fg).font(.system(size: 12.5)).lineLimit(1)
                Spacer()
                Image(systemName: "arrow.up.right").foregroundColor(Palette.fgSubtle).font(.system(size: 9))
            }
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(hovering ? Palette.cardHover : Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }

    // MARK: Footer hint

    private var footer: some View {
        HStack(spacing: 16) {
            hintKey("↵", "udfør")
            hintKey("⇥", "skift felt")
            hintKey("esc", "luk")
            Spacer()
            Text("Ambient Test").font(.system(size: 10.5, design: .monospaced)).foregroundColor(Palette.fgSubtle)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(Color.black.opacity(0.18))
        .overlay(Rectangle().fill(Palette.hairline).frame(height: 1), alignment: .top)
    }

    private func hintKey(_ key: String, _ label: String) -> some View {
        HStack(spacing: 5) {
            Text(key).font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundColor(Palette.fgMuted)
                .padding(.horizontal, 5).padding(.vertical, 1.5)
                .background(Color.white.opacity(0.06)).clipShape(RoundedRectangle(cornerRadius: 4))
            Text(label).font(.system(size: 10.5)).foregroundColor(Palette.fgSubtle)
        }
    }

    // MARK: Helpers

    /// Wrap results in a ScrollView at runtime; render them inline for the
    /// off-screen preview (ImageRenderer can't rasterize ScrollView content).
    @ViewBuilder private func scroll<C: View>(maxHeight: CGFloat, @ViewBuilder _ c: () -> C) -> some View {
        if previewText != nil {
            c()
        } else {
            ScrollView { c() }.frame(maxHeight: maxHeight)
        }
    }

    private func centered<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        HStack(spacing: 9) { c() }.frame(maxWidth: .infinity).padding(.vertical, 34)
    }
    private func hintMark(_ s: String) -> some View {
        VStack(spacing: 12) {
            TrailMarkView(size: 30).opacity(0.5)
            Text(s).foregroundColor(Palette.fgSubtle).font(.system(size: 13))
        }
    }
    private func open(slug: String) { if let u = TrailClient.neuronURL(slug: slug) { NSWorkspace.shared.open(u) } }
    private func stripMarks(_ s: String) -> String {
        s.replacingOccurrences(of: "<mark>", with: "").replacingOccurrences(of: "</mark>", with: "")
    }
}

/// The Trail mark as SwiftUI (concentric circles + accent core).
private struct TrailMarkView: View {
    let size: CGFloat
    var body: some View {
        ZStack {
            Circle().stroke(Palette.fg.opacity(0.9), lineWidth: size * 0.06).padding(size * 0.06)
            Circle().stroke(Palette.accent.opacity(0.55), lineWidth: size * 0.03).padding(size * 0.22)
            Circle().fill(Palette.accent).frame(width: size * 0.22, height: size * 0.22)
        }.frame(width: size, height: size)
    }
}

/// Button that reports hover state to its content builder (no native styling).
private struct HoverButton<Content: View>: View {
    var action: () -> Void
    @ViewBuilder var content: (Bool) -> Content
    @State private var hovering = false
    var body: some View {
        Button(action: action) { content(hovering) }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
    }
}
