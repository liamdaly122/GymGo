import Foundation
import GymGoKit
#if os(watchOS)
import UserNotifications
#endif

/// The rest-over cue when no Health workout keeps the app running.
///
/// Wrist-down, watchOS suspends a watch app unless a workout session runs, so
/// the cues the store times in-process stop with it. While Health is not
/// recording, the rest's end is also handed to the system as a local
/// notification with a sound, which plays its own haptic wrist-down.
/// `RestAlert` (GymGoKit) decides which one is wanted; this keeps the one
/// scheduled in step: replaced when the rest changes, removed when it is
/// skipped, ends, or Health takes over.
///
/// In the foreground the notification is not shown: the store's own cue
/// plays instead, once, however the end reaches it first.
@MainActor
public final class RestAlerts: NSObject {
    /// The notification scheduled now, as far as this app knows.
    public private(set) var scheduled: RestAlert?
    /// A rest's end reached the app in the foreground, by its rest ID.
    var onPresented: (@MainActor (String) -> Void)?
    private var askedPermission = false

    nonisolated static let prefix = "gymgo.rest."

    override public init() {
        super.init()
    }

    /// Takes the foreground deliveries. Before the app finishes launching.
    func activate() {
        #if os(watchOS)
        UNUserNotificationCenter.current().delegate = self
        #endif
    }

    /// Asks once, in the foreground. A refusal leaves the in-process cues.
    func requestPermissionOnce() async {
        guard !askedPermission else { return }
        askedPermission = true
        #if os(watchOS)
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        #endif
    }

    /// The app is in front: rest-overs already delivered, by this launch or
    /// an earlier one, have done their job. They are the only notifications
    /// the app posts. The one still to come stays.
    func clearDelivered() {
        #if os(watchOS)
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        #endif
    }

    /// Schedules the notification wanted, removing the one it replaces.
    func sync(_ wanted: RestAlert?) {
        let change = RestAlert.reconcile(scheduled: scheduled, wanted: wanted)
        scheduled = wanted
        #if os(watchOS)
        let center = UNUserNotificationCenter.current()
        if let remove = change.remove {
            // Delivered too: one per rest would pile up in Notification Center.
            center.removePendingNotificationRequests(withIdentifiers: [Self.prefix + remove])
            center.removeDeliveredNotifications(withIdentifiers: [Self.prefix + remove])
        }
        guard let add = change.add else { return }
        let content = UNMutableNotificationContent()
        content.title = "Rest over"
        content.body = "Up next: \(add.upNext.name) · \(add.upNext.detail)"
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, add.fireAt.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: Self.prefix + add.id, content: content, trigger: trigger))
        #endif
    }
}

#if os(watchOS)
extension RestAlerts: UNUserNotificationCenterDelegate {
    /// In the foreground: no banner and no sound. The store plays the
    /// rest-over cue, unless its own timer already has.
    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        let identifier = notification.request.identifier
        guard identifier.hasPrefix(Self.prefix) else { return [.banner, .sound] }
        let restId = String(identifier.dropFirst(Self.prefix.count))
        await MainActor.run { self.onPresented?(restId) }
        return []
    }
}
#endif
