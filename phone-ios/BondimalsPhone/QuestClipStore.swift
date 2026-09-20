import Foundation

/// Keeps the last successfully saved recording, independently of URL aliases.
struct QuestClipStore {
    let directory: URL
    private let files = FileManager.default

    init(directory: URL) {
        self.directory = directory.resolvingSymlinksInPath().standardizedFileURL
    }

    var latest: URL? {
        (try? files.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey]))?
            .filter { url in
                guard ["mov", "mp4"].contains(url.pathExtension.lowercased()),
                      let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]) else { return false }
                return values.isRegularFile == true && (values.fileSize ?? 0) > 0
            }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }.first
    }

    func save(_ source: URL) throws -> URL {
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        // Capture old files BEFORE creating the new one. Enumerated file URLs
        // may use /private/var while the destination uses /var; URL inequality
        // must never cause the new recording to be deleted during cleanup.
        let previous = try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { ["mov", "mp4"].contains($0.pathExtension.lowercased()) }
        let ext = source.pathExtension.isEmpty ? "mov" : source.pathExtension
        let destination = directory.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString).\(ext)")
        do {
            try files.copyItem(at: source, to: destination)
            let values = try destination.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
            guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else { throw CocoaError(.fileReadCorruptFile) }
        } catch {
            try? files.removeItem(at: destination)
            throw error
        }
        for old in previous { try? files.removeItem(at: old) }
        return destination
    }
}
