import Foundation

enum QuestHTTPError: LocalizedError {
    case rejected(Int, String)
    var errorDescription: String? { if case .rejected(_, let message) = self { return message }; return nil }
}

enum CameraResultUpload {
    struct DeadlineExceeded: LocalizedError {
        var errorDescription: String? { "The capture upload could not be confirmed. Reopen Kith on your glasses to check for the saved result before recording again." }
    }

    static func isTransient(_ error: Error) -> Bool {
        if case QuestHTTPError.rejected(let code, _) = error {
            return [408, 429, 500, 502, 503, 504].contains(code)
        }
        let ns = error as NSError
        guard ns.domain == NSURLErrorDomain else { return false }
        return [URLError.timedOut, .networkConnectionLost, .notConnectedToInternet,
                .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed, .badServerResponse].contains(URLError.Code(rawValue: ns.code))
    }

    /// Reuses only the already-captured evidence. Neither camera startup nor
    /// grading belongs in this operation. All attempts share a hard deadline.
    @MainActor
    static func run(budget: TimeInterval = 20, attemptLimit: TimeInterval = 6,
                    backoffs: [TimeInterval] = [0.5, 1, 2],
                    isCurrent: () -> Bool,
                    operation: @escaping @MainActor (TimeInterval) async throws -> Void) async throws {
        let deadline = ProcessInfo.processInfo.systemUptime + budget
        var attempt = 0
        while true {
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
            let remaining = deadline - ProcessInfo.processInfo.systemUptime
            guard remaining > 0 else { throw DeadlineExceeded() }
            let timeout = min(attemptLimit, remaining)
            do {
                try await withThrowingTaskGroup(of: Void.self) { group in
                    group.addTask { try await operation(timeout) }
                    group.addTask {
                        try await Task.sleep(for: .seconds(timeout))
                        throw URLError(.timedOut)
                    }
                    defer { group.cancelAll() }
                    _ = try await group.next()
                }
                try Task.checkCancellation()
                guard isCurrent() else { throw CancellationError() }
                return
            } catch {
                try Task.checkCancellation()
                guard isCurrent() else { throw CancellationError() }
                guard isTransient(error) else { throw error }
                let remaining = deadline - ProcessInfo.processInfo.systemUptime
                guard remaining > 0 else { throw DeadlineExceeded() }
                let backoff = backoffs.isEmpty ? 0.5 : backoffs[min(attempt, backoffs.count - 1)]
                attempt += 1
                try await Task.sleep(for: .seconds(min(max(0.01, backoff), remaining)))
            }
        }
    }
}
