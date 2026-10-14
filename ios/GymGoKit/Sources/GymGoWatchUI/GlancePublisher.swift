import Foundation
import GymGoKit
#if os(watchOS)
import WidgetKit
#endif

/// Writes the complications' glance to the App Group and asks WidgetKit to
/// reload them, only when what they show has changed. Every reload spends
/// the day's budget; a write that changes nothing spends none, and a rest
/// that simply ran out is written without one (`WatchGlance.needsReload`).
///
/// `WatchApp` hangs it off the store's `onSaved`, so it runs after every
/// save, the 30-second heartbeat included, and once at launch. The tests
/// pass a temporary file and count the reloads; they never ask for a group
/// container, which on the Mac can prompt for access.
@MainActor
public final class GlancePublisher {
    private let url: URL?
    /// Reloads the timelines; `true` when the Smart Stack's relevance should
    /// be worked out again too (the training days changed, or the clock's
    /// time zone did).
    private let reload: @MainActor (_ relevanceChanged: Bool) -> Void
    /// The glance last written: compared with the next, and the source of
    /// the day a session was done on the wrist.
    private(set) var last: WatchGlance?

    public init(url: URL?, reload: @escaping @MainActor (_ relevanceChanged: Bool) -> Void) {
        self.url = url
        self.reload = reload
        last = WatchGlance.read(from: url)
    }

    /// The App Group's file, and WidgetKit. With no App Group (the
    /// entitlement missing) the URL is nil and nothing is written: the
    /// complications say "Open GymGo on your iPhone", and the app runs
    /// exactly as before.
    public static var live: GlancePublisher {
        #if os(watchOS)
        GlancePublisher(url: WatchGlance.defaultURL()) { relevanceChanged in
            WidgetCenter.shared.reloadTimelines(ofKind: glanceWidgetKind)
            if relevanceChanged { WidgetCenter.shared.invalidateRelevance(ofKind: glanceWidgetKind) }
        }
        #else
        .off
        #endif
    }

    public static var off: GlancePublisher { GlancePublisher(url: nil) { _ in } }

    /// After a save: the glance, written and reloaded if it changed.
    public func publish(_ state: WatchAppState, now: Date = Date(), timeZone: TimeZone = .current) {
        write(state, now: now, timeZone: timeZone, force: false)
    }

    /// The watch moved time zone: the day, and every midnight in the
    /// timeline, moved with it. WidgetKit does not reload for that by
    /// itself, so this always does.
    public func timeZoneChanged(_ state: WatchAppState, now: Date = Date(), timeZone: TimeZone = .current) {
        write(state, now: now, timeZone: timeZone, force: true)
    }

    private func write(_ state: WatchAppState, now: Date, timeZone: TimeZone, force: Bool) {
        guard let url else { return }
        let previous = last
        let glance = WatchGlance(state, now: now, previous: previous, timeZone: timeZone)
        if glance != previous {
            do {
                try glance.encoded().write(to: url, options: .atomic)
            } catch {
                // Left as it was, so the next save tries again.
                print("GymGo watch: could not write the glance: \(error)")
                return
            }
            last = glance
        }
        // The zone moved since the last glance, while the app was not
        // running to hear of it: the midnights moved, as for `timeZoneChanged`.
        let zoneMoved = previous.map { $0.zone != glance.zone } ?? false
        if force || zoneMoved {
            reload(true)
        } else if glance.needsReload(over: previous, now: now) {
            let daysBefore = (previous ?? .empty).trainingDays(from: now, timeZone: timeZone)
            reload(glance.trainingDays(from: now, timeZone: timeZone) != daysBefore)
        }
    }
}
