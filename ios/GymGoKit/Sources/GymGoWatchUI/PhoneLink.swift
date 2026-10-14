#if os(watchOS)
import Foundation
import GymGoKit
import WatchConnectivity

/// The watch's end of the link with the phone.
///
/// The phone sends the session list as its application context: newest wins,
/// and it is waiting here on the next wake. Every action on the wrist goes
/// back two ways: `transferUserInfo`, which is queued and delivered for
/// certain, in order, even to a locked phone; and `sendMessage` when the phone
/// is reachable, which is faster and wakes the phone app's native side. Each
/// event carries its own ID, so the phone applies the second copy once. When
/// the phone has applied an event it says so, and it leaves the outbox.
public final class PhoneLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    private let store: WatchSessionStore

    @MainActor
    public init(store: WatchSessionStore) {
        self.store = store
        super.init()
        store.send = { [weak self] event in self?.send(event) }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    private func send(_ event: WatchEvent) {
        guard WCSession.isSupported(),
              let data = try? JSONEncoder().encode(event),
              let json = String(data: data, encoding: .utf8) else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        session.transferUserInfo(["event": json])
        if session.isReachable {
            session.sendMessage(["event": json], replyHandler: nil, errorHandler: nil)
        }
    }

    /// Anything not yet confirmed and not already on its way goes again.
    private func resendUnconfirmed() {
        let session = WCSession.default
        let queued = Set(session.outstandingUserInfoTransfers.compactMap { $0.userInfo["event"] as? String }.compactMap(Self.id(of:)))
        Task { @MainActor in
            for event in self.store.unconfirmed where !queued.contains(event.id) {
                self.send(event)
            }
        }
    }

    private static func id(of json: String) -> String? {
        guard let data = json.data(using: .utf8) else { return nil }
        return (try? JSONDecoder().decode(WatchEvent.self, from: data))?.id
    }

    private func receive(context: [String: Any]) {
        guard let json = context["snapshot"] as? String, let data = json.data(using: .utf8) else { return }
        do {
            let snapshot = try WatchSnapshot.decode(data)
            Task { @MainActor in self.store.receive(snapshot) }
        } catch {
            print("GymGo watch: could not read the session from the phone: \(error)")
        }
    }

    // MARK: WCSessionDelegate. Called on a background queue.

    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        receive(context: session.receivedApplicationContext)
        resendUnconfirmed()
    }

    public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        receive(context: applicationContext)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let ids = userInfo["ack"] as? [String] else { return }
        Task { @MainActor in self.store.acknowledge(Set(ids)) }
    }

    public func sessionReachabilityDidChange(_ session: WCSession) {
        if session.isReachable { resendUnconfirmed() }
    }
}
#endif
