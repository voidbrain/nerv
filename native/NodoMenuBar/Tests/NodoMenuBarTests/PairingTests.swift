import XCTest
@testable import NodoMenuBar
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
        guard let path = ProcessInfo.processInfo.environment["NODO_NATIVE_FIXTURE"] else { throw XCTSkip("Native TLS fixture not running") }
        let invitation = try Invitation.decode(String(contentsOfFile: path, encoding: .utf8))
        let connection = NativeConnection(port: invitation.port, fingerprint: invitation.fingerprint)
        let claimData = try await connection.request("/api/pairing/claim", body: ["ticket": invitation.ticket])
        let claim = try JSONDecoder().decode(Claim.self, from: claimData)
        XCTAssertEqual(claim.runtimeId, invitation.runtimeId)
        let doctor = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/doctor", token: claim.token))
        XCTAssertEqual(doctor.runtimeId, invitation.runtimeId)
        let status = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/status", token: claim.token))
        XCTAssertEqual(status.runtimeId, invitation.runtimeId)
        let inbox = try JSONDecoder().decode(InboxPage.self, from: await connection.request("/api/inbox/page?after=0&limit=5", token: claim.token))
        XCTAssertEqual(inbox.head.sequence, 0)
        XCTAssertTrue(inbox.items.isEmpty)
        do { _ = try await connection.request("/api/reminders", token: claim.token, body: ["title":"forbidden", "due":"2099-01-01T00:00:00Z"]); XCTFail("Read-only client mutated state") } catch { }
        let wrong = NativeConnection(port: invitation.port, fingerprint: String(repeating: "0", count: 64))
        do { _ = try await wrong.request("/api/doctor", token: claim.token); XCTFail("Different certificate pin accepted") } catch { }
    }
}
