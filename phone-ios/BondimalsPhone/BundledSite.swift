import WebKit
import UniformTypeIdentifiers

/// Only packaged app resources are exposed. Navigation never loads a remote page into the native bridge.
final class BundledSite: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let root = Bundle.main.url(forResource: "Web", withExtension: nil),
              let requestURL = task.request.url, requestURL.host == "app" else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let path = requestURL.path == "/" ? "index.html" : String(requestURL.path.dropFirst())
        guard let url = BundledResourcePath.resolve(path, under: root) else {
            task.didFailWithError(URLError(.noPermissionsToReadFile)); return
        }
        let data: Data
        do { data = try Data(contentsOf: url) }
        catch {
            print("Kith resource read failed: \(error)")
            task.didFailWithError(error); return
        }
        let types = ["js": "application/javascript", "css": "text/css", "html": "text/html", "glb": "model/gltf-binary", "svg": "image/svg+xml"]
        let mime = types[url.pathExtension] ?? UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = HTTPURLResponse(url: requestURL, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*"
        ])!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
