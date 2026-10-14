import Capacitor
import Foundation

/// The web app's handle on the watch link (src/platform/watch.ts). The
/// methods and their shapes are fixed in docs/watch-protocol.md, "Seams".
///
/// Two events: `inbox` (something landed; drain it) and `watchState` (`{ json,
/// receivedAt }`, the newest report). Each is published on the bridge's own
/// queue, the one `addListener` runs on, and kept for the first listener if
/// there is none yet, so nothing that lands while the web app is starting is
/// missed. Only the newest of each is kept: one is all either needs.
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lastState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatchWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        WatchLink.shared.onInbox = { [weak self] in
            self?.publish("inbox", [:])
        }
        WatchLink.shared.onState = { [weak self] json, receivedAt in
            self?.publish("watchState", ["json": json, "receivedAt": receivedAt])
        }
    }

    private func publish(_ event: String, _ data: JSObject) {
        let queue = (bridge as? CapacitorBridge)?.dispatchQueue ?? .main
        queue.async { [weak self] in
            guard let self else { return }
            if !self.hasListeners(event) {
                // Kept for the first listener: only the newest.
                self.retainedEventArguments?.removeObject(forKey: event)
            }
            self.notifyListeners(event, data: data, retainUntilConsumed: true)
        }
    }

    /// `{ json }`: the whole context. Sent now, or as soon as it can be.
    @objc func sendContext(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("No context to send")
            return
        }
        WatchLink.shared.send(context: json)
        call.resolve()
    }

    /// `{ events }`: every event not yet acknowledged, oldest first.
    @objc func drainInbox(_ call: CAPPluginCall) {
        call.resolve(["events": WatchLink.shared.inbox()])
    }

    /// `{ ids }`: applied or skipped for good.
    @objc func acknowledge(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        WatchLink.shared.acknowledge(ids)
        call.resolve()
    }

    /// `{ json, receivedAt }`, both null when the watch has never reported.
    @objc func lastState(_ call: CAPPluginCall) {
        if let state = WatchLink.shared.lastState() {
            call.resolve(["json": state.json, "receivedAt": state.receivedAt])
        } else {
            call.resolve(["json": NSNull(), "receivedAt": NSNull()])
        }
    }

    /// `{ started, error? }`. Resolves either way.
    @objc func startWatchWorkout(_ call: CAPPluginCall) {
        WatchLink.shared.startWatchWorkout { started, error in
            var result: JSObject = ["started": started]
            if let error { result["error"] = error }
            call.resolve(result)
        }
    }

    /// `{ supported, activated, paired, installed, reachable }`.
    @objc func status(_ call: CAPPluginCall) {
        call.resolve(WatchLink.shared.status)
    }
}
