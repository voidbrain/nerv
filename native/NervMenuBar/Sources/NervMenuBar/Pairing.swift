import Foundation
struct Invitation: Codable {
    let version: Int
    let ticket: String
    let runtimeId: String
    let port: Int
    let webPort: Int
    let fingerprint: String
    let expiresAt: Int64
    static func decode(_ text: String, now: Date = Date()) throws -> Invitation {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count <= 4096, text.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { throw NativeError.invalidInvitation }
        var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64) else { throw NativeError.invalidInvitation }
        let value = try JSONDecoder().decode(Invitation.self, from: data)
        let milliseconds = Int64(now.timeIntervalSince1970 * 1000)
        guard value.version == 1, UUID(uuidString: value.runtimeId) != nil, (1...65535).contains(value.port), (1...65535).contains(value.webPort), value.port != value.webPort,
              value.fingerprint.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              value.ticket.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              value.expiresAt > milliseconds, value.expiresAt <= milliseconds + 150_000 else { throw NativeError.invalidInvitation }
        return value
    }
}
struct Credential: Codable {
    let clientId: String
    let token: String
    let expiresAt: Int64
    let runtimeId: String
    let port: Int
    let webPort: Int
    let fingerprint: String
}
enum NativeError: LocalizedError {
    case invalidInvitation, certificateMismatch, requestFailed, identityMismatch, keychain, expired
    var errorDescription: String? {
        switch self {
        case .invalidInvitation: return "Invito non valido o scaduto. Genera un nuovo invito con npm start -- pair."
        case .certificateMismatch: return "Identità TLS di NERV non verificata. Nessuna credenziale inviata."
        case .requestFailed: return "NERV non disponibile o richiesta rifiutata. Verifica servizio e abbinamento."
        case .identityMismatch: return "L’identità di NERV è cambiata. Ripeti l’abbinamento."
        case .keychain: return "Accesso al Portachiavi non riuscito."
        case .expired: return "Abbinamento scaduto. Genera un nuovo invito."
        }
    }
}
