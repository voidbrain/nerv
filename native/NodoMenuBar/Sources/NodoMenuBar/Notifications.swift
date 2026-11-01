import Foundation
import UserNotifications
struct InboxCheckpoint: Codable, Equatable {
    let sequence: Int64
    let id: String?
    var valid: Bool { sequence >= 0 && (sequence == 0 ? id == nil : id.flatMap(UUID.init(uuidString:)) != nil) }
}
struct InboxEntry: Decodable { let sequence: Int64; let id: String; let message: String; let created: String }
struct InboxPage: Decodable { let items: [InboxEntry]; let head: InboxCheckpoint; let next: InboxCheckpoint; let reset: Bool }
protocol CheckpointStorage {
    func load(_ runtime: String) throws -> InboxCheckpoint?
    func save(_ runtime: String, _ checkpoint: InboxCheckpoint) throws
}
final class CheckpointFile: CheckpointStorage {
    private let file: URL
    init(file: URL? = nil) { self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Nodo/notification-checkpoints.json") }
    private func values() throws -> [String: InboxCheckpoint] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
        let data = try Data(contentsOf: file)
        guard data.count <= 32768 else { throw NativeEventError.checkpoint }
        let values = try JSONDecoder().decode([String: InboxCheckpoint].self, from: data)
        guard values.count <= 32, values.allSatisfy({ UUID(uuidString: $0.key) != nil && $0.value.valid }) else { throw NativeEventError.checkpoint }
        return values
    }
    func load(_ runtime: String) throws -> InboxCheckpoint? { try values()[runtime] }
    func save(_ runtime: String, _ checkpoint: InboxCheckpoint) throws {
        guard UUID(uuidString: runtime) != nil, checkpoint.valid else { throw NativeEventError.checkpoint }
        var values = try values()
        guard values[runtime] != nil || values.count < 32 else { throw NativeEventError.checkpoint }
        values[runtime] = checkpoint
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(values).write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}
protocol NotificationSink {
    func existingIdentifiers() async -> Set<String>
    func deliver(identifier: String, body: String) async throws
}
enum NativeEventError: LocalizedError {
    case checkpoint, invalidPage, denied
    var errorDescription: String? { switch self {
        case .checkpoint: return "Checkpoint notifiche non disponibile. Disattiva e riattiva le notifiche dopo aver verificato il file locale."
        case .invalidPage: return "Pagina notifiche non valida. Nessun checkpoint avanzato."
        case .denied: return "Notifiche non autorizzate nelle impostazioni di macOS."
    } }
}
final class NotificationEngine {
    private let storage: CheckpointStorage
    init(storage: CheckpointStorage) { self.storage = storage }
    func checkpoint(_ runtime: String) throws -> InboxCheckpoint { guard let value = try storage.load(runtime) else { throw NativeEventError.checkpoint }; return value }
    func baseline(_ runtime: String, head: InboxCheckpoint) throws { try storage.save(runtime, head) }
    static func identifier(runtime: String, delivery: String) -> String { "nodo.\(runtime).\(delivery)" }
    /** Advances only after OS acceptance/reconciliation. Cross-system crash windows cannot promise exactly-once banners. */
    func consume(runtime: String, page: InboxPage, sink: NotificationSink) async throws -> Bool {
        let previous = try checkpoint(runtime)
        guard previous.valid, page.head.valid, page.next.valid, page.items.count <= 5 else { throw NativeEventError.invalidPage }
        if page.reset { guard page.items.isEmpty, page.next == page.head else { throw NativeEventError.invalidPage }; try storage.save(runtime, page.head); return true }
        var cursor = previous
        var identifiers: Set<String> = []
        for entry in page.items {
            guard entry.sequence > cursor.sequence, entry.sequence <= page.head.sequence, UUID(uuidString: entry.id) != nil, entry.message.count <= 500, identifiers.insert(entry.id).inserted else { throw NativeEventError.invalidPage }
            cursor = InboxCheckpoint(sequence: entry.sequence, id: entry.id)
        }
        guard cursor == page.next, page.head.sequence >= cursor.sequence else { throw NativeEventError.invalidPage }
        let existing = await sink.existingIdentifiers()
        for entry in page.items {
            let identifier = Self.identifier(runtime: runtime, delivery: entry.id)
            if !existing.contains(identifier) { try await sink.deliver(identifier: identifier, body: entry.message) }
            try storage.save(runtime, InboxCheckpoint(sequence: entry.sequence, id: entry.id))
        }
        return false
    }
}
final class SystemNotifications: NSObject, NotificationSink, UNUserNotificationCenterDelegate, @unchecked Sendable {
    private let center = UNUserNotificationCenter.current()
    override init() { super.init(); center.delegate = self }
    func allowed() async -> Bool { let settings = await center.notificationSettings(); return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional }
    func requestPermission() async throws -> Bool { try await center.requestAuthorization(options: [.alert, .sound]) }
    func existingIdentifiers() async -> Set<String> {
        let delivered = await center.deliveredNotifications()
        let pending = await center.pendingNotificationRequests()
        return Set(delivered.map { $0.request.identifier } + pending.map { $0.identifier })
    }
    func deliver(identifier: String, body: String) async throws {
        guard await allowed() else { throw NativeEventError.denied }
        let content = UNMutableNotificationContent(); content.title = "Nodo"; content.body = body; content.sound = .default
        try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([.banner, .sound]) }
}
