import SwiftUI
import AppKit
struct Doctor: Decodable { let runtimeId: String; let language: String }
struct Reminder: Decodable, Identifiable { let id: String; let title: String; let due: String; let delivered: String?; let cancelled: String? }
struct Claim: Decodable { let clientId: String; let token: String; let expiresAt: Int64; let runtimeId: String; let scopes: [String] }
@MainActor final class Companion: ObservableObject {
    @Published var language = UserDefaults.standard.string(forKey: "nodo.language") ?? "it" { didSet { UserDefaults.standard.set(language, forKey: "nodo.language") } }
    @Published var invitation = ""
    @Published var status = "Nodo non connesso"
    @Published var reminders: [Reminder] = []
    @Published var busy = false
    @Published var paired = false
    private var credential: Credential?
    init() { do { credential = try CredentialStore.load(); paired = credential != nil } catch { status = error.localizedDescription } }
    func tr(_ text: String) -> String {
        guard language == "en" else { return text }
        return ["Nodo non connesso":"Nodo disconnected", "Nodo abbinato":"Nodo paired", "Nodo connesso":"Nodo connected", "Abbinamento locale rimosso":"Local pairing removed", "Genera un invito con npm start -- pair e incollalo qui.":"Generate an invitation with npm start -- pair and paste it here.", "Invito privato":"Private invitation", "Abbina Nodo":"Pair Nodo", "Apri spazio web":"Open workspace", "Aggiorna diagnostica":"Refresh diagnostics", "Rimuovi abbinamento locale":"Forget local pairing", "Chiudere questa app lascia Nodo in esecuzione.":"Quitting this app leaves Nodo running.", "Esci dal companion":"Quit companion", "Ora locale del Mac":"Mac local time"][text] ?? text
    }
    func pair() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let value = try Invitation.decode(invitation)
            let connection = NativeConnection(port: value.port, fingerprint: value.fingerprint)
            let claim = try JSONDecoder().decode(Claim.self, from: await connection.request("/api/pairing/claim", body: ["ticket": value.ticket]))
            guard claim.runtimeId == value.runtimeId, claim.scopes == ["read"], claim.token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NativeError.identityMismatch }
            let next = Credential(clientId: claim.clientId, token: claim.token, expiresAt: claim.expiresAt, runtimeId: claim.runtimeId, port: value.port, webPort: value.webPort, fingerprint: value.fingerprint)
            try CredentialStore.save(next); credential = next; paired = true; invitation = ""; status = "Nodo abbinato"
        } catch { status = error.localizedDescription }
    }
    func refresh() async {
        guard !busy, let credential else { return }; busy = true; defer { busy = false }
        do {
            guard credential.expiresAt > Int64(Date().timeIntervalSince1970 * 1000) else { throw NativeError.expired }
            let connection = NativeConnection(port: credential.port, fingerprint: credential.fingerprint)
            let doctor = try JSONDecoder().decode(Doctor.self, from: await connection.request("/api/doctor", token: credential.token))
            guard doctor.runtimeId == credential.runtimeId else { throw NativeError.identityMismatch }
            let values = try JSONDecoder().decode([Reminder].self, from: await connection.request("/api/reminders", token: credential.token))
            reminders = Array(values.filter { $0.cancelled == nil && $0.delivered == nil }.prefix(5)); status = "Nodo connesso"
        } catch { status = error.localizedDescription; reminders = [] }
    }
    func forget() { do { try CredentialStore.forget(); credential = nil; paired = false; reminders = []; status = "Abbinamento locale rimosso" } catch { status = error.localizedDescription } }
    func openWorkspace() { if let credential { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:\(credential.webPort)")!) } }
}
@main struct NodoMenuBarApp: App {
    @StateObject private var model = Companion()
    init() { NSApplication.shared.setActivationPolicy(.accessory) }
    var body: some Scene {
        MenuBarExtra { content } label: { Image(nsImage: Self.knot) }.menuBarExtraStyle(.window)
    }
    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nodo").font(.title2)
            Picker("Lingua / Language", selection: $model.language) { Text("Italiano").tag("it"); Text("English").tag("en") }
            Text(model.tr(model.status)).font(.caption).fixedSize(horizontal: false, vertical: true)
            if !model.paired {
                Text(model.tr("Genera un invito con npm start -- pair e incollalo qui.")).font(.caption)
                SecureField(model.tr("Invito privato"), text: $model.invitation)
                Button(model.tr("Abbina Nodo")) { Task { await model.pair(); await model.refresh() } }.disabled(model.busy || model.invitation.isEmpty)
            } else {
                Button(model.tr("Apri spazio web")) { model.openWorkspace() }
                Button(model.tr("Aggiorna diagnostica")) { Task { await model.refresh() } }.disabled(model.busy)
                ForEach(model.reminders) { item in VStack(alignment: .leading) { Text(item.title); Text(Self.date(item.due, language: model.language)).font(.caption).foregroundStyle(.secondary) } }
                Button(model.tr("Rimuovi abbinamento locale")) { model.forget() }.disabled(model.busy)
            }
            Divider()
            Text(model.tr("Chiudere questa app lascia Nodo in esecuzione.")).font(.caption)
            Button(model.tr("Esci dal companion")) { NSApplication.shared.terminate(nil) }
        }.padding(18).frame(width: 330).task { await model.refresh() }
    }
    private static func date(_ value: String, language: String) -> String {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: language == "en" ? "en_GB" : "it_IT"); formatter.dateStyle = .medium; formatter.timeStyle = .short
        return formatter.string(from: date)
    }
    private static var knot: NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 24), flipped: false) { _ in
            NSColor.labelColor.setFill()
            let scale = NSAffineTransform(); scale.scale(by: 0.5); scale.translateX(by: 32, yBy: 0); scale.rotate(byDegrees: 90); scale.concat()
            NSBezierPath(roundedRect: NSRect(x: 0, y: 12, width: 10, height: 8), xRadius: 4, yRadius: 4).fill()
            NSBezierPath(roundedRect: NSRect(x: 38, y: 12, width: 10, height: 8), xRadius: 4, yRadius: 4).fill()
            for x in [10.0, 20.5, 31.0] { NSGraphicsContext.saveGraphicsState(); let t = NSAffineTransform(); t.translateX(by: x + 3.5, yBy: 16); t.rotate(byDegrees: 22); t.translateX(by: -(x + 3.5), yBy: -16); t.concat(); NSBezierPath(roundedRect: NSRect(x: x, y: 2, width: 7, height: 28), xRadius: 3.5, yRadius: 3.5).fill(); NSGraphicsContext.restoreGraphicsState() }
            return true
        }; image.isTemplate = true; return image
    }
}
