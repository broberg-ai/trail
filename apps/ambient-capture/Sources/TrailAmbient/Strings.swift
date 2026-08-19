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
        lookUpInTrail: "Look up in Trail…",
        writingToPrefix: "Writing to:",
        resumeCapture: "Resume capture",
        pauseCapture: "Pause capture",
        reopenApproval: "Reopen the approval page",
        connectToTrail: "Connect to Trail…",
        promptModeItem: "Prompt Mode — dictate to session",
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
        enrollDoneFmt: "✓ Voice-print saved (%.0fs)"
    )

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
        lookUpInTrail: "Slå op i Trail…",
        writingToPrefix: "Skriver til:",
        resumeCapture: "Genoptag capture",
        pauseCapture: "Pause capture",
        reopenApproval: "Åbn godkendelses-siden igen",
        connectToTrail: "Forbind til Trail…",
        promptModeItem: "Prompt Mode — diktér til session",
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
        enrollDoneFmt: "✓ Stemme-aftryk gemt (%.0fs)"
    )
}

/// The active UI language. Flip to `UIStrings.da` to switch the whole app.
let S = UIStrings.en
