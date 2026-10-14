import Capacitor
import Foundation

/// The web app's handle on the watch link (src/platform/watch.ts).
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainInbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        WatchLink.shared.onInbox = { [weak self] in
            self?.notifyListeners("inbox", data: [:])
        }
    }

    @objc func sendSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("No session to send")
            return
        }
        WatchLink.shared.send(snapshot: json)
        call.resolve()
    }

    @objc func drainInbox(_ call: CAPPluginCall) {
        call.resolve(["events": WatchLink.shared.inbox()])
    }

    @objc func acknowledge(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        WatchLink.shared.acknowledge(ids)
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(WatchLink.shared.status)
    }
}
