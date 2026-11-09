import SwiftUI

struct ApprovalCardView: View {
    let approval: NativeApproval
    let language: String
    var now = Date()
    let onReview: () -> Void
    private func text(_ english: String, _ italian: String) -> String { language == "en" ? english : italian }

    var body: some View {
        let seconds = approval.remainingSeconds(at: now)
        VStack(alignment: .leading, spacing: 8) {
                Text(approval.card.tool).font(.headline).textSelection(.enabled)
                Text("ID: \(approval.id)").font(.caption).textSelection(.enabled)
                Text("\(text("Sortie", "Sortita")): \(approval.card.sortieId)").font(.caption).textSelection(.enabled)
                Text("\(text("Action", "Azione")): \(approval.card.actionId)").font(.caption).textSelection(.enabled)
                Text("Pattern: \(approval.card.pattern) · \(text("Effect", "Effetto")): \(approval.card.effect)").font(.caption)
                Text("Sync Ratio: \(approval.card.sync.value)%").font(.caption)
                ForEach(approval.card.sync.inputs.keys.sorted(), id: \.self) { key in
                    if let value = approval.card.sync.inputs[key] { Text("\(key): \(value, format: .number.locale(Locale(identifier: language == "en" ? "en_GB" : "it_IT")))").font(.caption) }
                }
                Text(text("Reason", "Motivo")).font(.subheadline)
                Text(approval.card.reason).textSelection(.enabled)
                Text(text("Arguments / diff / recipients", "Argomenti / diff / destinatari")).font(.subheadline)
                Text(approval.argumentsText).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                ForEach(Array(approval.card.verdicts.enumerated()), id: \.offset) { _, verdict in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(verdict.seat): \(verdict.vote)\(verdict.shadow == true ? text(" · shadow", " · ombra") : "")").font(.caption)
                        if let confidence = verdict.confidence { Text("\(text("Confidence", "Confidenza")): \(confidence, format: .percent.locale(Locale(identifier: language == "en" ? "en_GB" : "it_IT")))").font(.caption) }
                        Text(verdict.reason).font(.caption).textSelection(.enabled)
                    }
                }
                if let expiry = NativeApproval.date(approval.expires) {
                    Text("\(text("Expires (Mac local time)", "Scadenza (ora locale del Mac)")): \(expiry.formatted(Date.FormatStyle(date: .abbreviated, time: .standard).locale(Locale(identifier: language == "en" ? "en_GB" : "it_IT"))))").font(.caption)
                }
                Text(seconds > 0 ? text("Remaining: \(seconds) s", "Tempo rimasto: \(seconds) s") : text("Expired · nothing approved", "Scaduta · nessuna approvazione")).font(.caption)
                Button(text("Review in dashboard", "Controlla nella dashboard"), action: onReview)
                    .disabled(seconds == 0)
                    .accessibilityLabel(text("Review \(approval.card.tool) in dashboard", "Controlla \(approval.card.tool) nella dashboard"))
        }.fixedSize(horizontal: false, vertical: true)
    }
}
