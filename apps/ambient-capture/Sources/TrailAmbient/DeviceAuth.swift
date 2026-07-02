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

@MainActor
final class DeviceAuth {
    private static let connectBase = "https://app.trailmem.com"
    private static let engineBase = "https://engine-001.trailmem.com"
    private static let keychainService = "com.broberg.trail-ambient"
    private static let keychainAccount = "trail-api-token"

    private var pollTask: Task<Void, Never>?

    var isConnected: Bool { Self.loadToken() != nil }

    var connectionLabel: String {
        UserDefaults.standard.string(forKey: "trail.deviceName") ?? "Trail"
    }

    func beginConnect(onChange: @escaping @MainActor () -> Void) {
        let code = Self.randomCode()
        let device = Host.current().localizedName ?? "Mac"
        var comps = URLComponents(string: "\(Self.connectBase)/ambient/connect")!
        comps.queryItems = [
            .init(name: "code", value: code),
            .init(name: "name", value: device),
        ]
        NSWorkspace.shared.open(comps.url!)
        EventLog.shared.log(kind: "device_auth_started")

        pollTask?.cancel()
        pollTask = Task { [weak self] in
            // Poll every 3 s inside the code's 10-min TTL window.
            for _ in 0..<200 {
                if Task.isCancelled { return }
                if await self?.tryClaim(code: code) == true {
                    await MainActor.run { onChange() }
                    return
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
            EventLog.shared.log(kind: "device_auth_timed_out")
        }
    }

    func disconnect() {
        pollTask?.cancel()
        Self.deleteToken()
        UserDefaults.standard.removeObject(forKey: "trail.deviceName")
        UserDefaults.standard.removeObject(forKey: "trail.kbIds")
        EventLog.shared.log(kind: "device_auth_disconnected")
    }

    private struct ClaimResponse: Decodable {
        let token: String
        let kbIds: [String]
        let deviceName: String
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
            UserDefaults.standard.set(claim.deviceName, forKey: "trail.deviceName")
            UserDefaults.standard.set(claim.kbIds, forKey: "trail.kbIds")
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

    static func loadToken() -> String? {
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
