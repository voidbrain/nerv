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
    case invalidInvitation, certificateMismatch, requestFailed, serviceUnreachable, pairingRevoked, identityMismatch, keychain, expired
    var errorDescription: String? { message(language: "it") }
    func message(language: String) -> String {
        let en = language == "en"
        switch self {
        case .invalidInvitation:
            return en ? "Invalid or expired invitation. Generate a new one with npm start -- pair." : "Invito non valido o scaduto. Genera un nuovo invito con npm start -- pair."
        case .certificateMismatch:
            return en ? "NERV's TLS certificate changed or no longer matches the pairing. Nothing was sent." : "Il certificato TLS di NERV è cambiato o non corrisponde all’abbinamento. Nessun dato inviato."
        case .serviceUnreachable:
            return en ? "NERV service is unreachable. Check that it is running." : "Servizio NERV non raggiungibile. Verifica che sia avviato."
        case .pairingRevoked:
            return en ? "Pairing was revoked or expired. Pair again with a new invitation." : "Abbinamento revocato o scaduto. Ripeti l’abbinamento con un nuovo invito."
        case .requestFailed:
            return en ? "Request to NERV failed. Check service and pairing." : "Richiesta a NERV non riuscita. Verifica servizio e abbinamento."
        case .identityMismatch:
            return en ? "NERV identity changed. Pair again." : "L’identità di NERV è cambiata. Ripeti l’abbinamento."
        case .keychain:
            return en ? "Keychain access failed." : "Accesso al Portachiavi non riuscito."
        case .expired:
            return en ? "Pairing expired. Generate a new invitation." : "Abbinamento scaduto. Genera un nuovo invito."
        }
    }
}

// Renewal never sends an existing credential to a newly supplied identity or certificate.
extension Credential {
    func renewalInvitation(_ text: String, now: Date = Date()) throws -> Invitation {
        let next = try Invitation.decode(text, now: now)
        guard expiresAt > Int64(now.timeIntervalSince1970 * 1000) else { throw NativeError.expired }
        guard next.runtimeId == runtimeId, next.fingerprint == fingerprint, next.port == port, next.webPort == webPort,
              token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NativeError.identityMismatch }
        return next
    }
}
