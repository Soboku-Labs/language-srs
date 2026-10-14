// swift-tools-version: 5.9
import PackageDescription

/**
 Zero dependencies, on purpose.

 This library is destined for an iPhone, where every dependency is something an
 app has to carry, audit and update. Everything here is Foundation: JSON through
 `Codable`, HTTP through `URLSession`. Adding a networking package to save a
 dozen lines of request building would be a poor trade on the platform that
 matters, and it would also stop this compiling on Linux, which is where it is
 currently tested.
 */
let package = Package(
    name: "LanguageSrsClient",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "LanguageSrsClient", targets: ["LanguageSrsClient"]),
    ],
    targets: [
        .target(name: "LanguageSrsClient"),
        .testTarget(name: "LanguageSrsClientTests", dependencies: ["LanguageSrsClient"]),
    ]
)
