// F201.9 — the HUD content. A Raycast/Spotlight-style launcher over the
// user's own Trail, in the Trail palette (warm near-black + #e8a87c accent).
// Søg → FTS Neuron hits; Spørg → synthesised answer + cited Neurons. Custom
// mode toggle (NO native segmented control — house rule). Enter runs it;
// clicking a result opens it in the browser.
import SwiftUI
import AVFoundation
import Speech
import Combine

@MainActor
final class HudModel: ObservableObject {
    enum Mode: String, CaseIterable {
        case search, ask
        /// Display label (localised via `S`); the rawValue stays a stable id.
        var label: String { self == .search ? S.searchMode : S.askMode }
        var placeholder: String { self == .search ? S.searchPlaceholder : S.askPlaceholder }
    }
    /// F201.6.7 — the in-HUD mic button's three states. `needsPermission` when
    /// macOS hasn't granted mic + speech yet (tap → prompt, or → System Settings
    /// if denied); `idle` when ready (tap → dictate); `listening` (tap → stop +
    /// save). Apple's streaming recognizer writes text live while listening, so
    /// there's no separate "transcribing" wait (unlike the old WhisperKit batch).
    enum MicState { case needsPermission, idle, listening }
    @Published var mode: Mode = .search
    @Published var query = ""
    @Published var loading = false
    @Published var hits: [NeuronHit] = []
    @Published var answer: ChatAnswer?
    @Published var ran = false
    /// Mic button state + the last capture's transcript (shown inline so the
    /// user SEES what Trail heard, live as it's spoken).
    @Published var mic: MicState = (AudioWatcher.isMicGranted && AppleSpeech.isSpeechAuthorized) ? .idle : .needsPermission
    @Published var transcript: String?
    /// F201.13 — the KB the device writes to, shown in the Extraction-mode footer.
    /// Seeded from the cached name (set at connect), refreshed live from the engine
    /// on each HUD open so a rename in admin appears without reconnecting.
    @Published var kbName: String = TrailClient.cachedKbName
    /// F201.15 — live mic input level (0…1), mirrored from AppleSpeech for the
    /// HUD level meter (so it's visible whether audio is reaching the engine).
    @Published var inputLevel: Float = 0
    /// F201.6.4 — where the last transcript is on its way to becoming a Neuron.
    enum SaveState { case transcribing, saving, saved, duplicate, failed, notOwner }
    @Published var saved: SaveState?
    /// F201.15 — set by HudController so Prompt Mode can hide the HUD (returning
    /// focus to the target field) before it injects the dictation.
    var onDismiss: (() -> Void)?

    /// F201.6.7 — Apple's on-device streaming recognizer. Owns the mic tap while
    /// listening and publishes the transcript live; we mirror it into `transcript`
    /// so the banner shows words appearing as they're spoken.
    private let speech = AppleSpeech()
    private var cancellables = Set<AnyCancellable>()

    init() {
        // Roll any partial that survived a crash into the verbatim journal.
        DictationJournal.recoverInflight()
        speech.$transcript
            .receive(on: RunLoop.main)
            .sink { [weak self] raw in
                guard let self, self.mic == .listening else { return }
                // F201.14 — restore misheard terms live, so the banner shows the
                // true words as spoken. Display = corrected; journal = RAW.
                self.transcript = SpeechDictionary.applyCorrections(raw)
                // Crash insurance + mining corpus: checkpoint the RAW words (the
                // corrected form is always re-derivable from raw; the reverse isn't).
                DictationJournal.checkpoint(raw)
            }
            .store(in: &cancellables)
        speech.$inputLevel
            .receive(on: RunLoop.main)
            .sink { [weak self] lvl in self?.inputLevel = lvl }
            .store(in: &cancellables)
    }

    /// Mic button tapped. Grant-first: an accessory app's launch-time prompt is
    /// unreliable (no front window), but the HUD is frontmost + app-active, so
    /// requesting here reliably surfaces the system dialogs (mic AND speech).
    func micTapped() {
        let micS = AVCaptureDevice.authorizationStatus(for: .audio).rawValue
        let spS = SFSpeechRecognizer.authorizationStatus().rawValue
        EventLog.shared.log(kind: "mic_tapped state=\(mic) micAuth=\(micS) speechAuth=\(spS)")
        switch mic {
        case .needsPermission:
            // Mic (AVCapture) and Speech (SFSpeechRecognizer) are two separate
            // TCC grants — dictation needs BOTH. If either was denied the prompt
            // won't re-appear, so deep-link to the exact Privacy pane; otherwise
            // request both and flip to .idle only when both are granted.
            let micStatus = AVCaptureDevice.authorizationStatus(for: .audio)
            if micStatus == .denied || micStatus == .restricted {
                EventLog.shared.log(kind: "perm_open_privacy pane=mic")
                openPrivacy("Privacy_Microphone"); return
            }
            let speechStatus = SFSpeechRecognizer.authorizationStatus()
            if speechStatus == .denied || speechStatus == .restricted {
                EventLog.shared.log(kind: "perm_open_privacy pane=speech")
                openPrivacy("Privacy_SpeechRecognition"); return
            }
            Task {
                let micOK = micStatus == .authorized ? true : await withCheckedContinuation { c in
                    AVCaptureDevice.requestAccess(for: .audio) { c.resume(returning: $0) }
                }
                let speechOK = await self.speech.requestAuthorization()
                await MainActor.run {
                    EventLog.shared.log(kind: "perm_requested micOK=\(micOK) speechOK=\(speechOK)")
                    self.mic = (micOK && speechOK) ? .idle : .needsPermission
                }
            }
        case .idle:
            // Start dictating. Apple streams partial results, so the banner fills
            // in live — no record-then-wait. Guard BOTH grants (mic + speech) in
            // case one was reset out from under us — start() with an ungranted mic
            // would otherwise crash on an invalid tap format.
            transcript = nil; saved = nil
            guard AudioWatcher.isMicGranted, AppleSpeech.isSpeechAuthorized else {
                mic = .needsPermission; return
            }
            do {
                // Prompt Mode is session-only — don't record its audio to disk.
                try speech.start(record: !PromptMode.shared.enabled)
                mic = .listening
            } catch {
                // Mic wasn't actually ready — stay idle, no crash (see start()).
                EventLog.shared.log(kind: "apple_speech_start_threw \(error.localizedDescription)")
                mic = .idle
            }
        case .listening:
            // Stop pressed. The streamed text is already on screen, so stop()
            // returns the final transcript synchronously — flip straight to .idle
            // and save it (no transcribing wait, no double-press race).
            let final = speech.stop()
            mic = .idle
            let raw = (final ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !raw.isEmpty else { transcript = ""; DictationJournal.clearInflight(); return }
            // INTERIM CATCH (F201.6.8) — the RAW words to disk VERBATIM, BEFORE the
            // network hop, so distill / a failed POST / a crash can never lose
            // them. Raw (not corrected) is the durable record: the corrected form
            // is always re-derivable via applyCorrections; the reverse is not, and
            // raw is also the corpus F201.14 mining reads for unknown mishearings.
            DictationJournal.append(raw)
            DictationJournal.clearInflight()
            // F201.14 — restore the terms Apple misheard before the text goes
            // anywhere (injected into a session, or saved as a Neuron).
            let corrected = SpeechDictionary.applyCorrections(raw)
            transcript = corrected      // show the restored words in the banner
            // F201.15 — Prompt Mode: inject the dictation into the focused field
            // (the cardmem Agents composer, iTerm, …) instead of saving to Trail.
            // Hide the HUD FIRST so focus returns to the target field, then type.
            if PromptMode.shared.enabled {
                // F201.15 — Prompt Mode is SESSION-ONLY. The dictation goes to the
                // focused agent and is NEVER saved to Trail. (An earlier "all
                // dictations → sources" dual-write turned a PRIVATE spoken opinion —
                // dictated while in a Messages conversation — into a permanent
                // Neuron. Prompt-Mode content is a prompt, often private/ephemeral;
                // only Extraction mode's deliberate "save to Trail" persists.
                // Christian 2026-07-04.)
                onDismiss?()
                PromptMode.shared.inject(corrected)
                return
            }
            // Extraction mode — faithful: batch-transcribe the FULL recording
            // (WhisperKit, in the background) so long dictations land WHOLE. The
            // 45s-restart streaming text drops ~half of a multi-minute speech; the
            // batch pass over the kept audio does not. Streaming `corrected` is the
            // fallback when there's no recording or batch fails. The capture then
            // becomes a first-class Trail Source (F201.13), with the legacy
            // candidate path as the 404 fallback.
            let audioPath = speech.lastRecordingURL?.path
            saved = audioPath != nil ? .transcribing : .saving
            Task {
                var text = corrected
                var rawFinal = raw
                if let audioPath,
                   let batch = try? await Whisper.shared.transcribe(path: audioPath, language: "da"),
                   !batch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    rawFinal = batch
                    text = SpeechDictionary.applyCorrections(batch)
                    await MainActor.run { self.transcript = text; self.saved = .saving }
                }
                // F201.6.6 — speaker gate: only the enrolled owner's speech
                // becomes a Trail Neuron. Fail-open until enrolled. The raw words
                // are already in DictationJournal (above), so a gated-out
                // utterance is never lost — it just doesn't reach Trail.
                if let audioPath, let buf = AudioWatcher.decodeToMono16k(path: audioPath) {
                    let verdict = await SpeakerGate.isOwner(buf)
                    EventLog.shared.log(kind: "speaker_gate owner=\(verdict.owner) sim=\(String(format: "%.3f", verdict.similarity))")
                    if !verdict.owner {
                        await MainActor.run { self.saved = .notOwner }
                        return
                    }
                }
                let result = await TrailClient.saveSource(content: text, rawTranscript: rawFinal, source: "audio", allowFallback: true)
                await MainActor.run {
                    switch result {
                    case .saved:     self.saved = .saved
                    case .duplicate: self.saved = .duplicate
                    case .failed:    self.saved = .failed
                    }
                }
            }
        }
    }

    private func openPrivacy(_ pane: String) {
        if let u = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
            NSWorkspace.shared.open(u)
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
        // Re-read the grants on every open (they may have been granted since).
        if mic != .listening {
            mic = (AudioWatcher.isMicGranted && AppleSpeech.isSpeechAuthorized) ? .idle : .needsPermission
        }
        // F201.13 — pull the KB's current name so a rename in admin shows live.
        kbName = TrailClient.cachedKbName
        Task {
            if let name = await TrailClient.refreshKbName() {
                await MainActor.run { self.kbName = name }
            }
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
    /// F201.15 — the live Prompt-Mode target, shown in the footer.
    @ObservedObject private var prompt = PromptMode.shared
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
            if model.mic == .listening || model.transcript != nil { audioBanner }
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
                Text(preview.isEmpty ? model.mode.placeholder : preview)
                    .font(.system(size: 19))
                    .foregroundColor(preview.isEmpty ? Palette.fgSubtle : Palette.fg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TextField("", text: $model.query, prompt: Text(model.mode.placeholder).foregroundColor(Palette.fgSubtle))
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
                    .fill(model.mic == .listening ? Color.red.opacity(0.16) : Color.white.opacity(0.05))
                    .frame(width: 34, height: 34)
                Image(systemName: micSymbol)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(micColor)
            }
        }
        .buttonStyle(.plain)
        .help(micHelp)
    }

    private var micSymbol: String {
        switch model.mic {
        case .needsPermission: return "mic.slash"
        case .idle:            return "mic.fill"
        case .listening:       return "stop.fill"
        }
    }
    private var micColor: Color {
        switch model.mic {
        case .needsPermission: return Palette.fgMuted
        case .idle:            return Palette.accent
        case .listening:       return .red
        }
    }
    private var micHelp: String {
        switch model.mic {
        case .needsPermission: return S.micHelpNeedsPermission
        case .idle:            return S.micHelpIdle
        case .listening:       return S.micHelpListening
        }
    }

    // Live dictation / last transcript, shown inline so the result is visible.
    private var audioBanner: some View {
        HStack(spacing: 10) {
            if model.mic == .listening {
                Circle().fill(Color.red).frame(width: 9, height: 9)
                    .opacity(pulse ? 0.25 : 1)
                    .onAppear {
                        withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { pulse = true }
                    }
                    .onDisappear { pulse = false }
                let live = (model.transcript ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                Text(live.isEmpty ? S.listeningHint : live)
                    .foregroundColor(live.isEmpty ? Palette.fgMuted : Palette.fg)
                    .font(.system(size: 13)).lineLimit(3)
                    .animation(.easeOut(duration: 0.15), value: live)
                Spacer(minLength: 8)
                InputLevelMeter(level: model.inputLevel)
                Text(S.stopHint).foregroundColor(Palette.fgSubtle).font(.system(size: 11))
            } else if let t = model.transcript {
                let empty = t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                Image(systemName: "waveform").foregroundColor(Palette.accent).font(.system(size: 13))
                VStack(alignment: .leading, spacing: 3) {
                    Text(empty ? S.noSpeech : t)
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
        .background(model.mic == .listening ? Color.red.opacity(0.08) : Palette.accent.opacity(0.07))
        .overlay(Rectangle().fill(Palette.hairline).frame(height: 1), alignment: .bottom)
    }

    /// F201.6.4 — the transcript's journey into Trail, shown under the text.
    @ViewBuilder private func savedLine(_ s: HudModel.SaveState) -> some View {
        switch s {
        case .transcribing:
            HStack(spacing: 5) {
                ProgressView().controlSize(.mini).tint(Palette.fgMuted)
                Text(S.transcribing).font(.system(size: 11)).foregroundColor(Palette.fgMuted)
            }
        case .saving:
            HStack(spacing: 5) {
                ProgressView().controlSize(.mini).tint(Palette.fgMuted)
                Text(S.saving).font(.system(size: 11)).foregroundColor(Palette.fgMuted)
            }
        case .saved:
            Text(S.saved).font(.system(size: 11, weight: .medium)).foregroundColor(Palette.accent)
        case .duplicate:
            Text(S.duplicate).font(.system(size: 11)).foregroundColor(Palette.fgMuted)
        case .failed:
            Text(S.saveFailed).font(.system(size: 11)).foregroundColor(Color.red.opacity(0.85))
        case .notOwner:
            Text(S.notYourVoice).font(.system(size: 11)).foregroundColor(Palette.fgMuted)
        }
    }

    private var modeToggle: some View {
        HStack(spacing: 3) {
            ForEach(HudModel.Mode.allCases, id: \.self) { m in
                let on = model.mode == m
                Button {
                    model.mode = m; model.hits = []; model.answer = nil; model.ran = false
                } label: {
                    Text(m.label)
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
            centered { ProgressView().controlSize(.small).tint(Palette.accent); Text(S.lookingUp).foregroundColor(Palette.fgMuted) }
        } else if model.mode == .search {
            if model.ran && model.hits.isEmpty {
                centered { hintMark(S.noNeurons) }
            } else if model.hits.isEmpty {
                centered { hintMark(S.searchHint) }
            } else {
                scroll(maxHeight: 400) { VStack(spacing: 7) { ForEach(model.hits) { hitRow($0) } }.padding(14) }
            }
        } else {
            if let a = model.answer {
                scroll(maxHeight: 420) { VStack(alignment: .leading, spacing: 14) {
                    Text(a.answer).foregroundColor(Palette.fg).font(.system(size: 14.5)).lineSpacing(3).textSelection(.enabled)
                    if !a.citations.isEmpty {
                        Text(S.sourcesLabel).font(.system(size: 10.5, weight: .semibold)).tracking(0.8).foregroundColor(Palette.fgSubtle)
                        VStack(alignment: .leading, spacing: 5) { ForEach(a.citations) { citationRow($0) } }
                    }
                }.padding(18) }
            } else if model.ran {
                centered { hintMark(S.noAnswer) }
            } else {
                centered { hintMark(S.askHint) }
            }
        }
    }

    private func hitRow(_ hit: NeuronHit) -> some View {
        HoverButton { open(id: hit.id, slug: hit.slug, kind: hit.kind); onClose() } content: { hovering in
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
        HoverButton { open(id: c.id, slug: c.slug, kind: c.kind); onClose() } content: { hovering in
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
            hintKey("↵", S.footerRun)
            hintKey("⇥", S.footerSwitchField)
            hintKey("esc", S.footerClose)
            Spacer()
            footerRight
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(Color.black.opacity(0.18))
        .overlay(Rectangle().fill(Palette.hairline).frame(height: 1), alignment: .top)
    }

    /// F201.15 — footer right side. In Prompt Mode it shows the LIVE dictate
    /// target (auto-updating as focus moves) — both the safety indicator (a
    /// mis-send is visibly impossible) and the debug read-out for the
    /// focus→session resolver. Extraction mode shows the KB label as before.
    @ViewBuilder private var footerRight: some View {
        if prompt.enabled {
            // iTerm tab → session name; a browser/other app → the app name. Both
            // are valid injection targets (text goes to the focused field there).
            let target = prompt.session ?? (prompt.targetApp.isEmpty ? nil : prompt.targetApp)
            HStack(spacing: 5) {
                LucideSpeech(size: 12, color: target == nil ? Palette.fgSubtle : Palette.accent)
                Text("\(S.targetPrefix) \(target ?? "—")")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundColor(target == nil ? Palette.fgSubtle : Palette.accent)
            }
            .help(prompt.rawTitle.map { "\(S.fromPrefix) \(prompt.targetApp) — \($0)" } ?? S.noFocusedField)
        } else {
            Text(model.kbName).font(.system(size: 10.5, design: .monospaced)).foregroundColor(Palette.fgSubtle)
        }
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
    private func open(id: String, slug: String, kind: String) { if let u = TrailClient.docURL(id: id, slug: slug, kind: kind) { NSWorkspace.shared.open(u) } }
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

/// F201.15 — macOS-Sound-settings-style input level meter: a row of bars that
/// fill with the live mic peak. Makes it VISIBLE whether audio is reaching the
/// engine (Christian 2026-07-03: "en gauge der kan vise input level som i
/// settings"). Shown while listening; can later move behind a settings icon.
private struct InputLevelMeter: View {
    var level: Float          // 0…1
    private let bars = 12
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<bars, id: \.self) { i in
                let on = level >= Float(i + 1) / Float(bars)
                RoundedRectangle(cornerRadius: 1)
                    .fill(on ? Palette.accent : Palette.fg.opacity(0.14))
                    .frame(width: 3, height: 9)
            }
        }
        .animation(.linear(duration: 0.05), value: level)
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
