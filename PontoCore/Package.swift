// swift-tools-version:5.9
import PackageDescription

/// Núcleo lógico do Meu Ponto Digital.
/// Contém apenas código Foundation (sem UIKit/SwiftUI/Vision) para que possa ser
/// compilado e testado em qualquer plataforma, inclusive fora do Xcode.
let package = Package(
    name: "PontoCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "PontoCore", targets: ["PontoCore"])
    ],
    targets: [
        .target(name: "PontoCore"),
        .testTarget(name: "PontoCoreTests", dependencies: ["PontoCore"])
    ]
)
