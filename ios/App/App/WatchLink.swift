import Foundation
import WatchConnectivity

/// The phone's end of the link with the watch, in native code.
///
/// Started at launch by the app delegate rather than by the web app, because
/// iOS freezes the web view's JavaScript while the phone is locked, and the
/// watch has to be able to reach the phone then. Events from the watch go
/// straight into an inbox file; the web app drains it when it next runs
/// (src/platform/watch.ts). The latest session list goes out as the
/// application context: newest wins, and the watch gets it on its next wake.
final class WatchLink: NSObject, WCSessionDelegate {
    static let shared = WatchLink()

    /// Called on the main queue when something lands in the inbox.
    var onInbox: (() -> Void)?

    private let queue = DispatchQueue(label: "com.liamdaly.gymgo.watchlink")
    private var pendingSnapshot: String?

    private var inboxURL: URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return folder.appendingPathComponent("watch-inbox.json")
    }

    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    var status: [String: Bool] {
        guard WCSession.isSupported() else { return ["supported": false, "paired": false, "installed": false, "reachable": false] }
        let session = WCSession.default
        let active = session.activationState == .activated
        return [
            "supported": true,
            "paired": active && session.isPaired,
            "installed": active && session.isWatchAppInstalled,
            "reachable": active && session.isReachable,
        ]
    }

    // MARK: To the watch

    /// The session list, as JSON. Sent once the link is up if it is not yet.
    func send(snapshot json: String) {
        queue.async {
            guard WCSession.isSupported() else { return }
            guard WCSession.default.activationState == .activated else {
                self.pendingSnapshot = json
                return
            }
            do {
                try WCSession.default.updateApplicationContext(["snapshot": json])
            } catch {
                self.pendingSnapshot = json
                print("GymGo: could not send the session to the watch: \(error)")
            }
        }
    }

    // MARK: The inbox

    /// Every event not yet applied, oldest first, as the JSON the watch sent.
    func inbox() -> [String] {
        queue.sync { readInbox() }
    }

    /// The web app has applied these. They leave the inbox, and the watch is
    /// told so it can forget them too.
    func acknowledge(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        queue.async {
            let keep = self.readInbox().filter { !ids.contains(Self.id(of: $0) ?? "") }
            self.writeInbox(keep)
            if WCSession.isSupported(), WCSession.default.activationState == .activated {
                WCSession.default.transferUserInfo(["ack": ids])
            }
        }
    }

    private func receive(event json: String) {
        queue.async {
            var events = self.readInbox()
            // Each event comes by two routes; the second copy is dropped here.
            guard let id = Self.id(of: json), !events.contains(where: { Self.id(of: $0) == id }) else { return }
            events.append(json)
            self.writeInbox(events)
            DispatchQueue.main.async { self.onInbox?() }
        }
    }

    private static func id(of json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["id"] as? String
    }

    private func readInbox() -> [String] {
        guard let data = try? Data(contentsOf: inboxURL),
              let events = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return events
    }

    private func writeInbox(_ events: [String]) {
        do {
            try FileManager.default.createDirectory(at: inboxURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(events).write(to: inboxURL, options: .atomic)
        } catch {
            print("GymGo: could not write the watch inbox: \(error)")
        }
    }

    // MARK: WCSessionDelegate. Called on a background queue.

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        queue.async {
            if let json = self.pendingSnapshot {
                self.pendingSnapshot = nil
                try? session.updateApplicationContext(["snapshot": json])
            }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // A different watch was paired: start again with that one.
        session.activate()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if let json = userInfo["event"] as? String { receive(event: json) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let json = message["event"] as? String { receive(event: json) }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if let json = message["event"] as? String { receive(event: json) }
        replyHandler(["received": true])
    }
}
