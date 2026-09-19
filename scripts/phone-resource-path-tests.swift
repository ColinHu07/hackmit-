import Foundation

@main
struct BundledResourcePathTests {
    static func main() throws {
        let files = FileManager.default
        let temporary = files.temporaryDirectory.appendingPathComponent("bondimals-path-tests-" + UUID().uuidString)
        defer { try? files.removeItem(at: temporary) }
        let root = temporary.appendingPathComponent("Web")
        let alias = temporary.appendingPathComponent("WebAlias")
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        let page = root.appendingPathComponent("index.html")
        try Data("<html>Bundled page</html>".utf8).write(to: page)
        try files.createSymbolicLink(at: alias, withDestinationURL: root)
        let direct = BundledResourcePath.resolve("index.html", under: root)
        let aliased = BundledResourcePath.resolve("index.html", under: alias)
        precondition(direct == aliased, "Directory aliases must resolve to the same bundled file")
        let aliasedData = try Data(contentsOf: aliased!)
        let directData = try Data(contentsOf: page)
        precondition(aliasedData == directData)
        precondition(BundledResourcePath.resolve("../outside.html", under: root) == nil, "Traversal must be rejected")
        precondition(BundledResourcePath.resolve("../WebSibling/index.html", under: root) == nil, "Sibling prefixes are not inside the bundle")
        let outside = temporary.appendingPathComponent("outside.html")
        try Data("Outside".utf8).write(to: outside)
        try files.createSymbolicLink(at: root.appendingPathComponent("escape.html"), withDestinationURL: outside)
        precondition(BundledResourcePath.resolve("escape.html", under: root) == nil, "Symlinks cannot escape the bundle")
        print("Bundled resource path checks passed: aliases, readable assets, traversal, sibling prefixes, and symlink containment.")
    }
}
