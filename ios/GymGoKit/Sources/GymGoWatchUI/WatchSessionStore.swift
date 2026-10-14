import Foundation
import GymGoKit
import Observation
#if os(watchOS)
import WatchKit
#endif

/// The session on the wrist, and everything the screens need from it.
///
/// Saved to disk after every change, so a crash or a relaunch mid-session
/// keeps its place. Every action becomes an event handed to `send`, which the
/// watch app wires to WatchConnectivity; until the phone confirms one it stays
/// in the session's outbox.
@MainActor
@Observable
public final class WatchSessionStore {
    public private(set) var session: WatchSession?
    /// The rest under way, if any.
    public private(set) var rest: Rest?
    /// The last set's record, shown on the rest screen.
    public private(set) var lastRecord: SetRecord?
    public var sound = true
    public var haptics = true

    public struct Rest: Equatable, Sendable {
        public var endsAt: Date
        public var seconds: Int
        public var upNext: UpNext
        public var id = UUID()
    }

    /// Hands an event to the phone. Replaced by the watch app at launch.
    public var send: @MainActor (WatchEvent) -> Void = { _ in }

    private let fileURL: URL?
    private var restTask: Task<Void, Never>?

    public init(fileURL: URL? = WatchSessionStore.defaultFileURL) {
        self.fileURL = fileURL
        if let fileURL, let data = try? Data(contentsOf: fileURL) {
            session = try? JSONDecoder().decode(WatchSession.self, from: data)
        }
    }

    public nonisolated static var defaultFileURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("session.json")
    }

    // MARK: From the phone

    /// A new list from the phone. A different workout replaces the session.
    public func receive(_ snapshot: WatchSnapshot) {
        if var current = session {
            current.receive(snapshot)
            session = current
        } else {
            session = WatchSession(snapshot: snapshot)
        }
        save()
    }

    /// The phone has applied these events.
    public func acknowledge(_ ids: Set<String>) {
        session?.acknowledge(ids)
        save()
    }

    /// Every event not yet confirmed, to send again after a reconnection.
    public var unconfirmed: [WatchEvent] { session?.outbox ?? [] }

    // MARK: From the wrist

    public var setInHand: SetInHand? { session?.setInHand }

    /// Logs the set in hand and starts whatever rest follows.
    @discardableResult
    public func done(weight: Double, reps: Int, at date: Date = Date()) -> LogOutcome? {
        guard var current = session, let outcome = current.logSetInHand(weight: weight, reps: reps, at: date) else { return nil }
        session = current
        lastRecord = outcome.record
        send(outcome.event)
        if let seconds = outcome.restSeconds {
            startRest(seconds: seconds, upNext: outcome.upNext, from: date)
        } else {
            rest = nil
            restTask?.cancel()
        }
        play(outcome.record != nil ? .record : .logged)
        save()
        return outcome
    }

    public func skipRest() {
        guard rest != nil else { return }
        rest = nil
        restTask?.cancel()
        session?.skipRest()
        if let event = session?.outbox.last { send(event) }
        save()
    }

    /// Thirty seconds more or less, never below nothing.
    public func adjustRest(by seconds: Int) {
        guard var current = rest else { return }
        let ends = max(Date(), current.endsAt.addingTimeInterval(TimeInterval(seconds)))
        current.endsAt = ends
        rest = current
        scheduleRestEnd(current)
    }

    public func finish() {
        rest = nil
        restTask?.cancel()
        session?.finish()
        if let event = session?.outbox.last { send(event) }
        save()
    }

    /// After Finish, once the phone has everything, the wrist is clear.
    public func clearIfDone() {
        guard let session, session.finished, session.outbox.isEmpty else { return }
        self.session = nil
        save()
    }

    // MARK: Rest

    private func startRest(seconds: Int, upNext: UpNext, from date: Date) {
        let current = Rest(endsAt: date.addingTimeInterval(TimeInterval(seconds)), seconds: seconds, upNext: upNext)
        rest = current
        scheduleRestEnd(current)
    }

    /// One firm tap when the rest runs out. A haptic briefly pauses heart-rate
    /// collection, which is why it is one tap and not a pattern.
    private func scheduleRestEnd(_ current: Rest) {
        restTask?.cancel()
        restTask = Task { [weak self] in
            let wait = current.endsAt.timeIntervalSinceNow
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            guard !Task.isCancelled, let self, self.rest?.id == current.id else { return }
            self.rest = nil
            self.play(.restOver)
        }
    }

    enum Cue { case logged, record, restOver }

    private func play(_ cue: Cue) {
        guard haptics else { return }
        #if os(watchOS)
        switch cue {
        case .logged: WKInterfaceDevice.current().play(.click)
        case .record: WKInterfaceDevice.current().play(.success)
        case .restOver: WKInterfaceDevice.current().play(.notification)
        }
        #endif
    }

    // MARK: Disk

    private func save() {
        guard let fileURL else { return }
        do {
            if let session {
                try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try JSONEncoder().encode(session).write(to: fileURL, options: .atomic)
            } else {
                try? FileManager.default.removeItem(at: fileURL)
            }
        } catch {
            print("GymGo watch: could not save the session: \(error)")
        }
    }
}
