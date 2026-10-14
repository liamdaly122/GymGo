import ActivityKit
import Foundation
import GymGoKit
import HealthKit
import UIKit

/// The iPhone's Live Activity for a session the watch runs: the rest
/// countdown on the Lock Screen and in the Dynamic Island. The rules are
/// GymGoKit's `LiveSession` (pure, tested); the views are the "GymGo Live
/// Activity" extension; docs/watch-protocol.md, "The Live Activity on the
/// iPhone", is the contract.
///
/// - **Start** only with the app in the foreground (ActivityKit's rule), or
///   in the ten seconds HealthKit grants when the watch mirrors its workout
///   session to the phone. So it goes up at the phone's Start
///   ("Starting on your watch"), when GymGo comes to the foreground during a
///   watch session, or when a mirrored session launches the phone; otherwise
///   a session started on the wrist shows nothing until GymGo is opened.
/// - **Update** on every state report, which may arrive with the app woken in
///   the background by the watch's `sendMessage`. Nothing ticks: the views
///   count down by themselves.
/// - **End** when the watch's session ends, when another workout replaces it,
///   or at the first chance after the report goes stale (the views already
///   say "Out of touch" then, through the stale date).
/// - Never alerts: the rest's one cue is the watch's.
/// - A Live Activity the person swiped away is not started again for that
///   workout.
///
/// Everything here runs on the main actor; WatchLink's callbacks arrive on
/// the main queue.
@MainActor
final class LiveSessionActivities {
    static let shared = LiveSessionActivities()

    /// What the manager reads from the phone's side of the link: WatchLink.
    struct Source {
        /// The newest state report and when it arrived (phone clock, epoch ms).
        var lastState: () -> (json: String, receivedAt: Double)?
        /// The watch's events not yet drained, as JSON (for a wrist start's time).
        var inbox: () -> [String]
        /// The context the phone last sent the watch, as JSON (names the session).
        var lastContext: () -> String?
    }

    var source = Source(lastState: { nil }, inbox: { [] }, lastContext: { nil })

    private typealias Live = Activity<GymGoSessionAttributes>

    /// The workout whose Live Activity this phone last started and has not
    /// ended itself, and when. If it is gone while that session still runs,
    /// the person swiped it away. Kept across launches.
    private struct Started: Codable {
        var workoutId: String
        var at: Date
        /// The app bundle's path when it started. Installing the app again
        /// (an update, or a build from Xcode) ends its Live Activities and
        /// moves the bundle, and that is not the person saying no.
        var install: String?
    }

    private static let startedKey = "gymgo.liveActivity.started"
    private var started: Started? {
        get {
            guard let data = UserDefaults.standard.data(forKey: Self.startedKey) else { return nil }
            return try? JSONDecoder().decode(Started.self, from: data)
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) {
                UserDefaults.standard.set(data, forKey: Self.startedKey)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.startedKey)
            }
        }
    }

    /// The rest on screen as first seen, for a watch that does not say when it began.
    private var restSighting: LiveSession.RestSighting?
    private var cachedContext: (json: String, context: WatchContext?)?
    /// HealthKit's one-time permission to start from the background, and the
    /// mirrored session it came with: kept, as HealthKit asks, until the next
    /// one replaces it. Nothing else is done with it; only the watch's own
    /// session saves to Health.
    private var mirrorGrantedAt: Date?
    private var mirrored: HKWorkoutSession?
    /// ActivityKit calls run one after another, in the order things happened.
    private var chain: Task<Void, Never>?

    private init() {}

    /// Called once at launch, from the app delegate. The launch's own tidy
    /// up waits for `linkActivated`.
    func begin() {
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { _ in
            MainActor.assumeIsolated { LiveSessionActivities.shared.reconcile() }
        }
    }

    /// The watch link is up (`WatchLink.onActivated`), and the report that
    /// was waiting for this launch, if any, has been passed on first. Then
    /// the launch tidies up: one left from a session that ended while the
    /// app was not running goes now. Done before, it read the report saved
    /// on disk, stale after a long gap, and ended an activity the watch was
    /// still feeding a moment before its fresh report arrived.
    func linkActivated() {
        reconcile()
    }

    /// A newer state report from the watch. The app may be in the background.
    /// One this build cannot read changes nothing (`LiveSession.Heard`).
    func receive(json: String, receivedAt: Double) {
        guard case .report(let report) = LiveSession.heard(json) else {
            print("GymGo: a state report the Live Activity cannot read; left as it is")
            return
        }
        let at = Date(timeIntervalSince1970: receivedAt / 1000)
        run { await self.decide(report, receivedAt: at) }
    }

    /// At launch and on every return to the foreground: the moments a start is allowed.
    func reconcile() {
        let last = source.lastState()
        switch LiveSession.heard(last?.json) {
        case .unreadable:
            // Not "no report": that would end what is on screen.
            return
        case .nothing:
            run { await self.decide(nil, receivedAt: nil) }
        case .report(let report):
            let at = last.map { Date(timeIntervalSince1970: $0.receivedAt / 1000) }
            run { await self.decide(report, receivedAt: at) }
        }
    }

    /// The phone's Start, just before the watch is asked to open GymGo, with
    /// the context just sent. The app is in the foreground.
    func phoneStarting(context json: String?) {
        let context = self.context(json)
        run { await self.startForPhone(context) }
    }

    /// The watch could not be asked after all: what went up at the tap comes down.
    func phoneStartFailed(context json: String?) {
        guard let workoutId = LiveSession.phoneStart(context: context(json), now: Date())?.workoutId else { return }
        run {
            for activity in self.onScreen() where activity.attributes.workoutId == workoutId
                && activity.content.state.phase == .starting {
                await self.end(activity, report: nil)
            }
        }
    }

    /// From `HKHealthStore.workoutSessionMirroringStartHandler`, hopped to the
    /// main actor: a one-time permission to start from the background, used up
    /// by the next report (which may already be here, or follow within seconds).
    func mirroredSessionStarted(_ session: HKWorkoutSession) {
        mirrored = session
        mirrorGrantedAt = Date()
        reconcile()
    }

    // MARK: Deciding

    /// WWDC23 10023: HealthKit "gives my app 10 seconds to start a live activity".
    private static let mirrorGrant: TimeInterval = 10

    private var mayStart: Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
        if UIApplication.shared.applicationState == .active { return true }
        if let granted = mirrorGrantedAt, Date().timeIntervalSince(granted) < Self.mirrorGrant { return true }
        return false
    }

    /// Runs `work` after everything queued before it, holding a little
    /// background time: a wake from the watch may be short.
    private func run(_ work: @escaping @MainActor () async -> Void) {
        let time = BackgroundTime()
        let previous = chain
        chain = Task { @MainActor in
            // Decided only once the call before has finished, so two reports
            // in quick succession cannot both start one.
            await previous?.value
            await work()
            time.end()
        }
    }

    private func onScreen() -> [Live] {
        Live.activities.filter { [.active, .stale, .pending].contains($0.activityState) }
    }

    /// The one on screen, as the rule sees it.
    private func showing(_ activity: Live) -> LiveSession.Showing {
        let workoutId = activity.attributes.workoutId
        var waitingSince: Date?
        if activity.content.state.phase == .starting {
            waitingSince = started?.workoutId == workoutId ? started?.at : activity.attributes.startedAt
        }
        return LiveSession.Showing(workoutId: workoutId, waitingSince: waitingSince)
    }

    /// One at a time: anything more is left over from a crash.
    private func current() async -> Live? {
        let on = onScreen()
        for extra in on.dropFirst() { await end(extra, report: nil) }
        return on.first
    }

    private func decide(_ report: WatchStateReport?, receivedAt: Date?) async {
        let live = await current()
        let shown = live.map(showing)
        let declined = LiveSession.declined(
            startedFor: started?.workoutId, startedInstall: started?.install,
            currentInstall: Bundle.main.bundlePath, showing: shown
        )
        let step = LiveSession.step(
            report: report, receivedAt: receivedAt, now: Date(),
            showing: shown, mayStart: mayStart, declined: declined
        )
        switch step {
        case .nothing:
            return
        case .update:
            guard let live, let report, let receivedAt else { return }
            // timestamp: an update older than one already shown is ignored.
            await live.update(content(for: report, receivedAt: receivedAt), alertConfiguration: nil, timestamp: receivedAt)
        case .end:
            guard let live else { return }
            await end(live, report: report)
        case .start(let workoutId), .replace(let workoutId):
            if let live { await end(live, report: nil) }
            guard let report, let receivedAt else { return }
            let events = source.inbox().compactMap { try? JSONDecoder().decode(WatchEvent.self, from: Data($0.utf8)) }
            let facts = LiveSession.facts(workoutId: workoutId, context: context(), startEvents: events, firstSeen: receivedAt)
            request(workoutId, facts: facts, content: content(for: report, receivedAt: receivedAt))
        }
    }

    private func startForPhone(_ context: WatchContext?) async {
        guard let start = LiveSession.phoneStart(context: context, now: Date()) else { return }
        let live = await current()
        let step = LiveSession.stepForPhoneStart(workoutId: start.workoutId, showing: live.map(showing), mayStart: mayStart)
        switch step {
        case .start, .replace:
            if let live { await end(live, report: nil) }
            // The watch may have been quicker than the tap: then it says what it is doing.
            var content = ActivityContent(state: LiveSession.starting, staleDate: Date().addingTimeInterval(LiveSession.staleAfter))
            if let last = source.lastState(), case .report(let report) = LiveSession.heard(last.json),
               report.workoutId == start.workoutId, report.session == .running {
                content = self.content(for: report, receivedAt: Date(timeIntervalSince1970: last.receivedAt / 1000))
            }
            request(start.workoutId, facts: start.facts, content: content)
        case .nothing, .update, .end:
            return
        }
    }

    // MARK: Doing

    private func request(_ workoutId: String, facts: LiveSessionFacts, content: ActivityContent<LiveSessionContent>) {
        let attributes = GymGoSessionAttributes(workoutId: workoutId, title: facts.title, startedAt: facts.startedAt)
        do {
            // No push: every update comes from this app, woken by the watch.
            _ = try Live.request(attributes: attributes, content: content, pushType: nil)
            started = Started(workoutId: workoutId, at: Date(), install: Bundle.main.bundlePath)
            mirrorGrantedAt = nil
        } catch {
            // Off in Settings, too many running, or not in the foreground after all.
            print("GymGo: no Live Activity for the session: \(error)")
        }
    }

    private func end(_ activity: Live, report: WatchStateReport?) async {
        if started?.workoutId == activity.attributes.workoutId { started = nil }
        restSighting = nil
        let final = LiveSessionContent(phase: .ended)
        // A session that ended stays a minute as "Workout over"; anything else goes now.
        let ended = report?.session == .ended && report?.workoutId == activity.attributes.workoutId
        let policy: ActivityUIDismissalPolicy = ended ? .after(Date().addingTimeInterval(60)) : .immediate
        await activity.end(ActivityContent(state: final, staleDate: nil), dismissalPolicy: policy)
    }

    private func content(for report: WatchStateReport, receivedAt: Date) -> ActivityContent<LiveSessionContent> {
        // A build 6 watch does not say what is in hand: read it off the snapshot.
        var fallback: LiveSessionInHand?
        if report.inHand == nil, let workoutId = report.workoutId, let setId = report.setId,
           let snapshot = LiveSession.snapshot(for: workoutId, in: context()) {
            fallback = LiveSession.inHand(setId: setId, in: snapshot)
        }
        let rest = LiveSession.restStart(for: report, receivedAt: receivedAt, held: restSighting)
        restSighting = rest.held
        let state = LiveSession.content(for: report, inHandFallback: fallback, restFirstSeen: rest.start)
        // Past this with no newer report, the views say the watch is out of touch.
        return ActivityContent(state: state, staleDate: receivedAt.addingTimeInterval(LiveSession.staleAfter(report)))
    }

    private func context(_ json: String? = nil) -> WatchContext? {
        guard let json = json ?? source.lastContext() else { return nil }
        if let cached = cachedContext, cached.json == json { return cached.context }
        let context = try? WatchContext.decode(json)
        cachedContext = (json, context)
        return context
    }
}

/// A background task held while ActivityKit is called, ended once, either way.
@MainActor
private final class BackgroundTime {
    private var id: UIBackgroundTaskIdentifier = .invalid

    init() {
        id = UIApplication.shared.beginBackgroundTask(withName: "GymGo Live Activity") { [weak self] in
            MainActor.assumeIsolated { self?.end() }
        }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
