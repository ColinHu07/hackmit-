import Foundation

@main
struct CameraUploadTests {
    @MainActor
    static func main() async throws {
        var attempts = 0
        var storedResult: String?
        let evidence = "same-encoded-capture"
        try await CameraResultUpload.run(budget: 1, attemptLimit: 0.2, backoffs: [0.01], isCurrent: { true }) { timeout in
            precondition(timeout <= 0.2)
            attempts += 1
            if storedResult == nil {
                storedResult = evidence
                throw URLError(.networkConnectionLost) // Server saved it; response was lost.
            }
            precondition(storedResult == evidence) // Idempotent acknowledgment of the same evidence.
        }
        precondition(attempts == 2 && storedResult == evidence)

        for status in [400, 401, 403, 409] {
            attempts = 0
            do {
                try await CameraResultUpload.run(budget: 1, backoffs: [0.01], isCurrent: { true }) { _ in
                    attempts += 1
                    throw QuestHTTPError.rejected(status, "terminal")
                }
                preconditionFailure("terminal HTTP status must fail")
            } catch QuestHTTPError.rejected(let actual, _) { precondition(actual == status && attempts == 1) }
        }

        attempts = 0
        let canceled = Task { @MainActor in
            try await CameraResultUpload.run(budget: 1, backoffs: [0.3], isCurrent: { true }) { _ in
                attempts += 1
                throw QuestHTTPError.rejected(503, "temporary")
            }
        }
        while attempts == 0 { await Task.yield() }
        canceled.cancel()
        do { try await canceled.value; preconditionFailure("cancellation must stop retry") }
        catch is CancellationError { precondition(attempts == 1) }

        attempts = 0
        var current = true
        do {
            try await CameraResultUpload.run(budget: 1, backoffs: [0.01], isCurrent: { current }) { _ in
                attempts += 1
                current = false // A newer quest replaced this request in flight.
                throw URLError(.networkConnectionLost)
            }
            preconditionFailure("replaced requests must not retry")
        } catch is CancellationError { precondition(attempts == 1) }

        attempts = 0
        let began = ProcessInfo.processInfo.systemUptime
        do {
            try await CameraResultUpload.run(budget: 0.14, attemptLimit: 0.04, backoffs: [0.01], isCurrent: { true }) { _ in
                attempts += 1
                try await Task.sleep(for: .seconds(2)) // Simulated stalled upload.
            }
            preconditionFailure("a stalled upload must hit the total deadline")
        } catch is CameraResultUpload.DeadlineExceeded {
            precondition(attempts >= 2)
            precondition(ProcessInfo.processInfo.systemUptime - began < 0.7, "per-attempt timeout must cancel stalled work")
        }

        precondition(CameraResultUpload.isTransient(URLError(.timedOut)))
        precondition(CameraResultUpload.isTransient(QuestHTTPError.rejected(429, "retry")))
        precondition(!CameraResultUpload.isTransient(URLError(.cancelled)))
        precondition(!CameraResultUpload.isTransient(URLError(.serverCertificateUntrusted)))
        print("Camera upload: lost acknowledgment, terminal HTTP, cancellation, request replacement, hard deadline and retry classification passed.")
    }
}
