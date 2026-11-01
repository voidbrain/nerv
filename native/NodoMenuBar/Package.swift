// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "NodoMenuBar", platforms: [.macOS(.v14)], products: [.executable(name: "NodoMenuBar", targets: ["NodoMenuBar"])], targets: [.executableTarget(name: "NodoMenuBar"), .testTarget(name: "NodoMenuBarTests", dependencies: ["NodoMenuBar"])])
