import Foundation
import Vision
import CoreVideo
import CoreImage

struct LandmarkPoint: Codable { let x: Double; let y: Double; let z: Double }
struct TrackedHand: Codable { let id: String; let score: Double; let points: [LandmarkPoint] }
struct CameraPreview: Codable {
    let mime = "image/jpeg"
    let width: Int; let height: Int; let jpeg: String
}
struct HandFrame: Codable {
    let v = 1
    let type = "hands"
    let source = "glasses-camera"
    let coordinateSpace = "image-top-left"
    let mirrored = false
    let streamId: String
    let seq: Int
    let capturedAtMs: Double
    let width: Int
    let height: Int
    let hands: [TrackedHand]
    let preview: CameraPreview?
}

/// Only called from DAT's glasses video-frame publisher. No AVCaptureSession / phone camera.
final class HandFrameProcessor: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.bondimals.glasses.hands", qos: .userInitiated)
    private let lock = NSLock()
    private let request = VNDetectHumanHandPoseRequest()
    private var busy = false
    private var lastAt = -Double.infinity
    private var sequence = 0
    private var previewEnabled = false
    private var lastPreviewAt = -Double.infinity
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    let streamId = UUID().uuidString
    let orientation: CGImagePropertyOrientation
    let onFrame: (HandFrame) -> Void
    let onError: (String) -> Void
    private let joints: [VNHumanHandPoseObservation.JointName] = [
        .wrist, .thumbCMC, .thumbMP, .thumbIP, .thumbTip,
        .indexMCP, .indexPIP, .indexDIP, .indexTip,
        .middleMCP, .middlePIP, .middleDIP, .middleTip,
        .ringMCP, .ringPIP, .ringDIP, .ringTip,
        .littleMCP, .littlePIP, .littleDIP, .littleTip,
    ]
    init(rotation: Int, onFrame: @escaping (HandFrame) -> Void, onError: @escaping (String) -> Void) {
        orientation = [0: .up, 90: .right, 180: .down, 270: .left][rotation] ?? .up
        self.onFrame = onFrame
        self.onError = onError
        request.maximumHandCount = 2
    }
    func setPreviewEnabled(_ enabled: Bool) {
        lock.lock(); previewEnabled = enabled; lock.unlock()
    }
    func process(_ pixelBuffer: CVPixelBuffer) {
        let uptime = ProcessInfo.processInfo.systemUptime
        lock.lock()
        guard !busy, uptime - lastAt >= 0.09 else { lock.unlock(); return }
        busy = true; lastAt = uptime
        let sendPreview = previewEnabled && uptime - lastPreviewAt >= 0.25
        if sendPreview { lastPreviewAt = uptime }
        lock.unlock()
        let receivedAt = Date().timeIntervalSince1970 * 1000
        queue.async { [self] in
            defer { lock.lock(); busy = false; lock.unlock() }
            do {
                try VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: orientation, options: [:]).perform([request])
                var seenIds = Set<String>()
                let hands: [TrackedHand] = (request.results ?? []).enumerated().compactMap { index, hand in
                    guard let points = try? hand.recognizedPoints(.all),
                          let tip = points[.indexTip], let wrist = points[.wrist],
                          tip.confidence >= 0.6, wrist.confidence >= 0.6 else { return nil }
                    let id: String
                    switch hand.chirality {
                    case .left: id = "left"
                    case .right: id = "right"
                    default: id = "unknown-\(index)"
                    }
                    guard seenIds.insert(id).inserted else { return nil }
                    let landmarks = joints.map { joint -> LandmarkPoint in
                        let point = points[joint] ?? wrist
                        // Vision is bottom-left; web contract is unmirrored top-left.
                        return LandmarkPoint(x: point.location.x, y: 1 - point.location.y, z: 0)
                    }
                    return TrackedHand(id: id, score: Double(min(tip.confidence, wrist.confidence)), points: landmarks)
                }
                sequence += 1
                let swap = orientation == .right || orientation == .left
                let width = CVPixelBufferGetWidth(pixelBuffer), height = CVPixelBufferGetHeight(pixelBuffer)
                var preview: CameraPreview?
                if sendPreview {
                    // Same orientation as Vision; never mirror the preview or its hand overlay.
                    let oriented = CIImage(cvPixelBuffer: pixelBuffer).oriented(orientation)
                    let scale = min(1, 320 / max(oriented.extent.width, oriented.extent.height))
                    let resized = oriented.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                    if let data = imageContext.jpegRepresentation(of: resized, colorSpace: CGColorSpaceCreateDeviceRGB(),
                        options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.5]), data.count <= 49_152 {
                        preview = CameraPreview(width: Int(resized.extent.width.rounded()), height: Int(resized.extent.height.rounded()), jpeg: data.base64EncodedString())
                    }
                }
                onFrame(HandFrame(streamId: streamId, seq: sequence, capturedAtMs: receivedAt,
                                  width: swap ? height : width, height: swap ? width : height, hands: hands, preview: preview))
            } catch { onError("Hand tracking: \(error.localizedDescription)") }
        }
    }
}
