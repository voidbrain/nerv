import Foundation
import ServiceManagement
import AppKit
import Darwin
struct LaunchAgentCommand: Equatable, Sendable {
    enum Action { case start, stop, status }
    let arguments: [String]
    /// Current LaunchAgent label, and the pre-rename one still controlled until `service install` replaces it.
    static let label = "io.nerv.agent", previousLabel = "io.nodo.agent"
    static func plist(_ label: String, home: String) -> String { home + "/Library/LaunchAgents/" + label + ".plist" }
    static func installedLabel(home: String) -> String {
        !FileManager.default.fileExists(atPath: plist(label, home: home)) && FileManager.default.fileExists(atPath: plist(previousLabel, home: home)) ? previousLabel : label
    }
    static func make(_ action: Action, uid: UInt32, home: String, label: String = LaunchAgentCommand.label) throws -> LaunchAgentCommand {
        guard home.hasPrefix("/"), !home.contains("\n"), !home.contains("\0"), label == Self.label || label == previousLabel else { throw OSControlError.unavailable }
        let domain = "gui/\(uid)", target = domain + "/" + label
        switch action {
        case .start: return LaunchAgentCommand(arguments: ["bootstrap", domain, plist(label, home: home)])
        case .stop: return LaunchAgentCommand(arguments: ["bootout", target])
        case .status: return LaunchAgentCommand(arguments: ["print", target])
        }
    }
}
enum OSControlError: LocalizedError {
    case unavailable, timeout, failed, notInstalled
    var errorDescription: String? { switch self {
        case .unavailable: return "Controllo del servizio non disponibile."
        case .timeout: return "Controllo del servizio scaduto. Verifica lo stato prima di riprovare."
        case .failed: return "Comando del servizio non riuscito. Controlla stato e log."
        case .notInstalled: return "Servizio non installato. Esegui npm start -- service install."
    } }
}
private final class ProcessCompletion: @unchecked Sendable {
    private let lock = NSLock(); private var completed = false
    private let continuation: CheckedContinuation<Int32, Error>
    init(_ continuation: CheckedContinuation<Int32, Error>) { self.continuation = continuation }
    @discardableResult func finish(_ result: Result<Int32, Error>) -> Bool {
        lock.lock(); guard !completed else { lock.unlock(); return false }; completed = true; lock.unlock()
        continuation.resume(with: result); return true
    }
}
protocol ServiceCommandRunning { func run(_ command: LaunchAgentCommand) async throws -> Int32 }
struct SystemServiceRunner: ServiceCommandRunning {
    func run(_ command: LaunchAgentCommand) async throws -> Int32 {
        try await withCheckedThrowingContinuation { continuation in
            let completion = ProcessCompletion(continuation), process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/launchctl"); process.arguments = command.arguments
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            process.terminationHandler = { process in completion.finish(.success(process.terminationStatus)) }
            do { try process.run() } catch { completion.finish(.failure(error)); return }
            DispatchQueue.global().asyncAfter(deadline: .now() + 10) {
                if completion.finish(.failure(OSControlError.timeout)), process.isRunning {
                    process.terminate()
                    DispatchQueue.global().asyncAfter(deadline: .now() + 2) { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
                }
            }
        }
    }
}
struct UserServiceController {
    let runner: ServiceCommandRunning
    let uid: UInt32
    let home: String
    init(runner: ServiceCommandRunning = SystemServiceRunner(), uid: UInt32 = getuid(), home: String = FileManager.default.homeDirectoryForCurrentUser.path) { self.runner = runner; self.uid = uid; self.home = home }
    func matches(home runtimeHome: String?) -> Bool {
        let label = LaunchAgentCommand.installedLabel(home: home)
        guard let runtimeHome, let data = try? Data(contentsOf: URL(fileURLWithPath: LaunchAgentCommand.plist(label, home: home))), data.count <= 65536,
              let value = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any], value["Label"] as? String == label,
              let environment = value["EnvironmentVariables"] as? [String: String], let installedHome = environment["NERV_HOME"] ?? environment["NODO_HOME"] else { return false }
        return URL(fileURLWithPath: runtimeHome).standardizedFileURL.resolvingSymlinksInPath() == URL(fileURLWithPath: installedHome).standardizedFileURL.resolvingSymlinksInPath()
    }
    private var label: String { LaunchAgentCommand.installedLabel(home: home) }
    func loaded() async throws -> Bool { try await runner.run(LaunchAgentCommand.make(.status, uid: uid, home: home, label: label)) == 0 }
    func start() async throws {
        guard FileManager.default.fileExists(atPath: LaunchAgentCommand.plist(label, home: home)) else { throw OSControlError.notInstalled }
        guard try await runner.run(LaunchAgentCommand.make(.start, uid: uid, home: home, label: label)) == 0 else { throw OSControlError.failed }
    }
    func stop() async throws { guard try await runner.run(LaunchAgentCommand.make(.stop, uid: uid, home: home, label: label)) == 0 else { throw OSControlError.failed } }
}
enum LoginState: Equatable { case enabled, requiresApproval, disabled, unavailable }
protocol LoginItemControlling { var state: LoginState { get }; func setEnabled(_ enabled: Bool) throws }
struct SystemLoginItem: LoginItemControlling {
    var state: LoginState { Self.state(for: SMAppService.mainApp.status) }
    static func state(for status: SMAppService.Status) -> LoginState { switch status {
        case .enabled: return .enabled
        case .requiresApproval: return .requiresApproval
        case .notRegistered: return .disabled
        case .notFound: return .unavailable
        @unknown default: return .unavailable
    } }
    func setEnabled(_ enabled: Bool) throws { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
    static func openSettings() { SMAppService.openSystemSettingsLoginItems() }
}
