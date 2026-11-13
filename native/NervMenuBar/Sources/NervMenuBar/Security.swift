import Foundation
import Security
import CryptoKit
final class PinnedDelegate: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let fingerprint: String
    let port: Int
    private(set) var pinRejected = false
    init(fingerprint: String, port: Int) { self.fingerprint = fingerprint; self.port = port }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust else { completionHandler(.performDefaultHandling, nil); return }
        guard challenge.protectionSpace.host == "127.0.0.1", challenge.protectionSpace.port == port,
              let trust = challenge.protectionSpace.serverTrust,
              let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let certificate = chain.first else { pinRejected = true; completionHandler(.cancelAuthenticationChallenge, nil); return }
        let actual = SHA256.hash(data: SecCertificateCopyData(certificate) as Data).map { String(format: "%02x", $0) }.joined()
        guard actual == fingerprint else { pinRejected = true; completionHandler(.cancelAuthenticationChallenge, nil); return }
        SecTrustSetPolicies(trust, SecPolicyCreateSSL(true, "127.0.0.1" as CFString))
        SecTrustSetAnchorCertificates(trust, [certificate] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        guard SecTrustEvaluateWithError(trust, nil) else { pinRejected = true; completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
final class NativeConnection {
    private let session: URLSession
    private let port: Int
    private let delegate: PinnedDelegate
    init(port: Int, fingerprint: String) {
        self.port = port
        let delegate = PinnedDelegate(fingerprint: fingerprint, port: port)
        self.delegate = delegate
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 5
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        self.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }
    static func transportError(_ error: Error, pinRejected: Bool) -> NativeError {
        if pinRejected || (error as? URLError)?.code == .cancelled { return .certificateMismatch }
        if let urlError = error as? URLError, [.cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .timedOut, .notConnectedToInternet].contains(urlError.code) {
            return .serviceUnreachable
        }
        return .requestFailed
    }
    static func httpError(statusCode: Int) -> NativeError {
        statusCode == 401 ? .pairingRevoked : .requestFailed
    }
    func request(_ path: String, token: String? = nil, body: [String: String]? = nil) async throws -> Data {
        var request = URLRequest(url: URL(string: "https://127.0.0.1:\(port)\(path)")!)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body) }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw Self.transportError(error, pinRejected: delegate.pinRejected)
        }
        guard let http = response as? HTTPURLResponse else { throw NativeError.requestFailed }
        guard (200...299).contains(http.statusCode) else { throw Self.httpError(statusCode: http.statusCode) }
        guard data.count <= 1_048_576 else { throw NativeError.requestFailed }
        return data
    }
}
enum CredentialStore {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "io.nerv.companion", kSecAttrAccount as String: "paired-runtime"]
    /// Pre-rename item: moved to the new service name on first load, then deleted.
    static let previousQuery: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "io.nodo.companion", kSecAttrAccount as String: "paired-runtime"]
    private static func read(_ base: [String: Any]) throws -> Data? {
        var request = base; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw NativeError.keychain }
        return data
    }
    static func load() throws -> Credential? {
        if let data = try read(query) { return try JSONDecoder().decode(Credential.self, from: data) }
        guard let data = try read(previousQuery) else { return nil }
        let credential = try JSONDecoder().decode(Credential.self, from: data)
        try save(credential); SecItemDelete(previousQuery as CFDictionary)
        return credential
    }
    static func save(_ credential: Credential) throws {
        let data = try JSONEncoder().encode(credential)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound { var request = query; request[kSecValueData as String] = data; guard SecItemAdd(request as CFDictionary, nil) == errSecSuccess else { throw NativeError.keychain } }
        else if status != errSecSuccess { throw NativeError.keychain }
    }
    static func forget() throws { let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeError.keychain } }
}
