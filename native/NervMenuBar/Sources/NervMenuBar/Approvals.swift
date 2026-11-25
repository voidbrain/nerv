import Foundation

/// Tool arguments are data, including nested diffs and recipients; no markup or executable content.
indirect enum ApprovalJSON: Codable {
    case null, bool(Bool), number(Double), string(String), array([ApprovalJSON]), object([String: ApprovalJSON])

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .bool(item) }
        else if let item = try? value.decode(Double.self) { self = .number(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode([ApprovalJSON].self) { self = .array(item) }
        else { self = .object(try value.decode([String: ApprovalJSON].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        }
    }

    func bounded(depth: Int = 0) -> Bool {
        guard depth <= 32 else { return false }
        switch self {
        case .array(let items): return items.allSatisfy { $0.bounded(depth: depth + 1) }
        case .object(let items): return items.values.allSatisfy { $0.bounded(depth: depth + 1) }
        case .number(let item): return item.isFinite
        default: return true
        }
    }
}

enum NativeApprovalError: LocalizedError {
    case invalidPage
    var errorDescription: String? { "Approval cards unavailable: invalid or oversized response. Refresh to retry." }
}

struct NativeApproval: Decodable, Identifiable {
    struct Sync: Decodable { let value: Int; let inputs: [String: Double] }
    struct Verdict: Decodable {
        let seat: String
        let vote: String
        let reason: String
        let confidence: Double?
        let shadow: Bool?
    }
    struct Card: Decodable {
        let sortieId: String
        let actionId: String
        let tool: String
        let args: [String: ApprovalJSON]
        let effect: String
        let pattern: String
        let sync: Sync
        let verdicts: [Verdict]
        let reason: String
        let expires: String
    }
    let id: String
    let card: Card
    let expires: String
    let decision: String?

    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    func remainingSeconds(at now: Date) -> Int {
        guard let expiry = Self.date(expires) else { return 0 }
        return max(0, Int(ceil(expiry.timeIntervalSince(now))))
    }

    var argumentsText: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(card.args), let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }

    /// Replace the whole page only after validation. Never silently discard one malformed card.
    static func page(_ data: Data) throws -> [NativeApproval] {
        guard data.count <= 1_048_576 else { throw NativeApprovalError.invalidPage }
        let approvals = try JSONDecoder().decode([NativeApproval].self, from: data)
        guard approvals.count <= 5, Set(approvals.map(\.id)).count == approvals.count else { throw NativeApprovalError.invalidPage }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        for approval in approvals {
            let card = approval.card
            guard UUID(uuidString: approval.id) != nil, UUID(uuidString: card.sortieId) != nil,
                  UUID(uuidString: card.actionId) != nil, approval.decision == nil,
                  approval.expires == card.expires, date(approval.expires) != nil,
                  !card.tool.isEmpty, card.tool.count <= 100,
                  ["read", "write-local", "write-external", "irreversible", "physical"].contains(card.effect),
                  ["green", "orange", "blue"].contains(card.pattern),
                  (0...100).contains(card.sync.value), card.sync.inputs.count <= 16,
                  card.sync.inputs.allSatisfy({ !$0.key.isEmpty && $0.key.count <= 100 && $0.value.isFinite && (0...1).contains($0.value) }),
                  card.reason.count <= 2000, card.verdicts.count <= 64,
                  card.verdicts.allSatisfy({ !$0.seat.isEmpty && $0.seat.count <= 100 && ["approve", "reject", "abstain"].contains($0.vote) && $0.reason.count <= 500 && ($0.confidence.map { $0.isFinite && (0...1).contains($0) } ?? true) }),
                  card.args.values.allSatisfy({ $0.bounded() }),
                  try encoder.encode(card.args).count <= 8192 else { throw NativeApprovalError.invalidPage }
        }
        return approvals
    }

    static func dashboardURL(webPort: Int) -> URL? {
        guard (1...65535).contains(webPort) else { return nil }
        return URL(string: "http://127.0.0.1:\(webPort)/dashboard/")
    }
}
