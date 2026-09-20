import Foundation

@main
struct CameraReleaseTests {
    @MainActor
    static func main() async {
        var stopped = false
        let cleanup = Task { await CameraSessionRelease.waitUntilStopped(timeout: 1) { stopped } }
        try? await Task.sleep(for: .milliseconds(30))
        precondition(!stopped, "calling stop must not count as terminal state")
        stopped = true
        let confirmed = await cleanup.value
        precondition(confirmed, "delayed terminal state must confirm release")

        let timedOut = await CameraSessionRelease.waitUntilStopped(timeout: 0.05) { false }
        precondition(!timedOut, "a camera that never stops must not report idle")
        let alreadyStopped = await CameraSessionRelease.waitUntilStopped(timeout: 0) { true }
        precondition(alreadyStopped, "an already stopped camera releases immediately")

        stopped = false
        let canceledCapture = Task { @MainActor in
            let independentCleanup = Task { await CameraSessionRelease.waitUntilStopped(timeout: 1) { stopped } }
            return await independentCleanup.value
        }
        try? await Task.sleep(for: .milliseconds(30))
        canceledCapture.cancel()
        stopped = true
        let canceledCaptureReleased = await canceledCapture.value
        precondition(canceledCaptureReleased, "canceling capture must not cancel independent session cleanup")
        print("Camera release: delayed stop, timeout, already stopped, and canceled capture passed.")
    }
}
