// F201.3 — device-auth client for the F201.2 flow (RFC 8628-lite).
//
// "Forbind til Trail…" generates a random 64-hex code, opens the approve
// page in the browser (app.trailmem.com, session-authed there), and polls
// the ENGINE's token endpoint until the single-use exchange releases the
// 'ambient'-scoped trail_ token. NOTE: the poll targets the engine base,
// NOT app.trailmem.com — the admin proxy 401s unauthenticated requests
// before proxying (verified in F201.2).
//
// The token is stored in the macOS Keychain (never UserDefaults, never a
// file); only the device name + granted KB ids live in UserDefaults.
import AppKit
import Security

/// Where the connect flow currently is — drives the menubar copy so a user
/// never re-clicks "Forbind" while a poll is already listening (the two-code
/// bug Christian hit 2026-07-02).
enum ConnectState: Equatable {
    case disconnected
    case waiting          // browser opened, polling for approval
    case connected
}

@MainActor
final class DeviceAuth {
    private static let connectBase = "https://app.trailmem.com"
    private static let engineBase = "https://engine-001.trailmem.com"
    private nonisolated static let keychainService = "com.broberg.trail-ambient"
    private nonisolated static let keychainAccount = "trail-api-token"

    private var pollTask: Task<Void, Never>?

    private(set) var state: ConnectState = .disconnected

    var isConnected: Bool { Self.loadToken() != nil }

    /// "Christian Broberg" / "cb@webhouse.dk" — whichever the engine returned.
    var accountLabel: String {
        UserDefaults.standard.string(forKey: "trail.displayName")
            ?? UserDefaults.standard.string(forKey: "trail.email")
            ?? "Trail-konto"
    }

    var accountEmail: String? { UserDefaults.standard.string(forKey: "trail.email") }
    var tenantLabel: String? { UserDefaults.standard.string(forKey: "trail.tenant") }
    var kbLabel: String? {
        (UserDefaults.standard.array(forKey: "trail.kbNames") as? [String])?.joined(separator: ", ")
    }

    var connectionLabel: String {
        UserDefaults.standard.string(forKey: "trail.deviceName") ?? "Trail"
    }

    init() {
        state = isConnected ? .connected : .disconnected
    }

    func beginConnect(onChange: @escaping @MainActor () -> Void) {
        // Two-code guard: if a poll is already listening, just re-open the
        // SAME approve page instead of minting a second code the agent then
        // ignores. This is the fix for Christian's "godkendte 2 gange" churn.
        if state == .waiting, let code = pendingCode {
            NSWorkspace.shared.open(connectURL(code: code))
            return
        }

        let code = Self.randomCode()
        pendingCode = code
        state = .waiting
        onChange()
        NSWorkspace.shared.open(connectURL(code: code))
        EventLog.shared.log(kind: "device_auth_started")

        pollTask?.cancel()
        pollTask = Task { [weak self] in
            // Poll every 3 s inside the code's 10-min TTL window.
            for _ in 0..<200 {
                if Task.isCancelled { return }
                if await self?.tryClaim(code: code) == true {
                    await MainActor.run {
                        self?.state = .connected
                        self?.pendingCode = nil
                        onChange()
                    }
                    return
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
            await MainActor.run {
                // Window closed without approval — back to a clean state so
                // the next click starts fresh instead of re-using a dead code.
                self?.state = self?.isConnected == true ? .connected : .disconnected
                self?.pendingCode = nil
                onChange()
            }
            EventLog.shared.log(kind: "device_auth_timed_out")
        }
    }

    private var pendingCode: String?

    private func connectURL(code: String) -> URL {
        let device = Host.current().localizedName ?? "Mac"
        var comps = URLComponents(string: "\(Self.connectBase)/ambient/connect")!
        comps.queryItems = [.init(name: "code", value: code), .init(name: "name", value: device)]
        return comps.url!
    }

    func disconnect() {
        pollTask?.cancel()
        pendingCode = nil
        state = .disconnected
        Self.deleteToken()
        for key in ["trail.deviceName", "trail.kbIds", "trail.kbNames", "trail.email", "trail.displayName", "trail.tenant"] {
            UserDefaults.standard.removeObject(forKey: key)
        }
        EventLog.shared.log(kind: "device_auth_disconnected")
    }

    private struct ClaimResponse: Decodable {
        let token: String
        let kbIds: [String]
        let kbNames: [String]?
        let deviceName: String
        let email: String?
        let displayName: String?
        let tenant: String?
    }

    private func tryClaim(code: String) async -> Bool {
        var req = URLRequest(url: URL(string: "\(Self.engineBase)/api/v1/ambient/token")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(["code": code])
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else { return false }
        switch http.statusCode {
        case 200:
            guard let claim = try? JSONDecoder().decode(ClaimResponse.self, from: data) else { return false }
            Self.storeToken(claim.token)
            let d = UserDefaults.standard
            d.set(claim.deviceName, forKey: "trail.deviceName")
            d.set(claim.kbIds, forKey: "trail.kbIds")
            if let names = claim.kbNames { d.set(names, forKey: "trail.kbNames") }
            if let email = claim.email { d.set(email, forKey: "trail.email") }
            if let name = claim.displayName { d.set(name, forKey: "trail.displayName") }
            if let tenant = claim.tenant { d.set(tenant, forKey: "trail.tenant") }
            EventLog.shared.log(kind: "device_auth_connected")
            return true
        case 404:
            // Not approved yet (or ship-dark on the engine) — keep polling
            // until TTL; the timeout log tells the user what happened.
            return false
        case 410:
            EventLog.shared.log(kind: "device_auth_code_expired")
            return false
        default:
            return false
        }
    }

    // ── Keychain ─────────────────────────────────────────────────────────

    private static func storeToken(_ token: String) {
        deleteToken()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: Data(token.utf8),
        ]
        SecItemAdd(query as CFDictionary, nil)
    }

    // nonisolated: a pure Keychain read with no actor state, so the HUD's
    // networking (off the main actor) can read the token directly.
    nonisolated static func loadToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static func randomCode() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }
}
