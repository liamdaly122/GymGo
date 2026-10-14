import Foundation
import GymGoKit
import Observation
import os
#if os(watchOS)
import HealthKit
#endif

private let log = Logger(subsystem: "com.liamdaly.gymgo.watchkitapp", category: "Health")

/// The watch's HealthKit workout: one `HKWorkoutSession`
/// (traditionalStrengthTraining, indoor) with its live builder per GymGo
/// workout. It is what keeps the app on the wrist when the arm drops, lets
/// the haptics play wrist-down, reads the heart rate and active energy, and
/// saves the workout to Health and Fitness so it counts towards the rings.
///
/// One instance for the app (`shared`), because watchOS can hand the app a
/// workout to start or recover before any screen exists. HealthKit calls the
/// delegates on its own queues: every delegate method is `nonisolated`, copies
/// what it needs, and hops to the main actor.
///
/// Nothing here may take the app down. If HealthKit is unavailable (the
/// simulator, an older watch), refused, or fails, the session on the wrist
/// carries on without it, and `health` says why.
///
/// A pause is HealthKit's own state, read from the `HKWorkoutSession` (and
/// again on recovery), never a copy kept in `WatchAppState`: a crash cannot
/// leave a second copy stale. The rules for it are pure, in GymGoKit's
/// `Pause.swift`.
@MainActor
@Observable
public final class WorkoutController: NSObject {
    public static let shared = WorkoutController()

    public enum Authorization: Sendable, Equatable { case unknown, authorized, denied, unavailable }
    /// Why a workout session failed, as far as trying again goes.
    public enum Failure: Sendable, Equatable {
        /// Health has not been asked yet: the next foreground asks.
        case notDetermined
        case denied
        /// Another workout app took over, watchOS ended it, or HealthKit refused.
        case other
    }

    /// A HealthKit workout session is running (started, recovered, not yet ended).
    public private(set) var isRunning = false
    /// The GymGo workout the Health workout is tagged with.
    public private(set) var workoutId: String?
    public private(set) var startDate: Date?
    /// Beats per minute, most recent.
    public private(set) var heartRate: Double?
    public private(set) var averageHeartRate: Double?
    /// Active energy since the workout began.
    public private(set) var activeKcal: Double?
    public private(set) var authorization: Authorization = .unknown
    public private(set) var lastError: String?
    /// The Health recording is paused (`HKWorkoutSessionState.paused`). The
    /// session still runs, so `health` stays `recording` and the app keeps
    /// its place on the wrist.
    public private(set) var isPaused = false
    /// When the pause began, on the watch's clock; nil while recording.
    public private(set) var pausedAt: Date?
    /// Health's active time, every pause left out: what the metrics clock
    /// shows, and what Health saves as the workout's duration.
    public private(set) var activeTime: ActiveTime?

    /// Called when a session the app did not end fails or ends.
    @ObservationIgnored public var onFailure: (@MainActor (Failure) -> Void)?
    /// Called once each time a Health session starts recording: when its
    /// collection has begun in `start`, and when `recover` has taken one
    /// back. Never on adoption alone. The watch target donates the Action
    /// button's next action from here, so every start gets one, however it
    /// began: Start on the wrist, the phone, the Action button, a recovery.
    @ObservationIgnored public var onRecordingStarted: (@MainActor () -> Void)?
    /// Called when the Health session pauses or resumes, however that came
    /// about: an intent, a button, both of the watch's buttons, a recovery.
    @ObservationIgnored public var onPauseChanged: (@MainActor () -> Void)?
    /// When a pause or resume was last asked for directly. A
    /// `pauseOrResumeRequest` soon after is its echo (`PauseRequest`).
    @ObservationIgnored private var lastAsked: Date?
    /// Until when no Health permission sheet may show (`holdHealthPrompts`).
    @ObservationIgnored private var promptsHeldUntil: Date?

    /// What the state report says about the Health workout.
    public var health: WatchStateReport.Health {
        if isRunning { return .recording }
        switch authorization {
        case .unavailable: return .unavailable
        case .denied: return .denied
        default: return .off
        }
    }

    #if os(watchOS)
    @ObservationIgnored let healthStore = HKHealthStore()
    @ObservationIgnored private var session: HKWorkoutSession?
    @ObservationIgnored private var builder: HKLiveWorkoutBuilder?
    @ObservationIgnored private var discardOnStop = false
    @ObservationIgnored private var ending = false
    @ObservationIgnored private var closed = false
    @ObservationIgnored private var waiters: [CheckedContinuation<Bool, Never>] = []
    /// Closes the session being ended if `.stopped` never arrives. Tied to
    /// that session: it can never close a later one.
    @ObservationIgnored private var fallback: Task<Void, Never>?

    static let share: Set<HKSampleType> = [
        HKObjectType.workoutType(),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.heartRate),
    ]
    static let read: Set<HKObjectType> = [
        HKObjectType.workoutType(),
        HKQuantityType(.heartRate),
        HKQuantityType(.activeEnergyBurned),
        HKQuantityType(.bodyMass),
        HKObjectType.activitySummaryType(),
    ]
    #endif

    override public init() {
        super.init()
    }

    // MARK: - Authorisation

    /// Asks once, in the foreground, before the first start. Returns whether
    /// the app may save workouts.
    @discardableResult
    public func authorize() async -> Bool {
        if promptsHeld {
            refreshAuthorization()
            return authorization == .authorized
        }
        #if os(watchOS)
        guard HKHealthStore.isHealthDataAvailable() else {
            authorization = .unavailable
            return false
        }
        do {
            if try await healthStore.statusForAuthorizationRequest(toShare: Self.share, read: Self.read) == .shouldRequest {
                try await healthStore.requestAuthorization(toShare: Self.share, read: Self.read)
            }
        } catch {
            lastError = String(describing: error)
        }
        refreshAuthorization()
        return authorization == .authorized
        #else
        authorization = .unavailable
        return false
        #endif
    }

    /// Whether asking would show a prompt: the app has not asked yet. Never
    /// while prompts are held: there is nothing to ask then.
    public func needsAuthorization() async -> Bool {
        if promptsHeld { return false }
        #if os(watchOS)
        guard HKHealthStore.isHealthDataAvailable() else { return false }
        let status = try? await healthStore.statusForAuthorizationRequest(toShare: Self.share, read: Self.read)
        return status == .shouldRequest
        #else
        return false
        #endif
    }

    /// The Action button's start must never ask for Health (it has 30
    /// seconds to start a workout, and a sheet waits on the lifter): no
    /// prompt shows for `seconds`. `needsAuthorization` says no, and
    /// `authorize` only reads, so the next foreground after that asks.
    public func holdHealthPrompts(for seconds: TimeInterval) {
        promptsHeldUntil = Date().addingTimeInterval(seconds)
    }

    /// Internal for the tests.
    var promptsHeld: Bool { (promptsHeldUntil ?? .distantPast) > Date() }

    /// Reads the authorisation afresh: Health can be turned on or off for
    /// GymGo in Settings at any time.
    public func refreshAuthorization() {
        #if os(watchOS)
        guard HKHealthStore.isHealthDataAvailable() else {
            authorization = .unavailable
            return
        }
        switch healthStore.authorizationStatus(for: HKObjectType.workoutType()) {
        case .sharingAuthorized: authorization = .authorized
        case .sharingDenied: authorization = .denied
        default: authorization = .unknown
        }
        #else
        authorization = .unavailable
        #endif
    }

    // MARK: - Lifecycle

    /// Starts the Health workout, tagged with the GymGo workout when known.
    /// From the foreground, or from `handle(_ workoutConfiguration:)`: anywhere
    /// else watchOS refuses it. Already running: just tags it. Returns false
    /// when no workout session could be started.
    @discardableResult
    public func start(workoutId: String?) async -> Bool {
        #if os(watchOS)
        if session != nil {
            if let workoutId { await tag(workoutId) }
            return true
        }
        refreshAuthorization()
        guard authorization != .unavailable, authorization != .denied else { return false }

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .traditionalStrengthTraining
        configuration.locationType = .indoor
        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: configuration)
            session.delegate = self
            builder.delegate = self
            adopt(session, builder)
            let start = Date()
            startDate = start
            session.startActivity(with: start)
            // Bounded: a collection that never begins must not hold up a finish.
            let began = await withTimeout(10, otherwise: true) {
                do { try await builder.beginCollection(at: start); return true } catch { return false }
            }
            guard began else { throw HKError(.errorInvalidArgument) }
            readActiveTime()
            mirrorToPhone(session)
            onRecordingStarted?()
            if let workoutId { await tag(workoutId) }
            return true
        } catch {
            lastError = String(describing: error)
            // Not determined is not refused: the next foreground asks.
            if (error as? HKError)?.code == .errorAuthorizationDenied {
                authorization = .denied
            }
            if let session { session.end() }
            teardown()
            return false
        }
        #else
        authorization = .unavailable
        return false
        #endif
    }

    /// Tags the Health workout with the GymGo workout, so the phone can find
    /// it and never saves a second copy.
    public func tag(_ workoutId: String) async {
        #if os(watchOS)
        guard let builder, self.workoutId != workoutId else { return }
        self.workoutId = workoutId
        let tagged = await withTimeout(5, otherwise: false) {
            do {
                try await builder.addMetadata([
                    HKMetadataKeyExternalUUID: workoutId,
                    HKMetadataKeySyncIdentifier: "gymgo.workout.\(workoutId)",
                    HKMetadataKeySyncVersion: 1,
                ])
                return true
            } catch {
                return false
            }
        }
        if !tagged { lastError = "Could not tag the Health workout with \(workoutId)" }
        #endif
    }

    /// Ends the Health workout and saves it to Health and Fitness. True when
    /// it was saved. False straight away when nothing was recording.
    public func finish() async -> Bool {
        await end(discarding: false)
    }

    /// Ends the Health workout and throws it away. Samples already written
    /// stay in Health: HealthKit does not delete them.
    public func discard() async {
        _ = await end(discarding: true)
    }

    /// After a crash mid-workout watchOS relaunches the app; this takes the
    /// running session back, with its delegates and data source set again.
    public func recover() async {
        #if os(watchOS)
        guard session == nil else { return }
        let store = healthStore
        let found = await withTimeout(10, otherwise: nil as HKWorkoutSession?) {
            try? await store.recoverActiveWorkoutSession()
        }
        guard let recovered = found, session == nil else { return }
        let builder = recovered.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: recovered.workoutConfiguration)
        recovered.delegate = self
        builder.delegate = self
        adopt(recovered, builder)
        startDate = builder.startDate ?? recovered.startDate
        workoutId = builder.metadata[HKMetadataKeyExternalUUID] as? String
        readActiveTime()
        // Paused before the crash: HealthKit kept it paused, and says since when.
        if recovered.state == .paused {
            let since = builder.workoutEvents.last { $0.type == .pause }?.dateInterval.start ?? Date()
            pauseChanged(paused: true, at: since)
        }
        onRecordingStarted?()
        #endif
    }

    // MARK: - Pause and resume

    /// Pauses the Health recording: the pause intent (the Action and side
    /// buttons), or a Pause button. Only a running session pauses. `isPaused`
    /// follows when HealthKit reports the new state, not before.
    public func pause() {
        lastAsked = Date()
        #if os(watchOS)
        guard let session, session.state == .running else { return }
        session.pause()
        #endif
    }

    /// Resumes a paused Health recording: the resume intent, a Resume
    /// button, or a set logged while paused.
    public func resume() {
        lastAsked = Date()
        #if os(watchOS)
        guard let session, session.state == .paused else { return }
        session.resume()
        #endif
    }

    /// What HealthKit's `pauseOrResumeRequest` does now: a toggle on the
    /// session's state, or nothing within 2 s of a pause or resume asked for
    /// directly. Internal for the tests.
    func answerRequest(_ phase: HealthSessionPhase, now: Date) -> PauseRequest.Answer? {
        PauseRequest.answer(phase, lastAsked: lastAsked, now: now)
    }

    /// The session paused or resumed, as HealthKit reports it or recovery
    /// finds it. Internal for the tests, which have no HealthKit.
    func pauseChanged(paused: Bool, at date: Date) {
        guard isPaused != paused else { return }
        isPaused = paused
        pausedAt = paused ? date : nil
        onPauseChanged?()
    }

    /// Whether Health holds a saved workout for this GymGo workout, found by
    /// its sync identifier. Nil when it cannot tell.
    public func isSaved(_ workoutId: String) async -> Bool? {
        #if os(watchOS)
        guard HKHealthStore.isHealthDataAvailable() else { return nil }
        let store = healthStore
        return await withTimeout(5, otherwise: nil as Bool?) {
            await withCheckedContinuation { continuation in
                let predicate = HKQuery.predicateForObjects(
                    withMetadataKey: HKMetadataKeySyncIdentifier, allowedValues: ["gymgo.workout.\(workoutId)"]
                )
                let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: 1, sortDescriptors: nil) { _, samples, error in
                    continuation.resume(returning: error == nil ? !(samples ?? []).isEmpty : nil)
                }
                store.execute(query)
            }
        }
        #else
        return nil
        #endif
    }

    // MARK: - Internals

    #if os(watchOS)
    private func adopt(_ session: HKWorkoutSession, _ builder: HKLiveWorkoutBuilder) {
        fallback?.cancel()
        fallback = nil
        self.session = session
        self.builder = builder
        isRunning = true
        ending = false
        closed = false
        discardOnStop = false
        workoutId = nil
        heartRate = nil
        averageHeartRate = nil
        activeKcal = nil
        isPaused = false
        pausedAt = nil
        activeTime = nil
        lastAsked = nil
    }

    /// Health's active time, read now from the builder.
    private func readActiveTime() {
        guard let session, let builder else {
            activeTime = nil
            return
        }
        let now = Date()
        activeTime = ActiveTime(seconds: builder.elapsedTime(at: now), at: now, running: session.state == .running)
    }

    /// Mirrors the session to the iPhone, which launches GymGo there in the
    /// background with leave to start its Live Activity. The watch's session
    /// stays the only one that saves to Health. A failure is logged and goes
    /// no further: it must never touch the workout.
    private func mirrorToPhone(_ session: HKWorkoutSession) {
        Task {
            do {
                try await session.startMirroringToCompanionDevice()
            } catch {
                log.error("Mirroring to the iPhone failed: \(String(describing: error), privacy: .public)")
            }
        }
    }

    private func end(discarding: Bool) async -> Bool {
        guard let session else { return false }
        discardOnStop = discarding
        return await withCheckedContinuation { continuation in
            waiters.append(continuation)
            guard !ending else { return }
            ending = true
            switch session.state {
            case .running, .paused:
                session.stopActivity(with: Date())
                // If `.stopped` never arrives, close anyway: this session,
                // and never one started after it.
                fallback?.cancel()
                fallback = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(8))
                    guard !Task.isCancelled, let self, self.session === session else { return }
                    await self.close(session, at: Date())
                }
            default:
                Task { await self.close(session, at: Date()) }
            }
        }
    }

    /// Runs once the session has stopped: end the collection, save or
    /// discard, end the session. Only for the session it is given, while it
    /// is still the one here.
    private func close(_ target: HKWorkoutSession, at date: Date) async {
        guard !closed, let session, session === target, let builder else { return }
        closed = true
        var saved = false
        // Each step bounded, so a HealthKit call that never answers cannot
        // keep the next workout from starting.
        let collected = await withTimeout(10, otherwise: false) {
            do { try await builder.endCollection(at: date); return true } catch { return false }
        }
        if !collected { lastError = "The Health workout's collection did not end" }
        if discardOnStop {
            builder.discardWorkout()
        } else {
            // A nil workout with no error is a save while the watch is locked.
            saved = await withTimeout(15, otherwise: false) {
                do { _ = try await builder.finishWorkout(); return true } catch { return false }
            }
            if !saved { lastError = "The Health workout was not saved" }
        }
        session.end()
        // Ended meanwhile (`.ended` already tore it down and answered), or
        // another session is here now: neither is this close's to touch.
        guard self.session === target else { return }
        teardown()
        resolve(saved)
    }

    private func resolve(_ saved: Bool) {
        let pending = waiters
        waiters = []
        for waiter in pending { waiter.resume(returning: saved) }
    }

    private func teardown() {
        fallback?.cancel()
        fallback = nil
        session = nil
        builder = nil
        isRunning = false
        ending = false
        isPaused = false
        pausedAt = nil
        activeTime = nil
    }

    fileprivate func sessionChanged(_ changed: HKWorkoutSession, to state: HKWorkoutSessionState, at date: Date) async {
        guard changed === session else { return }
        switch state {
        case .stopped:
            await close(changed, at: date)
        case .ended:
            // Ended without Finish or Discard here: another workout app took
            // over, or watchOS ended it. What it collected is not saved.
            let unexpected = !ending
            teardown()
            resolve(false)
            if unexpected { onFailure?(.other) }
        case .paused, .running:
            readActiveTime()
            pauseChanged(paused: state == .paused, at: date)
        default:
            break
        }
    }

    /// Both of the watch's buttons together.
    fileprivate func requestedPauseOrResume(on source: HKWorkoutSession) {
        guard source === session else { return }
        let phase: HealthSessionPhase = switch source.state {
        case .running: .running
        case .paused: .paused
        default: .other
        }
        switch answerRequest(phase, now: Date()) {
        case .pause: source.pause()
        case .resume: source.resume()
        case nil: break
        }
    }

    /// The builder took in an event: a pause or a resume moves its elapsed time.
    fileprivate func collectedEvent(from source: HKLiveWorkoutBuilder) {
        guard source === builder else { return }
        readActiveTime()
    }

    fileprivate func sessionFailed(_ failed: HKWorkoutSession, _ message: String, code: Int?) {
        guard failed === session else { return }
        lastError = message
        if code == HKError.Code.errorAuthorizationDenied.rawValue {
            authorization = .denied
        }
        // A session that never got going is not recording, whatever it was asked.
        if failed.state == .notStarted || failed.state == .prepared || failed.state == .ended {
            if failed.state != .ended { failed.end() }
            teardown()
            resolve(false)
        }
        let failure: Failure = switch code {
        case HKError.Code.errorAuthorizationNotDetermined.rawValue: .notDetermined
        case HKError.Code.errorAuthorizationDenied.rawValue: .denied
        default: .other
        }
        onFailure?(failure)
    }

    fileprivate func collected(from source: HKLiveWorkoutBuilder, heartRate: Double?, average: Double?, kcal: Double?) {
        guard source === builder else { return }
        if let heartRate { self.heartRate = heartRate }
        if let average { averageHeartRate = average }
        if let kcal { activeKcal = kcal }
    }
    #else
    private func end(discarding: Bool) async -> Bool { false }
    #endif
}

#if os(watchOS)
extension WorkoutController: HKWorkoutSessionDelegate {
    nonisolated public func workoutSession(
        _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState, date: Date
    ) {
        Task { @MainActor in await self.sessionChanged(workoutSession, to: toState, at: date) }
    }

    nonisolated public func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: any Error) {
        let message = String(describing: error)
        let code = (error as? HKError)?.code.rawValue ?? ((error as NSError).domain == HKErrorDomain ? (error as NSError).code : nil)
        Task { @MainActor in self.sessionFailed(workoutSession, message, code: code) }
    }

    /// The builder records pauses and resumes by itself
    /// (`shouldCollectWorkoutEvents`); only the lifter's request to pause or
    /// resume, from both of the watch's buttons, is acted on here.
    nonisolated public func workoutSession(_ workoutSession: HKWorkoutSession, didGenerate event: HKWorkoutEvent) {
        guard event.type == .pauseOrResumeRequest else { return }
        Task { @MainActor in self.requestedPauseOrResume(on: workoutSession) }
    }
}

extension WorkoutController: HKLiveWorkoutBuilderDelegate {
    nonisolated public func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let heart = workoutBuilder.statistics(for: HKQuantityType(.heartRate))
        let heartRate = heart?.mostRecentQuantity()?.doubleValue(for: bpm)
        let average = heart?.averageQuantity()?.doubleValue(for: bpm)
        let kcal = workoutBuilder.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie())
        Task { @MainActor in self.collected(from: workoutBuilder, heartRate: heartRate, average: average, kcal: kcal) }
    }

    /// A pause or resume reached the builder: its elapsed time moves now
    /// (`HKLiveWorkoutBuilder.elapsedTime`).
    nonisolated public func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {
        Task { @MainActor in self.collectedEvent(from: workoutBuilder) }
    }
}
#endif

/// The value of `operation`, or `fallback` if it has not answered within
/// `seconds`. The operation is left to finish on its own: HealthKit calls
/// cannot be cancelled, but nothing waits for them past the deadline.
func withTimeout<T: Sendable>(_ seconds: Double, otherwise fallback: T, _ operation: @escaping @Sendable () async -> T) async -> T {
    await withCheckedContinuation { continuation in
        let gate = OnceGate()
        Task {
            let value = await operation()
            if gate.pass() { continuation.resume(returning: value) }
        }
        Task {
            try? await Task.sleep(for: .seconds(seconds))
            if gate.pass() { continuation.resume(returning: fallback) }
        }
    }
}

/// Lets exactly one caller through.
private final class OnceGate: @unchecked Sendable {
    private let lock = NSLock()
    private var passed = false

    func pass() -> Bool {
        lock.withLock {
            if passed { return false }
            passed = true
            return true
        }
    }
}
