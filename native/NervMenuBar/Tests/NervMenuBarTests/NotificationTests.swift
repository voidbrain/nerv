import XCTest
import ServiceManagement
@testable import NervMenuBar
private final class MemoryCheckpoint: CheckpointStorage {
    var checkpoint: InboxCheckpoint?
    var fail = false
    func load(_ runtime: String) throws -> InboxCheckpoint? { checkpoint }
    func save(_ runtime: String, _ value: InboxCheckpoint) throws { if fail { throw NativeEventError.checkpoint }; checkpoint = value }
}
private final class FakeNotifications: NotificationSink {
    var existing: Set<String> = []
    var delivered: [String] = []
    var fail = false
    func existingIdentifiers() async -> Set<String> { existing }
    func deliver(identifier: String, body: String) async throws { if fail { throw NativeEventError.denied }; delivered.append(identifier); existing.insert(identifier) }
}
final class NotificationTests: XCTestCase {
    let runtime = UUID().uuidString
    func page(_ id: String) -> InboxPage { InboxPage(items: [InboxEntry(sequence: 1, id: id, message: "Rinnovare assicurazione", created: "2030-01-01T00:00:00Z")], head: InboxCheckpoint(sequence: 1, id: id), next: InboxCheckpoint(sequence: 1, id: id), reset: false) }
    func testRestartAndOSReconciliationAvoidKnownDuplicates() async throws {
        let storage = MemoryCheckpoint(), sink = FakeNotifications(), id = UUID().uuidString
        let engine = NotificationEngine(storage: storage)
        try engine.baseline(runtime, head: InboxCheckpoint(sequence: 0, id: nil))
        sink.existing.insert(NotificationEngine.identifier(runtime: runtime, delivery: id))
        _ = try await engine.consume(runtime: runtime, page: page(id), sink: sink)
        XCTAssertTrue(sink.delivered.isEmpty)
        let restored = NotificationEngine(storage: storage)
        XCTAssertEqual(try restored.checkpoint(runtime).sequence, 1)
    }
    func testOSFailureDoesNotAdvanceCheckpoint() async throws {
        let storage = MemoryCheckpoint(), sink = FakeNotifications(), id = UUID().uuidString
        let engine = NotificationEngine(storage: storage); try engine.baseline(runtime, head: InboxCheckpoint(sequence: 0, id: nil)); sink.fail = true
        do { _ = try await engine.consume(runtime: runtime, page: page(id), sink: sink); XCTFail("OS error ignored") } catch { }
        XCTAssertEqual(storage.checkpoint?.sequence, 0)
        sink.fail = false; _ = try await engine.consume(runtime: runtime, page: page(id), sink: sink)
        XCTAssertEqual(storage.checkpoint?.sequence, 1); XCTAssertEqual(sink.delivered.count, 1)
    }
    func testCrashAfterOSAcceptanceReconcilesBeforeRetry() async throws {
        let storage = MemoryCheckpoint(), sink = FakeNotifications(), id = UUID().uuidString
        let engine = NotificationEngine(storage: storage); try engine.baseline(runtime, head: InboxCheckpoint(sequence: 0, id: nil)); storage.fail = true
        do { _ = try await engine.consume(runtime: runtime, page: page(id), sink: sink); XCTFail("Checkpoint write failure ignored") } catch { }
        XCTAssertEqual(sink.delivered.count, 1); storage.fail = false
        _ = try await NotificationEngine(storage: storage).consume(runtime: runtime, page: page(id), sink: sink)
        XCTAssertEqual(sink.delivered.count, 1); XCTAssertEqual(storage.checkpoint?.sequence, 1)
    }
    func testChangedHistoryResetsWithoutReplayingOldMessages() async throws {
        let storage = MemoryCheckpoint(), sink = FakeNotifications()
        let engine = NotificationEngine(storage: storage); try engine.baseline(runtime, head: InboxCheckpoint(sequence: 12, id: UUID().uuidString))
        let head = InboxCheckpoint(sequence: 2, id: UUID().uuidString)
        let reset = try await engine.consume(runtime: runtime, page: InboxPage(items: [], head: head, next: head, reset: true), sink: sink)
        XCTAssertTrue(reset); XCTAssertEqual(storage.checkpoint, head); XCTAssertTrue(sink.delivered.isEmpty)
    }
    func testMalformedPageNeverPartiallyPosts() async throws {
        let storage = MemoryCheckpoint(), sink = FakeNotifications(), id = UUID().uuidString
        let engine = NotificationEngine(storage: storage); try engine.baseline(runtime, head: InboxCheckpoint(sequence: 0, id: nil))
        let bad = InboxPage(items: [InboxEntry(sequence: 1, id: id, message: "first", created: "x"), InboxEntry(sequence: 0, id: UUID().uuidString, message: "out of order", created: "x")], head: InboxCheckpoint(sequence: 2, id: UUID().uuidString), next: InboxCheckpoint(sequence: 0, id: nil), reset: false)
        do { _ = try await engine.consume(runtime: runtime, page: bad, sink: sink); XCTFail("Malformed sequence accepted") } catch { }
        XCTAssertTrue(sink.delivered.isEmpty); XCTAssertEqual(storage.checkpoint?.sequence, 0)
    }
    func testPrivateAtomicCheckpointSurvivesNewStoreAndRejectsCorruption() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("state.json"), value = InboxCheckpoint(sequence: 3, id: UUID().uuidString)
        try CheckpointFile(file: file).save(runtime, value)
        XCTAssertEqual(try CheckpointFile(file: file).load(runtime), value)
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        try Data("invalid".utf8).write(to: file)
        XCTAssertThrowsError(try CheckpointFile(file: file).load(runtime))
    }
    func testServiceControlsMustMatchPairedRuntimeDirectory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let agents = directory.appendingPathComponent("Library/LaunchAgents")
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(fromPropertyList: ["Label":"io.nodo.agent", "EnvironmentVariables":["NODO_HOME":directory.path + "/data"]], format: .xml, options: 0)
        try data.write(to: agents.appendingPathComponent("io.nodo.agent.plist"))
        let control = UserServiceController(uid: 501, home: directory.path)
        XCTAssertTrue(control.matches(home: directory.path + "/data"))
        XCTAssertFalse(control.matches(home: directory.path + "/another-runtime"))
        XCTAssertFalse(control.matches(home: nil))
        XCTAssertEqual(LaunchAgentCommand.installedLabel(home: directory.path), "io.nodo.agent", "pre-rename service still controlled")
        let current = try PropertyListSerialization.data(fromPropertyList: ["Label":"io.nerv.agent", "EnvironmentVariables":["NERV_HOME":directory.path + "/nerv"]], format: .xml, options: 0)
        try current.write(to: agents.appendingPathComponent("io.nerv.agent.plist"))
        XCTAssertEqual(LaunchAgentCommand.installedLabel(home: directory.path), "io.nerv.agent")
        XCTAssertTrue(control.matches(home: directory.path + "/nerv"))
        XCTAssertFalse(control.matches(home: directory.path + "/data"))
    }
    func testLoginApprovalIsNotClaimedEnabledAndCommandsAreFixed() throws {
        XCTAssertEqual(SystemLoginItem.state(for: .requiresApproval), .requiresApproval)
        XCTAssertEqual(SystemLoginItem.state(for: .notFound), .unavailable)
        XCTAssertEqual(try LaunchAgentCommand.make(.stop, uid: 501, home: "/Users/test").arguments, ["bootout", "gui/501/io.nerv.agent"])
        XCTAssertEqual(try LaunchAgentCommand.make(.start, uid: 501, home: "/Users/test").arguments, ["bootstrap", "gui/501", "/Users/test/Library/LaunchAgents/io.nerv.agent.plist"])
        XCTAssertEqual(try LaunchAgentCommand.make(.stop, uid: 501, home: "/Users/test", label: "io.nodo.agent").arguments, ["bootout", "gui/501/io.nodo.agent"])
        XCTAssertThrowsError(try LaunchAgentCommand.make(.stop, uid: 501, home: "/Users/test", label: "io.evil.agent"))
        XCTAssertThrowsError(try LaunchAgentCommand.make(.start, uid: 501, home: "relative"))
    }
}
