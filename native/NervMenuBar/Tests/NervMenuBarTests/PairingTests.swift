import XCTest
@testable import NervMenuBar
private final class FixtureCheckpoint: CheckpointStorage {
    var value: InboxCheckpoint?
    func load(_ runtime: String) throws -> InboxCheckpoint? { value }
    func save(_ runtime: String, _ checkpoint: InboxCheckpoint) throws { value = checkpoint }
}
private final class FixtureNotificationSink: NotificationSink {
    var delivered: Set<String> = []
    func existingIdentifiers() async -> Set<String> { delivered }
    func deliver(identifier: String, body: String) async throws { delivered.insert(identifier) }
}
final class PairingTests: XCTestCase {
    func encoded(_ value: Invitation) throws -> String { try JSONEncoder().encode(value).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    func testBoundedLocalInvitation() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let good = Invitation(version: 1, ticket: String(repeating: "a", count: 64), runtimeId: UUID().uuidString, port: 4319, webPort: 4317, fingerprint: String(repeating: "b", count: 64), expiresAt: Int64(now.timeIntervalSince1970 * 1000) + 120_000)
        XCTAssertEqual(try Invitation.decode(encoded(good), now: now).port, 4319)
        XCTAssertThrowsError(try Invitation.decode(encoded(good), now: now.addingTimeInterval(121)))
        XCTAssertThrowsError(try Invitation.decode("https://attacker.invalid"))
        XCTAssertThrowsError(try Invitation.decode(String(repeating: "a", count: 5000)))
    }
}
extension PairingTests {
    func testPinnedTLSAndReadOnlySession() async throws {
        guard let path = ProcessInfo.processInfo.environment["NERV_NATIVE_FIXTURE"] else { throw XCTSkip("Native TLS fixture not running") }
        let invitation = try Invitation.decode(String(contentsOfFile: path, encoding: .utf8))
        let connection = NativeConnection(port: invitation.port, fingerprint: invitation.fingerprint)
        let claimData = try await connection.request("/api/pairing/claim", body: ["ticket": invitation.ticket])
        let claim = try JSONDecoder().decode(Claim.self, from: claimData)
        XCTAssertEqual(claim.runtimeId, invitation.runtimeId)
        let doctor = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/doctor", token: claim.token))
        XCTAssertEqual(doctor.runtimeId, invitation.runtimeId)
        let status = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/status", token: claim.token))
        XCTAssertEqual(status.runtimeId, invitation.runtimeId)
        let cards = try NativeApproval.page(await connection.request("/api/approvals?limit=5", token: claim.token))
        let card = try XCTUnwrap(cards.first)
        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(card.card.tool, "fixture.review")
        XCTAssertTrue(card.argumentsText.contains("review@example.invalid"))
        XCTAssertTrue(card.argumentsText.contains("+ neutral change"))
        XCTAssertGreaterThan(card.remainingSeconds(at: Date()), 0)
        for decision in ["approve", "reject", "edit"] {
            do { _ = try await connection.request("/api/approvals/\(card.id)", token: claim.token, body: ["decision": decision]); XCTFail("Read-only client decided a card") } catch { }
        }
        let unchanged = try NativeApproval.page(await connection.request("/api/approvals?limit=5", token: claim.token))
        XCTAssertEqual(unchanged.map(\.id), cards.map(\.id))
        let inbox = try JSONDecoder().decode(InboxPage.self, from: await connection.request("/api/inbox/page?after=0&limit=5", token: claim.token))
        XCTAssertEqual(inbox.head.sequence, 1)
        let notice = try XCTUnwrap(inbox.items.first)
        XCTAssertEqual(notice.kind, "approval")
        XCTAssertEqual(notice.approval?.id, card.id)
        XCTAssertEqual(notice.approval?.pending, true)
        XCTAssertEqual(notice.approval?.expires, card.expires)
        XCTAssertFalse(notice.message.contains("review@example.invalid"))
        XCTAssertFalse(notice.message.contains("neutral change"))
        let storage = FixtureCheckpoint(), sink = FixtureNotificationSink()
        let consumer = NotificationEngine(storage: storage)
        try consumer.baseline(claim.runtimeId, head: InboxCheckpoint(sequence: 0, id: nil))
        _ = try await consumer.consume(runtime: claim.runtimeId, page: inbox, sink: sink)
        XCTAssertEqual(sink.delivered, [NotificationEngine.identifier(runtime: claim.runtimeId, delivery: notice.id)])
        XCTAssertEqual(try NotificationEngine(storage: storage).checkpoint(claim.runtimeId), inbox.next)
        do { _ = try await connection.request("/api/reminders", token: claim.token, body: ["title":"forbidden", "due":"2099-01-01T00:00:00Z"]); XCTFail("Read-only client mutated state") } catch { }
        let wrong = NativeConnection(port: invitation.port, fingerprint: String(repeating: "0", count: 64))
        do { _ = try await wrong.request("/api/doctor", token: claim.token); XCTFail("Different certificate pin accepted") } catch { }
        let credential = Credential(clientId: claim.clientId, token: claim.token, expiresAt: claim.expiresAt, runtimeId: claim.runtimeId, port: invitation.port, webPort: invitation.webPort, fingerprint: invitation.fingerprint)
        let renewal = try credential.renewalInvitation(String(contentsOfFile: path + ".renew", encoding: .utf8))
        let renewed = try JSONDecoder().decode(Claim.self, from: await connection.request("/api/pairing/renew", token: credential.token, body: ["ticket": renewal.ticket]))
        XCTAssertEqual(renewed.runtimeId, credential.runtimeId)
        XCTAssertEqual(renewed.scopes, ["read"])
        do { _ = try await connection.request("/api/status", token: credential.token); XCTFail("Renewed-away credential accepted") } catch { }
        let renewedStatus = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/status", token: renewed.token))
        XCTAssertEqual(renewedStatus.runtimeId, credential.runtimeId)

    }
}

extension PairingTests {
    func testRenewalRequiresSameIdentityPinPortsAndUnexpiredCredential() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000), expiry = Int64(now.timeIntervalSince1970 * 1000) + 120_000
        let runtime = UUID().uuidString, fingerprint = String(repeating: "b", count: 64)
        let credential = Credential(clientId: UUID().uuidString, token: String(repeating: "a", count: 64), expiresAt: expiry, runtimeId: runtime, port: 4319, webPort: 4317, fingerprint: fingerprint)
        func invitation(runtimeId: String = runtime, pin: String = fingerprint, port: Int = 4319, webPort: Int = 4317) -> Invitation {
            Invitation(version: 1, ticket: String(repeating: "c", count: 64), runtimeId: runtimeId, port: port, webPort: webPort, fingerprint: pin, expiresAt: expiry)
        }
        XCTAssertEqual(try credential.renewalInvitation(encoded(invitation()), now: now).runtimeId, runtime)
        for changed in [invitation(runtimeId: UUID().uuidString), invitation(pin: String(repeating: "d", count: 64)), invitation(port: 4321), invitation(webPort: 4318)] {
            XCTAssertThrowsError(try credential.renewalInvitation(encoded(changed), now: now))
        }
        let expired = Credential(clientId: credential.clientId, token: credential.token, expiresAt: Int64(now.timeIntervalSince1970 * 1000), runtimeId: runtime, port: 4319, webPort: 4317, fingerprint: fingerprint)
        XCTAssertThrowsError(try expired.renewalInvitation(encoded(invitation()), now: now))
    }

    @MainActor
    func testRefusedRenewalIsDistinctFromUnconfirmedRenewal() async throws {
        let now = Date()
        let expiry = Int64(now.timeIntervalSince1970 * 1000) + 120_000
        let runtime = UUID().uuidString, fingerprint = String(repeating: "b", count: 64)
        let credential = Credential(clientId: UUID().uuidString, token: String(repeating: "a", count: 64), expiresAt: expiry, runtimeId: runtime, port: 4319, webPort: 4317, fingerprint: fingerprint)
        let mismatched = Invitation(version: 1, ticket: String(repeating: "c", count: 64), runtimeId: UUID().uuidString, port: 4319, webPort: 4317, fingerprint: fingerprint, expiresAt: expiry)

        let model = Companion()
        model.language = "it"
        model.credential = credential
        model.paired = true
        model.renewing = true
        model.invitation = try encoded(mismatched)

        await model.pair()

        XCTAssertTrue(model.paired)
        XCTAssertEqual(model.credential?.token, credential.token)
        XCTAssertTrue(model.status.contains("Rinnovo rifiutato"), "Expected pre-request refusal, got: \(model.status)")
        XCTAssertTrue(model.status.contains("invariato"), "Expected unchanged pairing note, got: \(model.status)")
        XCTAssertFalse(model.status.contains("Rinnovo non confermato"))

        model.language = "en"
        model.invitation = try encoded(mismatched)
        await model.pair()
        XCTAssertTrue(model.status.contains("Renewal refused"), "Expected English refusal, got: \(model.status)")
        XCTAssertTrue(model.status.contains("unchanged"), "Expected English unchanged note, got: \(model.status)")

        let unreachable = Invitation(version: 1, ticket: String(repeating: "c", count: 64), runtimeId: runtime, port: 1, webPort: 4317, fingerprint: fingerprint, expiresAt: expiry)
        let unreachableCredential = Credential(clientId: credential.clientId, token: credential.token, expiresAt: expiry, runtimeId: runtime, port: 1, webPort: 4317, fingerprint: fingerprint)
        model.credential = unreachableCredential
        model.language = "it"
        model.invitation = try encoded(unreachable)
        await model.pair()
        XCTAssertTrue(model.status.contains("Rinnovo non confermato"), "Expected Italian unconfirmed message, got: \(model.status)")
        XCTAssertFalse(model.status.contains("Rinnovo rifiutato"))

        model.language = "en"
        model.invitation = try encoded(unreachable)
        await model.pair()
        XCTAssertTrue(model.status.contains("Renewal not confirmed"), "Expected English unconfirmed message, got: \(model.status)")
        XCTAssertFalse(model.status.contains("Renewal refused"))
    }
}
