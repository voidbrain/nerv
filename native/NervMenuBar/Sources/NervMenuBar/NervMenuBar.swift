import SwiftUI
import AppKit
struct RuntimeStatus: Decodable { let runtimeId: String; let language: String; let home: String? }
struct Reminder: Decodable, Identifiable { let id: String; let title: String; let due: String; let delivered: String?; let cancelled: String? }
struct Claim: Decodable { let clientId: String; let token: String; let expiresAt: Int64; let runtimeId: String; let scopes: [String] }
@MainActor final class Companion: ObservableObject {
    @Published var language = UserDefaults.standard.string(forKey: "nerv.language") ?? "en" { didSet { UserDefaults.standard.set(language, forKey: "nerv.language") } }
    @Published var invitation = ""
    @Published var status = "NERV non connesso"
    @Published var reminders: [Reminder] = []
    @Published var busy = false
    @Published var paired = false
    @Published var notificationsEnabled = UserDefaults.standard.bool(forKey: "nerv.notifications") { didSet { UserDefaults.standard.set(notificationsEnabled, forKey: "nerv.notifications") } }
    @Published var notificationStatus = "Notifiche disattivate"
    @Published var loginState: LoginState = .disabled
    @Published var serviceLoaded = false
    @Published var serviceMatchesRuntime = false
    @Published var serviceBusy = false
    @Published var controlStatus = ""
    private let notifications = SystemNotifications()
    private let notificationEngine = NotificationEngine(storage: CheckpointFile())
    private let login: LoginItemControlling = SystemLoginItem()
    private let service = UserServiceController()
    private var pollTask: Task<Void, Never>?
    private var credential: Credential?
    init() { do { credential = try CredentialStore.load(); paired = credential != nil } catch { status = error.localizedDescription }; loginState = login.state; if notificationsEnabled { notificationStatus = "Notifiche attive: nuovi promemoria" }; if paired { startPolling() } }
    deinit { pollTask?.cancel() }
    private func startPolling() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
    }
    func refreshOSState() async {
        loginState = login.state
        do { serviceLoaded = try await service.loaded(); controlStatus = serviceLoaded ? "Servizio caricato" : "Servizio non caricato o non accessibile" } catch { controlStatus = error.localizedDescription }
    }
    func setLoginEnabled(_ enabled: Bool) {
        do { try login.setEnabled(enabled) } catch { controlStatus = error.localizedDescription }
        loginState = login.state
    }
    func controlService(start: Bool) async {
        guard !serviceBusy else { return }; guard !paired || serviceMatchesRuntime else { controlStatus = "Il servizio locale non corrisponde al NERV abbinato."; return }; serviceBusy = true; defer { serviceBusy = false }
        do { if start { try await service.start() } else { try await service.stop() }; await refreshOSState(); await refresh() } catch { controlStatus = error.localizedDescription }
    }
    func toggleNotifications() async {
        guard !busy, let credential else { return }
        if notificationsEnabled { notificationsEnabled = false; notificationStatus = "Notifiche disattivate"; return }
        busy = true; defer { busy = false }
        do {
            guard try await notifications.requestPermission() else { throw NativeEventError.denied }
            let connection = NativeConnection(port: credential.port, fingerprint: credential.fingerprint)
            let doctor = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/status", token: credential.token))
            guard doctor.runtimeId == credential.runtimeId else { throw NativeError.identityMismatch }
            let page = try JSONDecoder().decode(InboxPage.self, from: await connection.request("/api/inbox/page?after=0&limit=1", token: credential.token))
            try notificationEngine.baseline(credential.runtimeId, head: page.head)
            notificationsEnabled = true; notificationStatus = "Notifiche attive: nuovi promemoria"
        } catch { notificationStatus = error.localizedDescription; notificationsEnabled = false }
    }
    func tr(_ text: String) -> String {
        guard language == "en" else { return text }
        return ["NERV non connesso":"NERV disconnected", "NERV abbinato":"NERV paired", "NERV connesso":"NERV connected", "Abbinamento locale rimosso":"Local pairing removed", "Genera un invito con npm start -- pair e incollalo qui.":"Generate an invitation with npm start -- pair and paste it here.", "Invito privato":"Private invitation", "Abbina NERV":"Pair NERV", "Apri spazio web":"Open workspace", "Aggiorna stato":"Refresh status", "Rimuovi abbinamento locale":"Forget local pairing", "Chiudere questa app lascia NERV in esecuzione.":"Quitting this app leaves NERV running.", "Esci dal companion":"Quit companion", "Ora locale del Mac":"Mac local time", "Servizio NERV di questo Mac":"NERV service on this Mac", "Il servizio locale non corrisponde al NERV abbinato.":"The local service does not match the paired NERV.", "Notifiche disattivate":"Notifications off", "Notifiche attive: nuovi promemoria":"Notifications on: new reminders", "Disattiva notifiche":"Turn notifications off", "Attiva notifiche da ora":"Enable notifications from now", "Cronologia cambiata: controlla la casella":"History changed: check the inbox", "Servizio caricato":"Service loaded", "Servizio non caricato o non accessibile":"Service not loaded or unavailable", "Avvia NERV":"Start NERV", "Ferma NERV…":"Stop NERV…", "Ferma NERV":"Stop NERV", "Annulla":"Cancel", "Avvio al login attivo":"Launch at login enabled", "Avvio al login: approvazione richiesta":"Launch at login requires approval", "Avvio al login non attivo":"Launch at login not enabled", "Disattiva avvio al login":"Disable launch at login", "Avvia companion al login":"Launch companion at login", "Apri impostazioni login":"Open login settings", "Fermare il servizio NERV? I promemoria attendono il riavvio.":"Stop the NERV service? Reminders will wait until it restarts."][text] ?? text
    }
    func pair() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let value = try Invitation.decode(invitation)
            let connection = NativeConnection(port: value.port, fingerprint: value.fingerprint)
            let claim = try JSONDecoder().decode(Claim.self, from: await connection.request("/api/pairing/claim", body: ["ticket": value.ticket]))
            guard claim.runtimeId == value.runtimeId, claim.scopes == ["read"], claim.token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NativeError.identityMismatch }
            let next = Credential(clientId: claim.clientId, token: claim.token, expiresAt: claim.expiresAt, runtimeId: claim.runtimeId, port: value.port, webPort: value.webPort, fingerprint: value.fingerprint)
            try CredentialStore.save(next); credential = next; paired = true; invitation = ""; status = "NERV abbinato"; startPolling()
        } catch { status = error.localizedDescription }
    }
    func refresh() async {
        guard !busy, let credential else { return }; busy = true; defer { busy = false }
        do {
            guard credential.expiresAt > Int64(Date().timeIntervalSince1970 * 1000) else { throw NativeError.expired }
            let connection = NativeConnection(port: credential.port, fingerprint: credential.fingerprint)
            let doctor = try JSONDecoder().decode(RuntimeStatus.self, from: await connection.request("/api/status", token: credential.token))
            guard doctor.runtimeId == credential.runtimeId else { throw NativeError.identityMismatch }
            serviceMatchesRuntime = service.matches(home: doctor.home)
            let values = try JSONDecoder().decode([Reminder].self, from: await connection.request("/api/reminders/pending", token: credential.token))
            reminders = Array(values.filter { $0.cancelled == nil && $0.delivered == nil }.prefix(5)); status = "NERV connesso"
            if notificationsEnabled {
                do {
                    guard await notifications.allowed() else { throw NativeEventError.denied }
                    let checkpoint = try notificationEngine.checkpoint(credential.runtimeId)
                    let suffix = checkpoint.id.map { "&afterId=\($0)" } ?? ""
                    let page = try JSONDecoder().decode(InboxPage.self, from: await connection.request("/api/inbox/page?after=\(checkpoint.sequence)\(suffix)&limit=5", token: credential.token))
                    if try await notificationEngine.consume(runtime: credential.runtimeId, page: page, sink: notifications) { notificationStatus = "Cronologia cambiata: controlla la casella" }
                } catch { notificationStatus = error.localizedDescription }
            }
        } catch { status = error.localizedDescription; reminders = [] }
    }
    func forget() { do { try CredentialStore.forget(); credential = nil; paired = false; reminders = []; notificationsEnabled = false; pollTask?.cancel(); pollTask = nil; status = "Abbinamento locale rimosso" } catch { status = error.localizedDescription } }
    func openWorkspace() { if let credential { NSWorkspace.shared.open(URL(string: "http://127.0.0.1:\(credential.webPort)")!) } }
}
@main struct NervMenuBarApp: App {
    @StateObject private var model = Companion()
    @State private var confirmStop = false
    init() { NSApplication.shared.setActivationPolicy(.accessory) }
    var body: some Scene {
        MenuBarExtra { content } label: { Image(nsImage: Self.mark) }.menuBarExtraStyle(.window)
    }
    private var content: some View {
        ScrollView { VStack(alignment: .leading, spacing: 12) {
            Text("NERV Agency").font(.title2)
            Picker("Lingua / Language", selection: $model.language) { Text("Italiano").tag("it"); Text("English").tag("en") }
            Text(model.tr(model.status)).font(.caption).fixedSize(horizontal: false, vertical: true)
            if !model.paired {
                Text(model.tr("Genera un invito con npm start -- pair e incollalo qui.")).font(.caption)
                SecureField(model.tr("Invito privato"), text: $model.invitation)
                Button(model.tr("Abbina NERV")) { Task { await model.pair(); await model.refresh() } }.disabled(model.busy || model.invitation.isEmpty)
            } else {
                Button(model.tr("Apri spazio web")) { model.openWorkspace() }
                Button(model.tr("Aggiorna stato")) { Task { await model.refreshOSState(); await model.refresh() } }.disabled(model.busy)
                ForEach(model.reminders) { item in VStack(alignment: .leading) { Text(item.title); Text(Self.date(item.due, language: model.language)).font(.caption).foregroundStyle(.secondary) } }
                Button(model.tr(model.notificationsEnabled ? "Disattiva notifiche" : "Attiva notifiche da ora")) { Task { await model.toggleNotifications() } }.disabled(model.busy)
                Text(model.tr(model.notificationStatus)).font(.caption)
                Button(model.tr("Rimuovi abbinamento locale")) { model.forget() }.disabled(model.busy)
            }
            Divider()
            Text(model.tr("Servizio NERV di questo Mac")).font(.caption)
            Text(model.tr(model.controlStatus)).font(.caption)
            if model.paired && !model.serviceMatchesRuntime { Text(model.tr("Il servizio locale non corrisponde al NERV abbinato.")).font(.caption) }
            Button(model.tr("Avvia NERV")) { Task { await model.controlService(start: true) } }.disabled(model.serviceBusy || model.serviceLoaded || (model.paired && !model.serviceMatchesRuntime))
            Button(model.tr("Ferma NERV…")) { confirmStop = true }.disabled(model.serviceBusy || !model.serviceLoaded || (model.paired && !model.serviceMatchesRuntime))
            Text(model.tr(model.loginState == .enabled ? "Avvio al login attivo" : model.loginState == .requiresApproval ? "Avvio al login: approvazione richiesta" : "Avvio al login non attivo")).font(.caption)
            Button(model.tr(model.loginState == .enabled || model.loginState == .requiresApproval ? "Disattiva avvio al login" : "Avvia companion al login")) { model.setLoginEnabled(!(model.loginState == .enabled || model.loginState == .requiresApproval)) }
            if model.loginState == .requiresApproval { Button(model.tr("Apri impostazioni login")) { SystemLoginItem.openSettings() } }
            Divider()
            Text(model.tr("Chiudere questa app lascia NERV in esecuzione.")).font(.caption)
            Button(model.tr("Esci dal companion")) { NSApplication.shared.terminate(nil) }
        }.padding(18) }.frame(width: 350, height: 600).task { await model.refreshOSState(); await model.refresh() }
        .confirmationDialog(model.tr("Fermare il servizio NERV? I promemoria attendono il riavvio."), isPresented: $confirmStop) {
            Button(model.tr("Ferma NERV"), role: .destructive) { Task { await model.controlService(start: false) } }
            Button(model.tr("Annulla"), role: .cancel) { }
        }
    }
    private static func date(_ value: String, language: String) -> String {
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: value) else { return value }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: language == "en" ? "en_GB" : "it_IT"); formatter.dateStyle = .medium; formatter.timeStyle = .short
        return formatter.string(from: date)
    }
    /// Inverted triangle with seven eyes: the same geometry as web/public/mark.svg (32x48 units, y flipped), drawn at half size.
    private static var mark: NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 24), flipped: false) { _ in
            NSColor.labelColor.setFill()
            let scale = NSAffineTransform(); scale.scale(by: 0.5); scale.concat()
            let path = NSBezierPath(); path.windingRule = .evenOdd
            path.move(to: NSPoint(x: 1, y: 44)); path.line(to: NSPoint(x: 31, y: 44)); path.line(to: NSPoint(x: 16, y: 4)); path.close()
            for (x, y) in [(8.0, 10.0), (13.33, 10.0), (18.67, 10.0), (24.0, 10.0), (12.5, 19.0), (19.5, 19.0), (16.0, 28.0)] {
                path.appendOval(in: NSRect(x: x - 1.9, y: 48 - y - 1.25, width: 3.8, height: 2.5))
            }
            path.fill()
            return true
        }; image.isTemplate = true; return image
    }
}
