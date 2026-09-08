// F201 — centralised UI strings for the HUD + menubar. The app ships in
// ENGLISH; the original Danish is preserved verbatim in `UIStrings.da` so we
// can flip the whole UI back with one line, or add real localisation later
// (Christian 2026-07-04: "oversæt hele app HUD til engelsk, gem de danske
// titler et sted i koden"). Active language = the global `S`. To switch the
// entire UI to Danish, change `let S = UIStrings.en` → `UIStrings.da`.
import Foundation

/// Every user-facing string in the HUD + menubar, one field per string.
/// Interpolated messages store only their fixed prefix (e.g. `writingToPrefix`)
/// so call sites append the dynamic part.
struct UIStrings {
    // HUD — mode toggle + field placeholders
    let searchMode: String
    let askMode: String
    let searchPlaceholder: String
    let askPlaceholder: String

    // HUD — mic button help + live banner
    let micHelpNeedsPermission: String
    let micHelpIdle: String
    let micHelpListening: String
    let listeningHint: String
    let stopHint: String
    let noSpeech: String

    // HUD — save-state line
    let transcribing: String
    let saving: String
    let saved: String
    let duplicate: String
    let saveFailed: String
    let notYourVoice: String

    // HUD — content area hints
    let lookingUp: String
    let noNeurons: String
    let searchHint: String
    let sourcesLabel: String
    let noAnswer: String
    let askHint: String

    // HUD — footer
    let footerRun: String
    let footerSwitchField: String
    let footerClose: String
    let noFocusedField: String
    let targetPrefix: String
    let fromPrefix: String

    // menubar — status-item tooltips
    let tooltipPaused: String
    let tooltipActive: String

    // menubar — menu items
    let statePaused: String
    let stateActive: String
    let waitingApproval: String
    let notConnected: String
    let lookUpInTrail: String
    let writingToPrefix: String
    let resumeCapture: String
    let pauseCapture: String
    let reopenApproval: String
    let connectToTrail: String
    let promptModeItem: String
    let autoEnter: String
    let denyHeader: String
    let ocrActive: String
    let ocrNeedsPermission: String
    let disconnect: String
    let settings: String
    let quit: String

    // menubar — start at login (F201.20)
    let startAtLogin: String

    // menubar — voice enrollment (F201.6.6 speaker gate)
    let voiceFilterEnrolled: String
    let voiceFilterNone: String
    let enrollVoice: String
    let enrollFinish: String
    let enrollReEnroll: String
    let clearVoicePrint: String
    let enrollNeedsMic: String
    let enrollFailed: String
    let enrollTooShort: String
    let enrollBuilding: String
    let enrollDoneFmt: String

    // F263.7 — Ingest-vinduet
    let ingestWindowTitle: String
    let ingestDropTitle: String
    let ingestDropHint: String
    let ingestChooseFiles: String
    let ingestAccepted: String
    let ingestTabQueue: String
    let ingestTabDone: String
    let ingestEmptyQueue: String
    let ingestEmptyDone: String
    let ingestNeuronsSuffix: String
    let ingestStateWaiting: String
    let ingestStateCompiling: String
    let ingestStateFailed: String
    let ingestEngineThisMac: String
    let ingestEngineCloud: String
    let ingestEngineUnknown: String
    let ingestEngineStale: String
    let ingestEngineNobody: String
    let ingestOpenWindow: String
    let ingestUploading: String
    let ingestNotConnected: String
    let ingestForbidden: String
    let ingestServerError: String
    let ingestNetworkError: String
    let ingestUnexpected: String
    let ingestRetry: String
    let ingestPaste: String
    let ingestPasteTitle: String
    let ingestPastePlaceholder: String
    let ingestPasteSave: String
    let ingestCancel: String
    let ingestTenantPrefix: String
    let ingestAddTenant: String
    let ingestNoKey: String
    let ingestKeyPrompt: String
    let ingestKeyHelp: String
    let ingestKeySave: String
    let ingestKeyCancel: String
    let ingestNoTenant: String
    let ingestTenantHelp: String
    let ingestEngineNotSetUp: String
    let engineDaemonUnreachable: String
    let engineDaemonUnexpected: String
    let engineNoJobs: String
    let engineToggleFailed: String
    let engineNoSession: String
    let engineOn: String
    let engineOff: String
    let engineMixedFmt: String
    let engineNextIn: String
    let engineTriggered: String
}

extension UIStrings {
    /// Active language — English.
    static let en = UIStrings(
        searchMode: "Search",
        askMode: "Ask",
        searchPlaceholder: "Search your Trail…",
        askPlaceholder: "Ask your Trail…",

        micHelpNeedsPermission: "Grant microphone + speech access to dictate",
        micHelpIdle: "Dictate (⌃⌥D) — text appears as you speak",
        micHelpListening: "Stop and save to Trail",
        listeningHint: "Listening… speak freely, text appears as you talk",
        stopHint: "press ⏹",
        noSpeech: "No speech captured — try again closer to the microphone.",

        transcribing: "Transcribing the full recording…",
        saving: "Saving to Trail…",
        saved: "✓ Saved to Trail",
        duplicate: "Already saved (duplicate)",
        saveFailed: "Couldn't save to Trail — try again",
        notYourVoice: "Not saved — this isn't your enrolled voice",

        lookingUp: "Looking up…",
        noNeurons: "No Neurons match yet.",
        searchHint: "Type and press ↵ to search your knowledge.",
        sourcesLabel: "SOURCES",
        noAnswer: "No answer.",
        askHint: "Ask a question, press ↵ — Trail answers with sources.",

        footerRun: "run",
        footerSwitchField: "switch field",
        footerClose: "close",
        noFocusedField: "No focused field",
        targetPrefix: "Target:",
        fromPrefix: "From:",

        tooltipPaused: "Trail Ambient — paused (no capture)",
        tooltipActive: "Trail Ambient — capturing actively",

        statePaused: "Paused — no capture",
        stateActive: "Capturing actively",
        waitingApproval: "Waiting for approval in the browser…",
        notConnected: "Not connected to Trail",
        lookUpInTrail: "Look up",
        writingToPrefix: "Writing to:",
        resumeCapture: "Resume capture",
        pauseCapture: "Pause capture",
        reopenApproval: "Reopen the approval page",
        connectToTrail: "Connect to Trail…",
        promptModeItem: "Prompt mode",
        autoEnter: "Send automatically (Enter)",
        denyHeader: "Never capture from:",
        ocrActive: "Screen OCR: active (on-device)",
        ocrNeedsPermission: "Screen OCR: needs Screen Recording permission",
        disconnect: "Disconnect from Trail",
        settings: "Settings",
        quit: "Quit Trail Ambient",

        startAtLogin: "Start at login",

        voiceFilterEnrolled: "Voice filter: on (your voice enrolled)",
        voiceFilterNone: "Voice filter: off — enroll to capture only your voice",
        enrollVoice: "Enroll my voice…",
        enrollFinish: "Finish recording — speak now",
        enrollReEnroll: "Re-enroll my voice…",
        clearVoicePrint: "Remove my voice-print",
        enrollNeedsMic: "Grant microphone access to enroll",
        enrollFailed: "Couldn't start recording — try again",
        enrollTooShort: "Not enough speech — hold longer and try again",
        enrollBuilding: "Building your voice-print…",
        enrollDoneFmt: "✓ Voice-print saved (%.0fs)",
        ingestWindowTitle: "Trail Ingest",
        ingestDropTitle: "Drop files here",
        ingestDropHint: "or choose files…",
        ingestChooseFiles: "Choose files…",
        ingestAccepted: "pdf · docx · md · txt · png · jpg · mp3 · m4a · wav",
        ingestTabQueue: "Queue",
        ingestTabDone: "Done",
        ingestEmptyQueue: "Nothing waiting. Drop a file above.",
        ingestEmptyDone: "No compiled sources yet.",
        ingestNeuronsSuffix: "neurons",
        ingestStateWaiting: "in queue",
        ingestStateCompiling: "compiling",
        ingestStateFailed: "failed",
        ingestEngineThisMac: "This Mac compiles",
        ingestEngineCloud: "The cloud compiles",
        ingestEngineUnknown: "Engine state unknown",
        ingestEngineStale: "could not reach buddy · last measured",
        ingestEngineNobody: "No machine connected",
        ingestOpenWindow: "Ingest…",
        ingestUploading: "Uploading",
        ingestNotConnected: "Not connected to Trail — pair this Mac first.",
        ingestForbidden: "This device is not allowed to do that.",
        ingestServerError: "Trail answered with an error",
        ingestNetworkError: "Could not reach Trail:",
        ingestUnexpected: "Trail answered in a shape we did not expect.",
        ingestRetry: "Try again",
        ingestPaste: "Paste text…",
        ingestPasteTitle: "Title (optional)",
        ingestPastePlaceholder: "Paste or type the text you want Trail to learn…",
        ingestPasteSave: "Add to Trail",
        ingestCancel: "Cancel",
        ingestTenantPrefix: "Account:",
        ingestAddTenant: "Trail key…",
        ingestNoKey: "No Trail key yet — add one to pick an account.",
        ingestKeyPrompt: "Paste your Trail API key",
        ingestKeyHelp: "Settings → API keys on app.trailmem.com. The same kind of key the Web Clipper uses — it reaches every account you are a member of.",
        ingestKeySave: "Save",
        ingestKeyCancel: "Cancel",
        ingestNoTenant: "No account",
        ingestTenantHelp: "Switch account — each one has its own key on this Mac.",
        ingestEngineNotSetUp: "this Mac is not an engine yet",
        engineDaemonUnreachable: "buddy is not running — the engine switch is unavailable",
        engineDaemonUnexpected: "buddy answered in an unexpected shape",
        engineNoJobs: "no local-ingest job is registered with buddy",
        engineToggleFailed: "buddy refused the change — the switch is unchanged",
        engineNoSession: "no live session to compile in — the cloud will take it",
        engineOn: "This Mac compiles",
        engineOff: "This Mac is switched off",
        engineMixedFmt: "Partly on",
        engineNextIn: "next check in",
        engineTriggered: "asked for it now"    )

    /// Original Danish — preserved so the UI can flip back with one line.
    static let da = UIStrings(
        searchMode: "Søg",
        askMode: "Spørg",
        searchPlaceholder: "Søg i din Trail…",
        askPlaceholder: "Spørg din Trail…",

        micHelpNeedsPermission: "Giv adgang til mikrofon + tale for at diktere",
        micHelpIdle: "Diktér (⌃⌥D) — teksten skrives mens du taler",
        micHelpListening: "Stop og gem i Trail",
        listeningHint: "Lytter… tal frit, teksten skrives mens du taler",
        stopHint: "tryk ⏹",
        noSpeech: "Ingen tale opfanget — prøv igen tættere på mikrofonen.",

        transcribing: "Transskriberer hele optagelsen…",
        saving: "Gemmer i Trail…",
        saved: "✓ Gemt i Trail",
        duplicate: "Allerede gemt (dublet)",
        saveFailed: "Kunne ikke gemme i Trail — prøv igen",
        notYourVoice: "Ikke gemt — dette er ikke din stemme",

        lookingUp: "Slår op…",
        noNeurons: "Ingen Neuroner matcher endnu.",
        searchHint: "Skriv og tryk ↵ for at søge i din viden.",
        sourcesLabel: "KILDER",
        noAnswer: "Intet svar.",
        askHint: "Stil et spørgsmål, tryk ↵ — Trail svarer med kilder.",

        footerRun: "udfør",
        footerSwitchField: "skift felt",
        footerClose: "luk",
        noFocusedField: "Intet fokuseret felt",
        targetPrefix: "Target:",
        fromPrefix: "Fra:",

        tooltipPaused: "Trail Ambient — på pause (ingen capture)",
        tooltipActive: "Trail Ambient — capturer aktivt",

        statePaused: "På pause — ingen capture",
        stateActive: "Capturer aktivt",
        waitingApproval: "Venter på godkendelse i browseren…",
        notConnected: "Ikke forbundet til Trail",
        lookUpInTrail: "Slå op",
        writingToPrefix: "Skriver til:",
        resumeCapture: "Genoptag capture",
        pauseCapture: "Pause capture",
        reopenApproval: "Åbn godkendelses-siden igen",
        connectToTrail: "Forbind til Trail…",
        promptModeItem: "Prompt mode",
        autoEnter: "Send automatisk (Enter)",
        denyHeader: "Capturer aldrig fra:",
        ocrActive: "Skærm-OCR: aktiv (on-device)",
        ocrNeedsPermission: "Skærm-OCR: kræver Skærmoptagelse-tilladelse",
        disconnect: "Frakobl fra Trail",
        settings: "Indstillinger",
        quit: "Afslut Trail Ambient",

        startAtLogin: "Start ved login",

        voiceFilterEnrolled: "Stemmefilter: til (din stemme er optaget)",
        voiceFilterNone: "Stemmefilter: fra — optag for kun at fange din stemme",
        enrollVoice: "Optag min stemme…",
        enrollFinish: "Afslut optagelse — tal nu",
        enrollReEnroll: "Optag min stemme igen…",
        clearVoicePrint: "Slet mit stemme-aftryk",
        enrollNeedsMic: "Giv mikrofon-adgang for at optage",
        enrollFailed: "Kunne ikke starte optagelse — prøv igen",
        enrollTooShort: "Ikke nok tale — hold længere og prøv igen",
        enrollBuilding: "Bygger dit stemme-aftryk…",
        enrollDoneFmt: "✓ Stemme-aftryk gemt (%.0fs)",
        ingestWindowTitle: "Trail Ingest",
        ingestDropTitle: "Slip filer her",
        ingestDropHint: "eller vælg filer…",
        ingestChooseFiles: "Vælg filer…",
        ingestAccepted: "pdf · docx · md · txt · png · jpg · mp3 · m4a · wav",
        ingestTabQueue: "Kø",
        ingestTabDone: "Færdig",
        ingestEmptyQueue: "Intet venter. Slip en fil ovenfor.",
        ingestEmptyDone: "Ingen kompilerede kilder endnu.",
        ingestNeuronsSuffix: "neuroner",
        ingestStateWaiting: "i kø",
        ingestStateCompiling: "kompilerer",
        ingestStateFailed: "fejlede",
        ingestEngineThisMac: "Denne Mac kompilerer",
        ingestEngineCloud: "Skyen kompilerer",
        ingestEngineUnknown: "Motorens tilstand er ukendt",
        ingestEngineStale: "kunne ikke nå buddy · sidst målt for",
        ingestEngineNobody: "Ingen maskine tilsluttet",
        ingestOpenWindow: "Ingest…",
        ingestUploading: "Uploader",
        ingestNotConnected: "Ikke forbundet til Trail — par denne Mac først.",
        ingestForbidden: "Denne enhed må ikke gøre det.",
        ingestServerError: "Trail svarede med en fejl",
        ingestNetworkError: "Kunne ikke nå Trail:",
        ingestUnexpected: "Trail svarede i en form vi ikke forventede.",
        ingestRetry: "Prøv igen",
        ingestPaste: "Indsæt tekst…",
        ingestPasteTitle: "Titel (valgfri)",
        ingestPastePlaceholder: "Indsæt eller skriv den tekst Trail skal lære…",
        ingestPasteSave: "Føj til Trail",
        ingestCancel: "Annullér",
        ingestTenantPrefix: "Konto:",
        ingestAddTenant: "Trail-nøgle…",
        ingestNoKey: "Ingen Trail-nøgle endnu — tilføj én for at vælge konto.",
        ingestKeyPrompt: "Indsæt din Trail API-nøgle",
        ingestKeyHelp: "Indstillinger → API-nøgler på app.trailmem.com. Samme slags nøgle som Web Clipper bruger — den når alle de konti du er medlem af.",
        ingestKeySave: "Gem",
        ingestKeyCancel: "Annullér",
        ingestNoTenant: "Ingen konto",
        ingestTenantHelp: "Skift konto — hver har sin egen nøgle på denne Mac.",
        ingestEngineNotSetUp: "denne Mac er ikke motor endnu",
        engineDaemonUnreachable: "buddy kører ikke — motor-kontakten er utilgængelig",
        engineDaemonUnexpected: "buddy svarede i en uventet form",
        engineNoJobs: "der er ikke registreret et local-ingest-job hos buddy",
        engineToggleFailed: "buddy afviste ændringen — kontakten står uændret",
        engineNoSession: "ingen levende session at kompilere i — skyen tager den",
        engineOn: "Denne Mac kompilerer",
        engineOff: "Denne Mac er slået fra",
        engineMixedFmt: "Delvist slået til",
        engineNextIn: "næste tjek om",
        engineTriggered: "bedt om det nu"    )
}

/// The active UI language. Flip to `UIStrings.da` to switch the whole app.
let S = UIStrings.en
