import Foundation

/// Canonicalize both sides: physical iPhones can rewrite /private/var to /var.
/// Keep the containment check after resolving aliases, including any symlinks.
enum BundledResourcePath {
    static func resolve(_ path: String, under root: URL) -> URL? {
        let directory = root.resolvingSymlinksInPath().standardizedFileURL
        let resource = directory.appendingPathComponent(path).resolvingSymlinksInPath().standardizedFileURL
        guard resource.path.hasPrefix(directory.path + "/") else { return nil }
        return resource
    }
}
