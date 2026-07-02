// F201.9 — global hotkey via Carbon RegisterEventHotKey. A menubar app has
// no key window most of the time, so an NSEvent local monitor won't fire;
// Carbon's system-wide hotkey is the standard mechanism (same as Spotlight-
// style launchers). Default: ⌃⌥T (Control+Option+T) — "T for Trail".
import AppKit
import Carbon.HIToolbox

@MainActor
final class HotKey {
    private var ref: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let onFire: @MainActor () -> Void
    private let hotKeyId: UInt32

    // kVK_ANSI_T = 0x11; control+option. `id` distinguishes multiple hotkeys —
    // each instance installs a handler on the app event target, so without a
    // distinct id every handler would fire for every registered combo.
    init(keyCode: UInt32 = UInt32(kVK_ANSI_T),
         modifiers: UInt32 = UInt32(controlKey | optionKey),
         id: UInt32 = 1,
         onFire: @escaping @MainActor () -> Void) {
        self.onFire = onFire
        self.hotKeyId = id
        install(keyCode: keyCode, modifiers: modifiers)
    }

    private func install(keyCode: UInt32, modifiers: UInt32) {
        let id = EventHotKeyID(signature: OSType(0x54524149 /* "TRAI" */), id: hotKeyId)
        var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))

        let selfPtr = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            guard let userData else { return noErr }
            let me = Unmanaged<HotKey>.fromOpaque(userData).takeUnretainedValue()
            var hkID = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hkID)
            if hkID.id == me.hotKeyId {
                DispatchQueue.main.async { MainActor.assumeIsolated { me.onFire() } }
                return noErr
            }
            // NOT ours — every HotKey instance installs a handler on the app
            // event target, so returning noErr here would swallow a hotkey meant
            // for another instance (the capture handler ate ⌃⌥T before the HUD
            // handler saw it). Signal "not handled" so propagation continues.
            return OSStatus(eventNotHandledErr)
        }, 1, &eventType, selfPtr, &handler)

        RegisterEventHotKey(keyCode, modifiers, id, GetApplicationEventTarget(), 0, &ref)
    }

    deinit {
        if let ref { UnregisterEventHotKey(ref) }
        if let handler { RemoveEventHandler(handler) }
    }
}
