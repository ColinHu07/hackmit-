import Foundation

struct CameraClipWindow {
    let startedAt: TimeInterval
    let duration: TimeInterval = 6
    private(set) var sampleTimes: [TimeInterval] = []

    func finished(at now: TimeInterval) -> Bool { now >= startedAt + duration }

    mutating func accept(frameAt: TimeInterval, now: TimeInterval) -> Bool {
        guard frameAt.isFinite, now.isFinite, !finished(at: now),
              frameAt >= startedAt, frameAt < startedAt + duration, frameAt <= now,
              now - frameAt <= 0.6, sampleTimes.count < 12,
              sampleTimes.last.map({ frameAt - $0 >= 0.5 }) ?? true else { return false }
        sampleTimes.append(frameAt)
        return true
    }

    var sampledDuration: TimeInterval { (sampleTimes.last ?? startedAt) - (sampleTimes.first ?? startedAt) }
}

enum CameraStartupPhase: String {
    case idle, findingDevice, checkingPermission, requestingPermission, startingSession, startingStream, waitingForFrame, ready

    func timeoutMessage(session: String, stream: String, rawFrame: Bool, decodedFrame: Bool, foreground: Bool) -> String {
        let cause: String
        if !foreground { cause = "Kith Camera is not active on the phone. Keep it open and retry." }
        else if self == .findingDevice { cause = "Meta did not find a camera device. Wear the glasses and check their connection in Meta AI." }
        else if self == .checkingPermission { cause = "Meta did not return the camera permission status. Reopen Meta AI and retry." }
        else if self == .requestingPermission { cause = "Meta camera permission is still pending. Complete that prompt on the phone, then retry." }
        else if self == .startingSession { cause = "Meta session is \(session). Keep the glasses connected and close other camera apps before retrying." }
        else if rawFrame && !decodedFrame { cause = "Camera frames arrived but no image decoded. Camera state: \(stream). Restart Kith Camera and retry." }
        else if decodedFrame { cause = "An image arrived, but the camera did not stay ready. Camera state: \(stream). Reconnect the glasses and retry." }
        else { cause = "No camera frames arrived. Meta session: \(session); camera: \(stream). Check the glasses connection and retry." }
        return "Recording never started. " + cause
    }
}
