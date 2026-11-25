// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "NervMenuBar", platforms: [.macOS(.v14)], products: [.executable(name: "NervMenuBar", targets: ["NervMenuBar"])], targets: [.executableTarget(name: "NervMenuBar"), .testTarget(name: "NervMenuBarTests", dependencies: ["NervMenuBar"])])
