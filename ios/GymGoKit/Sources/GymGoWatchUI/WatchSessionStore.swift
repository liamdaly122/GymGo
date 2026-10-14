import Foundation
import GymGoKit
import Observation
#if os(watchOS)
import WatchKit
#endif

/// The watch app's state, and everything that happens because it changed.
///
/// `WatchAppState` (GymGoKit) decides; this does. It owns the state and saves
/// it after every change, including a rest under way, so a crash or a
/// relaunch keeps its place and its countdown. It hands events and state
/// reports to the link, starts and ends the HealthKit workout, plays the
/// haptics and times each rest's cues.
@MainActor
@Observable
public final class WatchSessionStore {
    public private(set) var state: WatchAppState
    public let workout: WorkoutController

    /// Hands an event to the phone. Wired by PhoneLink.
    @ObservationIgnored public var sendEvent: @MainActor (WatchEvent) -> Void = { _ in }
    /// Hands a state report, as JSON, to the phone. Wired by PhoneLink.
    @ObservationIgnored public var sendState: @MainActor (String) -> Void = { _ in }
    /// Called at the end of every save, whether or not a state file exists:
    /// the complications' publisher hangs off it. Wired by WatchApp.
    @ObservationIgnored public var onSaved: ((WatchAppState) -> Void)?

    /// Internal for the tests.
    @ObservationIgnored let haptics = Haptics()
    @ObservationIgnored private let fileURL: URL?
    @ObservationIgnored private var restTask: Task<Void, Never>?
    /// The rest-over cue once more, 8 s on. Internal for the tests.
    @ObservationIgnored var repeatTask: Task<Void, Never>?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored private var healthChain: Task<Void, Never>?
    @ObservationIgnored private var lastReported: (key: WatchAppState.ReportKey, health: WatchStateReport.Health)?
    @ObservationIgnored private var screenAwake = true
    @ObservationIgnored private var lastWoke = Date.distantPast
    @ObservationIgnored private var lastTouch = Date.distantPast
    @ObservationIgnored private var askedForHealth = false
    /// A workout whose Health workout would not start: not retried on every wake.
    @ObservationIgnored private var healthRetry = HealthRetry()
    /// The rest-over cue as a notification, for when nothing keeps the app running.
    @ObservationIgnored let restAlerts: RestAlerts
    /// Who played the last rest's rest-over cue. Internal for the tests.
    struct RestOverCue: Equatable {
        var restId: String
        var by: RestOverCuer
    }
    @ObservationIgnored private(set) var restOverCue: RestOverCue?

    public init(
        workout: WorkoutController = .shared, fileURL: URL? = WatchSessionStore.defaultFileURL,
        restAlerts: RestAlerts = RestAlerts()
    ) {
        self.workout = workout
        self.fileURL = fileURL
        self.restAlerts = restAlerts
        state = Self.load(from: fileURL)
        haptics.enabled = state.settings.vibrate
        workout.onFailure = { [weak self] failure in
            guard let self else { return }
            // A failure while Health is allowed is not retried on every wake:
            // this workout runs without it. Not asked yet is asked on the
            // next foreground, and then tried again.
            self.healthRetry.failed(
                self.state.session?.workoutId, authorized: self.workout.authorization == .authorized,
                notDetermined: failure == .notDetermined
            )
            if failure != .notDetermined { self.haptics.play(.failed) }
            self.syncRestAlert()
            self.keepReporting()
            self.reportIfChanged()
        }
        restAlerts.onPresented = { [weak self] restId in self?.restRanOut(id: restId) ?? true }
        restAlerts.activate()
        // A launch in the background (a rest restored from disk) must know
        // whether its notification sounds before the rest runs out, or the
        // cue goes to a haptic that may not reach the wrist.
        Task { await self.restAlerts.refreshPermission() }
        retireLegacyFile()
        if state.expireRest(now: Date()) { save() }
        scheduleRest()
        keepReporting()
    }

    public nonisolated static var defaultFileURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("watch-state.json")
    }

    /// What was dialled in for the set in hand, so the numbers survive the
    /// set screen going away behind the rest and coming back.
    public struct SetDraft: Equatable, Sendable {
        public var setId: String
        public var weightIndex: Double
        public var reps: Double
        public var onReps: Bool
    }

    @ObservationIgnored public var draft: SetDraft?

    // MARK: - What the screens read

    public var session: WatchSession? { state.session }
    public var setInHand: SetInHand? { state.setInHand }
    public var rest: RestState? { state.rest }
    public var todayCard: TodayCard { state.todayCard(now: Date()) }

    // MARK: - From the phone

    /// The phone's context, as JSON under "context".
    public func receive(_ context: WatchContext) {
        let change = state.apply(context)
        guard change.applied else { return }
        haptics.enabled = state.settings.vibrate

        if let ended = change.ended {
            haptics.play(.endedOnPhone)
            stopRestCues()
            if ended.how == .finished {
                captureMetricsInSummary()
                endHealthWorkout()
            } else {
                health { await self.workout.discard() }
            }
        }
        if let adopted = change.adopted {
            if change.replaced != nil { stopRestCues() }
            if change.replaced == nil, change.ended == nil { haptics.play(.workoutStarted) }
            health {
                // One left over from a workout already over is ended, never
                // relabelled; one untagged is this session's.
                await self.settleHealthRecording()
                if self.workout.isRunning {
                    await self.workout.tag(adopted)
                } else if self.isForeground {
                    await self.startHealth(for: adopted)
                }
            }
        }
        if change.claimed { stopRestCues() }
        // A Health workout recording with nothing behind it any more: the
        // phone ended the workout it was opened for before this watch adopted it.
        health { await self.settleHealthRecording() }
        scheduleRest()
        save()
        keepReporting()
        reportIfChanged()
    }

    /// The phone has applied these events.
    public func acknowledge(_ ids: Set<String>) {
        state.acknowledge(ids)
        save()
    }

    /// Every event not yet confirmed, to send again after a reconnection.
    public func unconfirmedEvents() -> [WatchEvent] {
        state.prune(now: Date())
        return state.unconfirmed
    }

    // MARK: - From the wrist

    /// Start on the Today page.
    public func startToday() {
        guard state.todayCard(now: Date()).canStart, let ready = state.home?.ready,
              let event = state.start(ready, at: Date()) else { return }
        sendEvent(event)
        haptics.play(.workoutStarted)
        save()
        keepReporting()
        reportIfChanged()
        // The session's own ID: a start again after a Discard here runs under new ones.
        let workoutId = event.workoutId
        health { await self.startHealth(for: workoutId) }
    }

    /// Done: logs the set in hand with these numbers and starts whatever rest follows.
    public func done(weight: Double, reps: Int) {
        touched()
        guard let result = state.logSet(weight: weight, reps: reps, at: Date()) else { return }
        sendEvent(result.outcome.event)
        repeatTask?.cancel()
        haptics.play(result.cue)
        scheduleRest()
        save()
        reportIfChanged()
    }

    public func skipRest() {
        touched()
        guard let event = state.skipRest(at: Date()) else { return }
        sendEvent(event)
        scheduleRest()
        haptics.play(.restAdjusted)
        save()
        reportIfChanged()
    }

    /// +30 s.
    public func addRest(_ seconds: Int = 30) {
        touched()
        guard state.adjustRest(by: seconds, now: Date()) != nil else { return }
        haptics.play(.restAdjusted)
        scheduleRest()
        save()
        reportIfChanged()
    }

    /// Finish and save, after the screen has asked.
    public func finish() {
        touched()
        guard let event = state.finish(at: Date()) else { return }
        sendEvent(event)
        stopRestCues()
        scheduleRest()
        captureMetricsInSummary()
        save()
        keepReporting()
        reportIfChanged()
        endHealthWorkout()
    }

    /// Discard, before the first set, after the screen has asked.
    public func discard() {
        touched()
        guard let event = state.discard(at: Date()) else { return }
        sendEvent(event)
        stopRestCues()
        scheduleRest()
        save()
        keepReporting()
        reportIfChanged()
        health { await self.workout.discard() }
    }

    /// "Log here instead".
    public func reclaim() {
        touched()
        guard state.reclaim() else { return }
        save()
        reportIfChanged()
    }

    public func closeSummary() {
        state.closeSummary()
        save()
    }

    /// The Health workout runs with no GymGo session behind it (the phone
    /// opened the app, and no workout followed): end it, not saved. A
    /// workout that ended as a finish is saved without asking
    /// (`settleHealthRecording`); what is left here has nothing to save.
    public func endStrayRecording() {
        health { await self.workout.discard() }
    }

    // MARK: - The app and the screen

    /// Any touch: the rest-over cue does not need repeating.
    public func touched() {
        lastTouch = Date()
    }

    /// The screen is on and showing the app (raised, not dimmed), or not.
    public func screenChanged(awake: Bool) {
        if awake && !screenAwake { lastWoke = Date() }
        screenAwake = awake
    }

    /// Whether the app is in the foreground: the only time, apart from
    /// `handle(_ workoutConfiguration:)`, it may start a Health workout.
    var isForeground: Bool { appIsActive() }

    /// `WKApplicationState.active`, read on the main actor. Wrist down with
    /// the app still frontmost is `.inactive`, not this. The tests, where
    /// WatchKit is compiled out, set it.
    @ObservationIgnored var appIsActive: @MainActor () -> Bool = {
        #if os(watchOS)
        WKApplication.shared().applicationState == .active
        #else
        true
        #endif
    }

    /// The app came to the foreground: ask for Health once, and start the
    /// Health workout for a session adopted while the app could not.
    public func appBecameActive() {
        screenChanged(awake: true)
        if state.expireRest(now: Date()) {
            save()
            reportIfChanged()
        }
        syncRestAlert()
        restAlerts.clearDelivered()
        // Settings can turn the notification, or its sound, off at any time.
        // Read now, not behind Health's questions, which may wait on the lifter.
        Task { await self.restAlerts.refreshPermission() }
        health {
            // Health can be turned on or off in Settings at any time.
            self.workout.refreshAuthorization()
            if !self.askedForHealth, await self.workout.needsAuthorization() {
                self.askedForHealth = true
                if await self.workout.authorize() { self.healthRetry.granted() }
            }
            // `start` reads the authorisation afresh: refused or unavailable
            // returns at once, and a grant since the last wake starts it.
            if let session = self.state.session, !self.workout.isRunning, self.healthRetry.mayStart(session.workoutId) {
                await self.startHealth(for: session.workoutId)
            }
            await self.settleSavingSummary()
            await self.restAlerts.requestPermissionOnce()
            await self.restAlerts.refreshPermission()
        }
        reportIfChanged()
    }

    /// The phone started a workout and opened the app for it
    /// (`startWatchApp`). Start the Health workout now, the one moment the
    /// app may do so from the background; the context names the workout.
    public func phoneStartedWorkout() {
        health {
            await self.settleHealthRecording()
            let ok = await self.workout.start(workoutId: self.state.session?.workoutId)
            // Expected while Health has not been asked yet: the next foreground asks.
            if !ok, self.workout.authorization == .authorized { self.haptics.play(.failed) }
        }
    }

    /// watchOS relaunched the app mid-workout.
    public func recoverWorkout() {
        health {
            await self.workout.recover()
            // Tagged for the running session, or ended if the GymGo workout
            // it recorded is over: a crash mid-finish leaves one behind.
            await self.settleHealthRecording()
        }
    }

    // MARK: - Health

    /// Runs Health work one piece at a time, in order, so a finish and the
    /// next start cannot interleave.
    private func health(_ operation: @escaping @MainActor () async -> Void) {
        let previous = healthChain
        healthChain = Task { @MainActor in
            await previous?.value
            await operation()
            self.syncRestAlert()
            self.keepReporting()
            self.reportIfChanged()
        }
    }

    private func startHealth(for workoutId: String) async {
        if !askedForHealth, await workout.needsAuthorization() {
            askedForHealth = true
            if await workout.authorize() { healthRetry.granted() }
        }
        // A Health workout left over from a workout already over is ended
        // first, so it is never relabelled as this one.
        await settleHealthRecording()
        let ok = await workout.start(workoutId: workoutId)
        // Failing while Health is allowed is not retried on every wake. Not
        // asked yet, refused or unavailable is read afresh next time.
        if !ok, workout.authorization == .authorized {
            healthRetry.failed(workoutId, authorized: true)
            haptics.play(.failed)
        }
    }

    /// The Health workout recording now, set straight: tagged with the
    /// running session, or ended when the GymGo workout it recorded is over
    /// (`WatchAppState.healthRecordingAction`).
    private func settleHealthRecording() async {
        guard workout.isRunning else { return }
        switch state.healthRecordingAction(taggedWith: workout.workoutId, startedAt: workout.startDate, now: Date()) {
        case .keep:
            break
        case .tag(let workoutId):
            await workout.tag(workoutId)
        case .finish(let tag):
            if let tag { await workout.tag(tag) }
            await saveHealthWorkout()
        case .discard:
            await workout.discard()
        }
    }

    /// A summary still "Saving to Health…" with nothing saving it now: the
    /// app was relaunched mid-save and no workout session came back. Health
    /// says whether the save landed.
    private func settleSavingSummary() async {
        guard let summary = state.summary, summary.health == .saving, !workout.isRunning else { return }
        let saved = await workout.isSaved(summary.workoutId)
        guard state.summary?.workoutId == summary.workoutId, state.summary?.health == .saving else { return }
        state.updateSummary { $0.health = saved == true ? .saved : .notSaved }
        save()
    }

    private func captureMetricsInSummary() {
        let average = workout.averageHeartRate, kcal = workout.activeKcal
        let recording = workout.isRunning
        state.updateSummary {
            $0.averageHeartRate = average
            $0.activeKcal = kcal
            $0.health = recording ? .saving : .off
        }
    }

    private func endHealthWorkout() {
        health { await self.saveHealthWorkout() }
    }

    /// Ends the Health workout, saved, and says so on the summary of the
    /// workout it recorded.
    private func saveHealthWorkout() async {
        guard workout.isRunning else { return }
        let summaryFor = state.summary?.workoutId
        let tagged = workout.workoutId
        var saved = await workout.finish()
        // A save begun before a relaunch may have landed already.
        if !saved, let tagged, await workout.isSaved(tagged) == true { saved = true }
        if let summaryFor, state.summary?.workoutId == summaryFor, tagged == nil || tagged == summaryFor {
            let average = workout.averageHeartRate, kcal = workout.activeKcal
            state.updateSummary {
                $0.health = saved ? .saved : .notSaved
                if let average { $0.averageHeartRate = average }
                if let kcal { $0.activeKcal = kcal }
            }
            save()
        }
        haptics.play(saved ? .savedToHealth : .failed)
    }

    // MARK: - The rest's cues

    /// Times the cues for the rest under way: 10 s left, 3-2-1, the end.
    /// Rescheduled whenever the rest changes.
    private func scheduleRest() {
        restTask?.cancel()
        syncRestAlert()
        guard let rest = state.rest else { return }
        let cues = restCues(endsAt: rest.endsAt, seconds: rest.seconds, now: Date())
        let id = rest.id
        restTask = Task { @MainActor [weak self] in
            for (at, cue) in cues {
                let wait = at.timeIntervalSinceNow
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                guard !Task.isCancelled, let self else { return }
                if cue == .restOver {
                    self.restRanOut(id: id)
                } else {
                    self.haptics.play(cue)
                }
            }
        }
    }

    /// The rest-over notification follows the rest and Health: wanted while
    /// a rest runs and no Health workout keeps the app running.
    private func syncRestAlert() {
        restAlerts.sync(RestAlert.wanted(
            for: state.rest, healthRecording: workout.isRunning, vibrate: state.settings.vibrate, now: Date()
        ))
    }

    /// The rest's cues, and the rest-over repeat, stop: the session they
    /// belonged to ended, was replaced, or went to the phone.
    private func stopRestCues() {
        restTask?.cancel()
        repeatTask?.cancel()
    }

    /// The rest is over: the strong cue, and once more 8 s later unless the
    /// screen was woken or touched in between, another rest began, or the
    /// session it belonged to is over. From the rest's own timer, or from its
    /// notification while the app is in front, active or not: whichever comes
    /// first decides who plays the cue, the app or the notification
    /// (`RestAlert.cuer`), and the other stays quiet. Returns whether the
    /// notification, arriving now, plays the system's sound and haptic.
    @discardableResult
    func restRanOut(id: String) -> Bool {
        guard state.restRanOut(id: id) else {
            // Over already: the notification sounds if it was handed the cue.
            return restOverCue == RestOverCue(restId: id, by: .system)
        }
        let by = RestAlert.cuer(appActive: isForeground, notificationSounds: restAlerts.sounds(for: id))
        restOverCue = RestOverCue(restId: id, by: by)
        if by == .app {
            haptics.play(.restOver)
            // The notification goes, or arrives silent.
            syncRestAlert()
        }
        // `.system`: the notification stays, and plays it on the wrist.
        let endedAt = Date()
        let awakeAtEnd = screenAwake
        let restSession = state.session?.workoutId
        repeatTask?.cancel()
        repeatTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(restOverRepeatSeconds))
            guard !Task.isCancelled, let self else { return }
            let noticed = awakeAtEnd || self.lastWoke > endedAt || self.lastTouch > endedAt
            if restOverPlaysAgain(
                noticed: noticed, restRunning: self.state.rest != nil,
                restSession: restSession, runningSession: self.state.session?.workoutId
            ) {
                self.haptics.play(.restOver)
            }
        }
        save()
        reportIfChanged()
        return by == .system
    }

    // MARK: - State reports

    /// A report whenever what it says changes.
    private func reportIfChanged() {
        let key = state.reportKey, health = workout.health
        if let last = lastReported, last.key == key, last.health == health { return }
        report()
    }

    private func report() {
        let report = state.report(at: Date(), heartRate: workout.heartRate, activeKcal: workout.activeKcal, health: workout.health)
        lastReported = (state.reportKey, workout.health)
        save()
        if let json = try? report.json() { sendState(json) }
    }

    /// Every 30 s while a session or a Health workout runs, so the phone
    /// knows the watch is still there. A Health workout with no session is
    /// looked at again each time: the context that would end it may have
    /// left the phone before it began (`strayRecordingWait`).
    private func keepReporting() {
        let needed = state.session != nil || workout.isRunning
        if !needed {
            heartbeat?.cancel()
            heartbeat = nil
            return
        }
        guard heartbeat == nil else { return }
        heartbeat = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, let self else { return }
                if self.state.session == nil && !self.workout.isRunning {
                    self.heartbeat = nil
                    return
                }
                self.report()
                if self.state.session == nil {
                    self.health { await self.settleHealthRecording() }
                }
            }
        }
    }

    /// For a reconnection: the newest report again.
    public func reportNow() {
        report()
    }

    // MARK: - Disk

    private static func load(from fileURL: URL?) -> WatchAppState {
        guard let fileURL else { return WatchAppState() }
        // Build 4 saved only the session, beside where the state now goes.
        // Its session is not brought back as running: see
        // `WatchAppState.init(upgradingFrom:)`.
        let old = legacyFileURL(beside: fileURL)
        return WatchAppState.restore(saved: try? Data(contentsOf: fileURL), build4Session: try? Data(contentsOf: old))
    }

    private nonisolated static func legacyFileURL(beside fileURL: URL) -> URL {
        fileURL.deletingLastPathComponent().appendingPathComponent("session.json")
    }

    /// Build 4's file goes once what came from it is saved in the new one.
    private func retireLegacyFile() {
        guard let fileURL else { return }
        let old = Self.legacyFileURL(beside: fileURL)
        guard FileManager.default.fileExists(atPath: old.path) else { return }
        save()
        try? FileManager.default.removeItem(at: old)
    }

    private func save() {
        defer { onSaved?(state) }
        guard let fileURL else { return }
        do {
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(state).write(to: fileURL, options: .atomic)
        } catch {
            print("GymGo watch: could not save the state: \(error)")
        }
    }
}
