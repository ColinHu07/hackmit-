import Foundation

@main
struct CameraTimingTests {
    static func main() {
        // Startup took 25s. Only the following six seconds belong to recording.
        var normal = CameraClipWindow(startedAt: 25)
        for tick in 1...63 {
            let at = 25 + Double(tick) / 7
            _ = normal.accept(frameAt: at, now: at)
        }
        precondition(normal.sampleTimes.count >= 9 && normal.sampleTimes.count <= 12)
        precondition(normal.sampleTimes.allSatisfy { $0 >= 25 && $0 < 31 })
        precondition(normal.sampledDuration < 6)
        precondition(normal.finished(at: 31) && !normal.finished(at: 30.999))

        var slow = CameraClipWindow(startedAt: 0)
        for second in 0...8 { _ = slow.accept(frameAt: Double(second), now: Double(second)) }
        precondition(slow.sampleTimes == [0, 1, 2, 3, 4, 5], "a slow stream must not extend recording to fill twelve frames")
        precondition(slow.finished(at: 6))

        var full = CameraClipWindow(startedAt: 0)
        for index in 0..<12 { precondition(full.accept(frameAt: Double(index) * 0.5, now: Double(index) * 0.5)) }
        precondition(!full.finished(at: 5.5), "twelve samples must not shorten the recording window")
        precondition(!full.accept(frameAt: 6, now: 6), "frames at or after the deadline are excluded")

        var chronology = CameraClipWindow(startedAt: 10)
        precondition(!chronology.accept(frameAt: 9.9, now: 10))
        precondition(!chronology.accept(frameAt: 10.2, now: 10.1))
        precondition(!chronology.accept(frameAt: 10, now: 10.7))
        precondition(chronology.accept(frameAt: 10.1, now: 10.1))
        precondition(!chronology.accept(frameAt: 10.1, now: 10.2))
        precondition(!chronology.accept(frameAt: 10, now: 10.2))

        let sessionFailure = CameraStartupPhase.startingSession.timeoutMessage(session: "starting", stream: "off", rawFrame: false, decodedFrame: false, foreground: true)
        precondition(sessionFailure.contains("session is starting") && !sessionFailure.contains("permission"))
        let permissionFailure = CameraStartupPhase.requestingPermission.timeoutMessage(session: "idle", stream: "off", rawFrame: false, decodedFrame: false, foreground: true)
        precondition(permissionFailure.contains("permission is still pending"))
        let noFrames = CameraStartupPhase.waitingForFrame.timeoutMessage(session: "started", stream: "streaming", rawFrame: false, decodedFrame: false, foreground: true)
        precondition(noFrames.contains("No camera frames arrived") && !noFrames.contains("permission"))
        let decodeFailure = CameraStartupPhase.waitingForFrame.timeoutMessage(session: "started", stream: "streaming", rawFrame: true, decodedFrame: false, foreground: true)
        precondition(decodeFailure.contains("no image decoded"))
        print("Camera timing: fixed six-second window, startup exclusion, slow cadence, full sample set, chronology and precise startup failures passed.")
    }
}
