import XCTest
import SwiftUI
@testable import NervMenuBar

final class ApprovalTests: XCTestCase {
    private let expiry = "2026-11-09T12:00:00.000Z"
    private func envelope() -> [String: Any] {
        ["id": UUID().uuidString, "expires": expiry, "decision": NSNull(), "card": [
            "sortieId": UUID().uuidString, "actionId": UUID().uuidString, "tool": "mail.send",
            "args": ["recipients": ["review@example.invalid"], "diff": "<script>data only</script>\n+ Änderung", "flags": [true, NSNull(), 3.5]],
            "effect": "write-external", "pattern": "blue",
            "sync": ["value": 60, "inputs": ["effect": 0.6, "stage": 1]],
            "verdicts": [["seat": "casper", "vote": "approve", "reason": "Intent checked", "confidence": 0.9, "shadow": false]],
            "reason": "Owner review required", "expires": expiry
        ]]
    }
    private func data(_ items: [[String: Any]]) throws -> Data { try JSONSerialization.data(withJSONObject: items) }
    private func changingCard(_ key: String, _ value: Any) -> [String: Any] {
        var item = envelope(), card = item["card"] as! [String: Any]
        card[key] = value; item["card"] = card; return item
    }

    func testFullArgumentsVerdictsAndExpiryArePreserved() throws {
        let cards = try NativeApproval.page(data([envelope()]))
        let card = try XCTUnwrap(cards.first)
        XCTAssertEqual(card.card.tool, "mail.send")
        XCTAssertTrue(card.argumentsText.contains("review@example.invalid"))
        XCTAssertTrue(card.argumentsText.contains("<script>data only</script>"))
        XCTAssertTrue(card.argumentsText.contains("Änderung"))
        XCTAssertTrue(card.argumentsText.contains("null"))
        XCTAssertEqual(card.card.sync.inputs["effect"], 0.6)
        XCTAssertEqual(card.card.verdicts.first?.confidence, 0.9)
        let expiry = try XCTUnwrap(NativeApproval.date(self.expiry))
        XCTAssertEqual(card.remainingSeconds(at: expiry.addingTimeInterval(-1.2)), 2)
        XCTAssertEqual(card.remainingSeconds(at: expiry), 0)
        XCTAssertEqual(card.remainingSeconds(at: expiry.addingTimeInterval(90)), 0)
        XCTAssertTrue(try NativeApproval.page(data([])).isEmpty, "A later empty snapshot removes decided cards")
    }

    func testPageFailsClosedForMalformedInconsistentOrOversizedCards() throws {
        let item = envelope()
        XCTAssertThrowsError(try NativeApproval.page(data([item, item])))
        XCTAssertThrowsError(try NativeApproval.page(data((0..<6).map { _ in envelope() })))
        for (key, value) in [("expires", "invalid"), ("expires", "2026-11-09T13:00:00.000Z"), ("tool", ""), ("pattern", "approved"), ("effect", "unknown"), ("sortieId", "invalid")] {
            XCTAssertThrowsError(try NativeApproval.page(data([changingCard(key, value)])))
        }
        XCTAssertThrowsError(try NativeApproval.page(data([changingCard("sync", ["value": 101, "inputs": ["effect": 1]])])))
        XCTAssertThrowsError(try NativeApproval.page(data([changingCard("sync", ["value": 50, "inputs": ["effect": -1]])])))
        XCTAssertThrowsError(try NativeApproval.page(data([changingCard("args", ["diff": String(repeating: "x", count: 8193)])])))
        XCTAssertThrowsError(try NativeApproval.page(data([changingCard("verdicts", [["seat": "casper", "vote": "grant", "reason": "invalid"]])])))
        var decided = envelope(); decided["decision"] = "approve"
        XCTAssertThrowsError(try NativeApproval.page(data([decided])))
        XCTAssertThrowsError(try NativeApproval.page(data([envelope(), changingCard("args", "not an object")])))
        XCTAssertThrowsError(try NativeApproval.page(Data(repeating: 32, count: 1_048_577)))
    }


    @MainActor func testReadOnlyCardRendersInBothLanguages() throws {
        let card = try XCTUnwrap(NativeApproval.page(data([envelope()])).first)
        for language in ["en", "it"] {
            let renderer = ImageRenderer(content: ApprovalCardView(approval: card, language: language) { XCTFail("Rendering must not navigate or decide") }
                .padding(18).frame(width: 350).background(.background).environment(\.colorScheme, .light))
            let image = try XCTUnwrap(renderer.nsImage)
            XCTAssertEqual(image.size.width, 350)
            XCTAssertGreaterThan(image.size.height, 300)
            let pixels = try XCTUnwrap(image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0) })
            XCTAssertGreaterThan(pixels.pixelsHigh, 300)
            var shades = Set<Int>()
            for x in stride(from: 0, to: pixels.pixelsWide, by: 8) {
                for y in stride(from: 0, to: pixels.pixelsHigh, by: 8) {
                    if let color = pixels.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) {
                        shades.insert(Int((color.redComponent + color.greenComponent + color.blueComponent) * 100))
                    }
                }
            }
            XCTAssertGreaterThan(shades.count, 1, "The snapshot must contain visible card content")
            if let directory = ProcessInfo.processInfo.environment["NERV_NATIVE_CARD_ARTIFACTS"] {
                let destination = URL(fileURLWithPath: directory, isDirectory: true)
                try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                let bitmap = try XCTUnwrap(image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0) })
                try XCTUnwrap(bitmap.representation(using: .png, properties: [:])).write(to: destination.appendingPathComponent("approval-\(language).png"))
            }
        }
    }

    func testDashboardNavigationNeverCarriesCredentialOrDecision() throws {
        let url = try XCTUnwrap(NativeApproval.dashboardURL(webPort: 4317))
        XCTAssertEqual(url.absoluteString, "http://127.0.0.1:4317/dashboard/")
        XCTAssertNil(url.query); XCTAssertNil(url.fragment); XCTAssertNil(url.user); XCTAssertNil(url.password)
        XCTAssertNil(NativeApproval.dashboardURL(webPort: 0))
        XCTAssertNil(NativeApproval.dashboardURL(webPort: 65536))
    }
}
