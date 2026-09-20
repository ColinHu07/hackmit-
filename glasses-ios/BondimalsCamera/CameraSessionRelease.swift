import Foundation

enum CameraSessionRelease {
    /// Run in the independent cleanup task so canceling a quest does not cancel
    /// the wait for DAT's asynchronous stop. A stop request alone is not proof.
    @MainActor
    static func waitUntilStopped(timeout: TimeInterval = 4, isStopped: () -> Bool) async -> Bool {
        let deadline = ProcessInfo.processInfo.systemUptime + timeout
        while !isStopped(), ProcessInfo.processInfo.systemUptime < deadline {
            do { try await Task.sleep(for: .milliseconds(100)) }
            catch { return isStopped() }
        }
        return isStopped()
    }
}
