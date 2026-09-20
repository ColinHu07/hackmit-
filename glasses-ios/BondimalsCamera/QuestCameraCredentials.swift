import Foundation
import Security

/// The existing camera authorization survives an app restart on this phone.
/// No pairing code, game-player token, or captured media is persisted.
enum QuestCameraCredentials {
    private struct Credential: Codable { let origin: String; let token: String }
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.bondimals.camera.quest-camera",
         kSecAttrAccount as String: "current-game-camera",
         kSecAttrSynchronizable as String: false]
    }

    static func save(origin: URL, token: String) {
        guard let data = try? JSONEncoder().encode(Credential(origin: origin.absoluteString, token: token)) else { return }
        clear()
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        if SecItemAdd(item as CFDictionary, nil) != errSecSuccess {
            NSLog("Kith: camera authorization could not be saved on this phone")
        }
    }

    static func load(origin: URL) -> String? {
        var item = query
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        guard let credential = try? JSONDecoder().decode(Credential.self, from: data),
              credential.origin == origin.absoluteString,
              credential.token.range(of: "^[a-f0-9]{48}$", options: .regularExpression) != nil else {
            clear(); return nil
        }
        return credential.token
    }

    static func clear() { SecItemDelete(query as CFDictionary) }
}
