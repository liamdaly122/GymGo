#if os(watchOS)
import Foundation
import GymGoKit
import WatchConnectivity

/// The watch's end of the link with the phone (docs/watch-protocol.md,
/// "Transport").
///
/// - In: the phone's whole context, as its application context
///   `["context": json]`: newest wins, and it is waiting here on the next wake.
///   Acknowledgements, `["ack": [ids]]`, by `transferUserInfo`.
/// - Out: every action on the wrist as an event, two ways: `transferUserInfo`
///   (queued, delivered for certain, in order, even to a locked phone) and
///   `sendMessage` when the phone is reachable (faster, and it wakes the
///   phone app's native side). Each event carries its own ID, so the phone
///   applies the second copy once. A finish carries its unconfirmed sets.
///   A set's `completeSet` reaches here only once its 5 s Undo window has
///   closed (the store holds it, and `unconfirmedEvents()` leaves it out of
///   a resend), or at once on a Finish.
/// - Out: state reports, as the watch's own application context
///   `["state": json]` and by `sendMessage` when reachable. Never queued:
///   the newest `seq` wins.
///
/// WatchConnectivity calls the delegate on a background queue: each method
/// copies what it needs and hops to the main actor for the store.
public final class PhoneLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    private let store: WatchSessionStore
    private let lock = NSLock()
    /// The newest state report, until the session is up to send it.
    private var pendingState: String?

    @MainActor
    public init(store: WatchSessionStore) {
        self.store = store
        super.init()
        store.sendEvent = { [weak self] event in self?.send(event) }
        store.sendState = { [weak self] json in self?.send(state: json) }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // MARK: - Out

    private func send(_ event: WatchEvent) {
        guard WCSession.isSupported(), let json = try? event.json() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return } // resent on activation
        session.transferUserInfo(["event": json])
        if session.isReachable {
            session.sendMessage(["event": json], replyHandler: nil, errorHandler: nil)
        }
    }

    private func send(state json: String) {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else {
            lock.withLock { pendingState = json }
            return
        }
        do {
            try session.updateApplicationContext(["state": json])
            lock.withLock { pendingState = nil }
        } catch {
            lock.withLock { pendingState = json }
            print("GymGo watch: could not send the state to the phone: \(error)")
        }
        if session.isReachable {
            session.sendMessage(["state": json], replyHandler: nil, errorHandler: nil)
        }
    }

    /// Anything not yet confirmed and not already on its way goes again.
    private func resendUnconfirmed() {
        let session = WCSession.default
        let queued = Set(session.outstandingUserInfoTransfers.compactMap { $0.userInfo["event"] as? String }.compactMap { try? WatchEvent.decode($0).id })
        Task { @MainActor in
            for event in self.store.unconfirmedEvents() where !queued.contains(event.id) {
                self.send(event)
            }
        }
    }

    // MARK: - In

    private func receive(context dictionary: [String: Any]) {
        guard let json = dictionary["context"] as? String else { return }
        do {
            let context = try WatchContext.decode(json)
            Task { @MainActor in self.store.receive(context) }
        } catch {
            print("GymGo watch: could not read the context from the phone: \(error)")
        }
    }

    private func receive(acknowledgements dictionary: [String: Any]) {
        guard let ids = dictionary["ack"] as? [String] else { return }
        Task { @MainActor in self.store.acknowledge(Set(ids)) }
    }

    // MARK: - WCSessionDelegate. Called on a background queue.

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        receive(context: session.receivedApplicationContext)
        resendUnconfirmed()
        if let json = lock.withLock({ pendingState }) { send(state: json) }
        Task { @MainActor in self.store.reportNow() }
    }

    public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        receive(context: applicationContext)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        receive(acknowledgements: userInfo)
        receive(context: userInfo)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        receive(acknowledgements: message)
        receive(context: message)
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        receive(acknowledgements: message)
        receive(context: message)
        replyHandler(["received": true])
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        guard session.isReachable else { return }
        resendUnconfirmed()
        Task { @MainActor in self.store.reportNow() }
    }
}
#endif
