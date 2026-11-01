import Foundation
import Security
import CryptoKit
final class PinnedDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let fingerprint: String
    let port: Int
    init(fingerprint: String, port: Int) { self.fingerprint = fingerprint; self.port = port }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else { completionHandler(.performDefaultHandling, nil); return }
        guard challenge.protectionSpace.host == "127.0.0.1", challenge.protectionSpace.port == port,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let certificate = chain.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let actual = SHA256.hash(data: SecCertificateCopyData(certificate) as Data).map { String(format: "%02x", $0) }.joined()
        guard actual == fingerprint else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, "127.0.0.1" as CFString))
        SecTrustSetAnchorCertificates(trust, [certificate] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        guard SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class NativeConnection {
    private let session: URLSession
    private let port: Int
    init(port: Int, fingerprint: String) {
        self.port = port
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        self.session = URLSession(configuration: configuration, delegate: PinnedDelegate(fingerprint: fingerprint, port: port), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    func request(_ path: String, token: String? = nil, body: [String: String]? = nil) async throws -> Data {
        var request = URLRequest(url: URL(string: "https://127.0.0.1:\(port)\(path)")!)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200...299).contains(response.statusCode), data.count <= 1_048_576 else { throw NativeError.requestFailed }
        return data
    }
}
enum CredentialStore {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "io.nodo.companion", kSecAttrAccount as String: "paired-runtime"]
    static func load() throws -> Credential? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw NativeError.keychain }
        return try JSONDecoder().decode(Credential.self, from: data)
    }
    static func save(_ credential: Credential) throws {
        let data = try JSONEncoder().encode(credential)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound { var request = query; request[kSecValueData as String] = data; guard SecItemAdd(request as CFDictionary, nil) == errSecSuccess else { throw NativeError.keychain } }
        else if status != errSecSuccess { throw NativeError.keychain }
    }
    static func forget() throws { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeError.keychain } }
}
