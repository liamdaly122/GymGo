import Foundation
import HealthKit
import WatchConnectivity

/// The phone's end of the link with the watch, in native code.
///
/// Started at launch by the app delegate rather than by the web app, because
/// iOS freezes the web view's JavaScript while the phone is locked, and the
/// watch has to be able to reach the phone then. The rules are in
/// docs/watch-protocol.md; the web app's side is src/platform/watch.ts.
///
/// - **To the watch:** the context, as `["context": json]` in the application
///   context. Newest wins. One that cannot go yet is kept and tried again when
///   the session activates, when a watch with GymGo on it turns up, and on a
///   short timer.
/// - **From the watch, events:** into an inbox file, even while the web view is
///   frozen, until the web app drains and acknowledges them. Every event comes
///   by two routes, so the last 500 acknowledged IDs are remembered on disk and
///   a copy of one of those is dropped rather than applied a second time.
/// - **From the watch, state:** the newest report, by `seq` (a later `at` lets
///   a lower `seq` through, as `reportFromWatch` does), stamped with the
///   phone's clock and kept on disk, so the web app can read it at launch.
///
/// Every WatchConnectivity delegate method is called on a background queue.
/// They copy the strings out and hand them to one serial queue, which is the
/// only place the state below is read or written; the two callbacks are set
/// and called on the main queue. That confinement is what the unchecked
/// Sendable stands for.
final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = WatchLink()

    /// How many acknowledged event IDs are remembered, so a late second copy is dropped.
    private static let appliedKept = 500
    /// How often a context that could not go is tried again, while there is a watch to send it to.
    private static let retryInterval: TimeInterval = 10
    /// A report is never stamped later than its own time plus this. One the
    /// watch made long ago and the phone only now picks up (an application
    /// context waiting at launch) must not arrive looking fresh. Two minutes is
    /// far more than a paired watch's clock ever drifts from the phone's.
    private static let clockAllowanceMs: Double = 2 * 60 * 1000

    /// Called on the main queue when something new lands in the inbox.
    var onInbox: (() -> Void)?
    /// Called on the main queue with a newer state report: its JSON, and when it arrived (phone clock, epoch ms).
    var onState: ((_ json: String, _ receivedAt: Double) -> Void)?

    private let queue = DispatchQueue(label: "com.liamdaly.gymgo.watchlink")
    private let health = HKHealthStore()

    // Only touched on `queue`.
    private var pendingContext: String?
    private var retryTimer: DispatchSourceTimer?
    private var pendingAcks: [String] = []
    private var reacknowledged: Set<String> = []
    private var applied: [String]?
    private var appliedSet: Set<String> = []
    private var stateLoaded = false
    private var latestState: ReceivedState?

    /// A state report as the phone holds it.
    private struct ReceivedState: Codable {
        var json: String
        var receivedAt: Double
    }

    private static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    }
    private var inboxURL: URL { Self.folder.appendingPathComponent("watch-inbox.json") }
    private var appliedURL: URL { Self.folder.appendingPathComponent("watch-applied.json") }
    private var stateURL: URL { Self.folder.appendingPathComponent("watch-state.json") }

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Whether there is a watch, and whether GymGo is on it. `activated` says
    /// whether the other answers mean anything yet: until the session is up
    /// they all read false.
    var status: [String: Bool] {
        guard WCSession.isSupported() else {
            return ["supported": false, "activated": false, "paired": false, "installed": false, "reachable": false]
        }
        let session = WCSession.default
        let active = session.activationState == .activated
        return [
            "supported": true,
            "activated": active,
            "paired": active && session.isPaired,
            "installed": active && session.isWatchAppInstalled,
            "reachable": active && session.isReachable,
        ]
    }

    // MARK: To the watch

    /// The whole context, as JSON. Replaces any that has not gone yet.
    func send(context json: String) {
        queue.async {
            self.pendingContext = json
            self.flushContext()
        }
    }

    /// On `queue`.
    private func flushContext() {
        guard let json = pendingContext else { return stopRetrying() }
        guard WCSession.isSupported() else {
            pendingContext = nil
            return stopRetrying()
        }
        let session = WCSession.default
        // Sent from the activation callback; the timer covers an activation that is slow to come.
        guard session.activationState == .activated else { return retryLater() }
        // Nothing to send to: kept for sessionWatchStateDidChange, not retried on a timer for ever.
        guard session.isPaired, session.isWatchAppInstalled else { return stopRetrying() }
        do {
            try session.updateApplicationContext(["context": json])
            pendingContext = nil
            stopRetrying()
        } catch {
            if (error as? WCError)?.code == .payloadTooLarge {
                // Sending it again cannot help. The next context replaces it.
                print("GymGo: the context for the watch is too large (\(json.utf8.count) bytes): \(error)")
                pendingContext = nil
                return stopRetrying()
            }
            print("GymGo: could not send the context to the watch, trying again: \(error)")
            retryLater()
        }
    }

    /// On `queue`.
    private func retryLater() {
        guard retryTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + Self.retryInterval, repeating: Self.retryInterval)
        timer.setEventHandler { [weak self] in self?.flushContext() }
        timer.resume()
        retryTimer = timer
    }

    /// On `queue`.
    private func stopRetrying() {
        retryTimer?.cancel()
        retryTimer = nil
    }

    /// Opens GymGo on the watch, which starts its workout session in
    /// `handle(_ workoutConfiguration:)`: the only place a watch app may start
    /// one from the background. Answers either way, never throws.
    func startWatchWorkout(_ done: @escaping (_ started: Bool, _ error: String?) -> Void) {
        guard WCSession.isSupported() else { return done(false, "This iPhone cannot pair with an Apple Watch.") }
        let session = WCSession.default
        guard session.activationState == .activated else { return done(false, "The link with the watch is not up yet.") }
        guard session.isPaired else { return done(false, "No Apple Watch is paired with this iPhone.") }
        guard session.isWatchAppInstalled else { return done(false, "GymGo is not installed on the watch.") }
        guard HKHealthStore.isHealthDataAvailable() else { return done(false, "Health is not available on this iPhone.") }
        let store = health
        Task {
            // Made here, where it is used: a workout configuration is not Sendable.
            let configuration = HKWorkoutConfiguration()
            configuration.activityType = .traditionalStrengthTraining
            configuration.locationType = .indoor
            do {
                try await store.startWatchApp(toHandle: configuration)
                done(true, nil)
            } catch {
                done(false, error.localizedDescription)
            }
        }
    }

    // MARK: The inbox

    /// Every event not yet acknowledged, oldest first, as the JSON the watch sent.
    func inbox() -> [String] {
        queue.sync { readInbox() ?? [] }
    }

    /// The web app has applied these, or skipped them for good. They leave the
    /// inbox, are remembered so a late copy is dropped, and the watch is told so
    /// it can forget them too.
    func acknowledge(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        queue.async {
            let gone = Set(ids)
            if let events = self.readInbox() {
                self.writeInbox(events.filter { event in
                    guard let id = Self.id(of: event) else { return true }
                    return !gone.contains(id)
                })
            }
            self.remember(ids)
            self.pendingAcks.append(contentsOf: ids)
            self.flushAcks()
        }
    }

    /// On `queue`.
    private func receive(event json: String) {
        guard let id = Self.id(of: json) else {
            print("GymGo: dropped an event from the watch with no ID")
            return
        }
        if loadApplied().contains(id) {
            // The slower copy of an event already applied. Not applied again;
            // and if its acknowledgement is not on its way, it is sent again,
            // so a lost one cannot leave the watch sending this for ever.
            return reacknowledge(id)
        }
        // Unreadable (it is there, but the phone has not been unlocked since it
        // started): leave it alone. The watch sends again what is not acknowledged.
        guard var events = readInbox() else { return }
        guard !events.contains(where: { Self.id(of: $0) == id }) else { return }
        events.append(json)
        writeInbox(events)
        DispatchQueue.main.async { self.onInbox?() }
    }

    /// On `queue`.
    private func reacknowledge(_ id: String) {
        guard !reacknowledged.contains(id) else { return }
        let outstanding = WCSession.default.outstandingUserInfoTransfers
            .flatMap { ($0.userInfo["ack"] as? [String]) ?? [] }
        guard !outstanding.contains(id) else { return }
        reacknowledged.insert(id)
        pendingAcks.append(id)
        flushAcks()
    }

    /// On `queue`. Acknowledgements are queued by WatchConnectivity and
    /// delivered for certain once handed over; until the session is up they
    /// wait here.
    private func flushAcks() {
        guard !pendingAcks.isEmpty, WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        var seen = Set<String>()
        let ids = pendingAcks.filter { seen.insert($0).inserted }
        pendingAcks = []
        session.transferUserInfo(["ack": ids])
    }

    /// On `queue`.
    private func remember(_ ids: [String]) {
        var list = loadApplied()
        for id in ids where !appliedSet.contains(id) {
            list.append(id)
            appliedSet.insert(id)
        }
        if list.count > Self.appliedKept {
            for id in list.prefix(list.count - Self.appliedKept) { appliedSet.remove(id) }
            list.removeFirst(list.count - Self.appliedKept)
        }
        applied = list
        write(list, to: appliedURL)
    }

    /// On `queue`.
    private func loadApplied() -> [String] {
        if let applied { return applied }
        let list = read([String].self, from: appliedURL) ?? []
        applied = list
        appliedSet = Set(list)
        return list
    }

    private static func id(of json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["id"] as? String
    }

    /// On `queue`. Nil when the file is there but cannot be read, so nothing overwrites it.
    private func readInbox() -> [String]? {
        guard FileManager.default.fileExists(atPath: inboxURL.path) else { return [] }
        guard let data = try? Data(contentsOf: inboxURL) else { return nil }
        // A file that is not a list of strings is not something this app wrote: start again.
        return (try? JSONDecoder().decode([String].self, from: data)) ?? []
    }

    /// On `queue`.
    private func writeInbox(_ events: [String]) {
        write(events, to: inboxURL)
    }

    // MARK: The watch's state

    /// The newest state report, and when it arrived (phone clock, epoch ms).
    func lastState() -> (json: String, receivedAt: Double)? {
        queue.sync { loadState().map { ($0.json, $0.receivedAt) } }
    }

    /// On `queue`.
    private func receive(state json: String) {
        guard let incoming = Self.order(of: json) else {
            print("GymGo: dropped a state report from the watch with no seq or at")
            return
        }
        if let held = loadState(), let current = Self.order(of: held.json),
           incoming.seq <= current.seq, incoming.at <= current.at {
            return
        }
        let now = Date().timeIntervalSince1970 * 1000
        let made = Self.epochMs(incoming.at)
        let receivedAt = made.map { min(now, $0 + Self.clockAllowanceMs) } ?? now
        let record = ReceivedState(json: json, receivedAt: receivedAt)
        latestState = record
        write(record, to: stateURL)
        DispatchQueue.main.async { self.onState?(json, receivedAt) }
    }

    /// On `queue`.
    private func loadState() -> ReceivedState? {
        if !stateLoaded {
            latestState = read(ReceivedState.self, from: stateURL)
            stateLoaded = true
        }
        return latestState
    }

    /// What decides which of two reports is newer: `seq`, and the watch's own `at`.
    private static func order(of json: String) -> (seq: Double, at: String)? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let seq = (object["seq"] as? NSNumber)?.doubleValue,
              let at = object["at"] as? String else { return nil }
        return (seq, at)
    }

    private static func epochMs(_ iso: String) -> Double? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date.timeIntervalSince1970 * 1000 }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso).map { $0.timeIntervalSince1970 * 1000 }
    }

    // MARK: Files

    /// On `queue`. Readable once the phone has been unlocked after starting,
    /// so the watch's events can be written while it is locked in a bag.
    private func write<Value: Encodable>(_ value: Value, to url: URL) {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            print("GymGo: could not write \(url.lastPathComponent): \(error)")
        }
    }

    private func read<Value: Decodable>(_ type: Value.Type, from url: URL) -> Value? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    // MARK: WCSessionDelegate. Called on a background queue.

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        // The watch's last state, which may have been waiting since before this launch.
        let waiting = session.receivedApplicationContext["state"] as? String
        queue.async {
            self.flushContext()
            self.flushAcks()
            if let waiting { self.receive(state: waiting) }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // A different watch was paired: start again with that one.
        session.activate()
    }

    /// Paired, unpaired, GymGo installed or removed on the watch.
    func sessionWatchStateDidChange(_ session: WCSession) {
        queue.async {
            self.flushContext()
            self.flushAcks()
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        queue.async { self.flushAcks() }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        take(applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        take(userInfo)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        take(message)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        take(message)
        replyHandler(["received": true])
    }

    /// An acknowledgement that failed to go is sent again at the next chance.
    func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
        guard error != nil, let ids = userInfoTransfer.userInfo["ack"] as? [String] else { return }
        queue.async { self.pendingAcks.append(contentsOf: ids) }
    }

    private func take(_ payload: [String: Any]) {
        let event = payload["event"] as? String
        let state = payload["state"] as? String
        guard event != nil || state != nil else { return }
        queue.async {
            if let event { self.receive(event: event) }
            if let state { self.receive(state: state) }
        }
    }
}
