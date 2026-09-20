import Foundation

@main
struct QuestClipStoreTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("kith-clip-tests-" + UUID().uuidString)
        defer { try? files.removeItem(at: root) }
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        let source = root.appendingPathComponent("camera.MOV")
        let firstBytes = Data("synthetic recorded clip".utf8)
        try firstBytes.write(to: source)
        let realDirectory = root.appendingPathComponent("clips", isDirectory: true)
        try files.createDirectory(at: realDirectory, withIntermediateDirectories: true)
        let alias = root.appendingPathComponent("clips-alias", isDirectory: true)
        try files.createSymbolicLink(at: alias, withDestinationURL: realDirectory)
        let store = QuestClipStore(directory: alias)
        let first = try store.save(source)
        precondition(files.fileExists(atPath: first.path), "Cleanup must not delete the new clip through a URL alias")
        let loaded = try Data(contentsOf: store.latest!)
        precondition(loaded == firstBytes, "Submit must find the exact clip reported ready")
        let reopened = QuestClipStore(directory: realDirectory)
        precondition(reopened.latest != nil, "Saved clips must survive rebuilding the store/app")
        do {
            _ = try store.save(root.appendingPathComponent("missing.MOV"))
            preconditionFailure("Missing source should fail")
        } catch { precondition(store.latest != nil, "Failed retake must retain the prior clip") }
        let empty = root.appendingPathComponent("empty.mov")
        try Data().write(to: empty)
        do { _ = try store.save(empty); preconditionFailure("Empty clip should fail") }
        catch { precondition(store.latest != nil, "Empty retake must retain the prior clip") }
        let secondBytes = Data("replacement recording".utf8)
        try secondBytes.write(to: source)
        _ = try store.save(source)
        let replacement = try Data(contentsOf: store.latest!)
        precondition(replacement == secondBytes)
        let remaining = try files.contentsOfDirectory(at: realDirectory, includingPropertiesForKeys: nil)
        precondition(remaining.count == 1, "Only the previous clip is removed after a successful retake")
        print("Quest clip storage passed: aliases, readable saved clip, restart, failed/empty retakes, and replacement cleanup.")
    }
}
