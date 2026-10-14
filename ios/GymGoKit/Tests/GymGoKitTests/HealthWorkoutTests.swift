import Foundation
import Testing
@testable import GymGoKit

// The decisions behind the watch's Health workout: what becomes of a
// recording left over from a workout already over, when a failed start is
// tried again, and the rest-over notification for when nothing keeps the app
// running.

private func live(_ workoutId: String, sentAt: Date = minute(5)) throws -> [String: Any] {
    try snapshotObject("two straight lifts", workoutId: workoutId, sentAt: iso(sentAt))
}

private func closed(_ workoutId: String, _ how: String, at: Date) -> [String: Any] {
    ["workoutId": workoutId, "how": how, "at": iso(at)]
}

// MARK: - A recording left over from a workout already over (C11)

@Test func aRecordingIsTheRunningSessionsOrIsTaggedWithIt() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: minute(4), now: minute(6)) == .tag("w-1"))
    #expect(state.healthRecordingAction(taggedWith: "w-1", startedAt: minute(4), now: minute(6)) == .keep)
}

@Test func aRecordingForAWorkoutFinishedHereIsSavedNotLeftRunning() throws {
    // Finish on the wrist, then the app dies mid-save; watchOS brings the
    // workout session back on relaunch.
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    _ = state.finish(at: minute(30))
    state.updateSummary { $0.health = .saving }
    #expect(state.healthRecordingAction(taggedWith: "w-1", startedAt: minute(5), now: minute(31)) == .finish(tag: nil))
    // Its summary already closed: still a finish.
    state.closeSummary()
    #expect(state.healthRecordingAction(taggedWith: "w-1", startedAt: minute(5), now: minute(40)) == .finish(tag: nil))
}

@Test func aRecordingForAWorkoutDiscardedHereOrOnThePhoneIsThrownAway() throws {
    var here = WatchAppState()
    here.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = here.discard(at: minute(6))
    #expect(here.healthRecordingAction(taggedWith: "w-1", startedAt: minute(5), now: minute(7)) == .discard)

    var phone = WatchAppState()
    phone.apply(try context(sentAt: minute(5), live: live("w-2")))
    phone.apply(try context(sentAt: minute(8), closed: [closed("w-2", "discarded", at: minute(7))]))
    #expect(phone.healthRecordingAction(taggedWith: "w-2", startedAt: minute(5), now: minute(9)) == .discard)
}

@Test func aRecordingForAWorkoutFinishedOnThePhoneIsSaved() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    state.apply(try context(sentAt: minute(40), closed: [closed("w-1", "finished", at: minute(39))]))
    #expect(state.healthRecordingAction(taggedWith: "w-1", startedAt: minute(5), now: minute(41)) == .finish(tag: nil))
}

@Test func startOverALeftoverRecordingEndsItRatherThanRelabellingIt() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    _ = state.finish(at: minute(30))
    state.apply(try context(sentAt: minute(31), ready: readyObject(workoutId: "w-next")))
    _ = state.start(state.home!.ready!, at: minute(32))
    #expect(state.session?.workoutId == "w-next")
    // The finished workout's recording is still running: it is saved as
    // w-1's, never tagged as w-next's.
    #expect(state.healthRecordingAction(taggedWith: "w-1", startedAt: minute(5), now: minute(32)) == .finish(tag: nil))
}

@Test func aRecordingForAWorkoutThisWatchNeverSawEndIsLeftAlone() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5)))
    #expect(state.healthRecordingAction(taggedWith: "w-unknown", startedAt: minute(1), now: minute(6)) == .keep)
}

// MARK: - The phone ended the workout before the watch adopted it (R6)

@Test func anUntaggedRecordingWaitsForTheContextNamingItsWorkout() throws {
    // Nothing from the phone yet.
    #expect(WatchAppState().healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(11)) == .keep)

    // The phone's last context from before the start (the one replayed at
    // launch): it cannot say anything about this recording, even with a
    // discard just before it.
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(9), closed: [closed("w-0", "discarded", at: minute(9))]))
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(11)) == .keep)

    // A newer context with the workout open: it is adopted, not ended.
    var open = WatchAppState()
    open.apply(try context(sentAt: minute(10.5), live: live("w-1", sentAt: minute(10.5))))
    #expect(open.healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(11)) == .tag("w-1"))
}

@Test func anUntaggedRecordingWhoseWorkoutWasDiscardedOnThePhoneIsThrownAway() throws {
    // Start on the phone, wrong session, discarded within seconds: the
    // watch's first context is the discard one.
    var state = WatchAppState()
    let change = state.apply(try context(
        sentAt: minute(10).addingTimeInterval(5), closed: [closed("w-1", "discarded", at: minute(10).addingTimeInterval(4))]
    ))
    #expect(change.ended == nil && change.adopted == nil)
    let action = state.healthRecordingAction(taggedWith: nil, startedAt: minute(10).addingTimeInterval(2), now: minute(10).addingTimeInterval(6))
    #expect(action == .discard)
}

@Test func anUntaggedRecordingWhoseWorkoutWasDiscardedBeforeItBeganIsThrownAwayOnceItHasWaited() throws {
    // The phone starts w-1, opens the watch app and discards w-1, all within
    // seconds: its context (sent at +5 s) leaves before the watch starts
    // recording (at +7 s), and no other context may come for hours.
    let started = minute(10).addingTimeInterval(7)
    var state = WatchAppState()
    state.apply(try context(
        sentAt: minute(10).addingTimeInterval(5), closed: [closed("w-1", "discarded", at: minute(10).addingTimeInterval(4))]
    ))
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: started, now: started.addingTimeInterval(1)) == .keep)
    let justBefore = started.addingTimeInterval(WatchAppState.strayRecordingWait - 1)
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: started, now: justBefore) == .keep)
    // A phone start names its workout within seconds; by now nothing will.
    let waited = started.addingTimeInterval(WatchAppState.strayRecordingWait)
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: started, now: waited) == .discard)

    // The other order: the discard's context comes after the recording began.
    var after = WatchAppState()
    after.apply(try context(sentAt: minute(10).addingTimeInterval(9), closed: [closed("w-1", "discarded", at: minute(10).addingTimeInterval(8))]))
    #expect(after.healthRecordingAction(taggedWith: nil, startedAt: started, now: minute(10).addingTimeInterval(10)) == .discard)

    // Nothing ever heard from the phone: the same wait, then thrown away.
    #expect(WatchAppState().healthRecordingAction(taggedWith: nil, startedAt: started, now: waited) == .discard)
}

@Test func aRecordingAContextNamesAsLiveOrTaggedWithTheRunningSessionIsNeverThrownAway() throws {
    let started = minute(10)
    let hoursLater = minute(10 + 180)

    // Named as live before the recording began: adopted, so it is that session's.
    var named = WatchAppState()
    named.apply(try context(sentAt: minute(9.9), live: live("w-1", sentAt: minute(9.9))))
    #expect(named.healthRecordingAction(taggedWith: nil, startedAt: started, now: hoursLater) == .tag("w-1"))
    #expect(named.healthRecordingAction(taggedWith: "w-1", startedAt: started, now: hoursLater) == .keep)

    // Named as live, but not adopted here (ended here, the phone not caught up).
    var ended = WatchAppState()
    ended.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = ended.logSet(weight: 100, reps: 5, at: minute(6))
    _ = ended.finish(at: minute(7))
    ended.apply(try context(sentAt: minute(9.9), live: live("w-1", sentAt: minute(9.9))))
    #expect(ended.healthRecordingAction(taggedWith: nil, startedAt: started, now: hoursLater) == .keep)
}

@Test func anUntaggedRecordingWhoseWorkoutWasFinishedOnThePhoneIsSavedUnderItUnlessItIsSeconds() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(40), closed: [closed("w-1", "finished", at: minute(39))]))
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(41)) == .finish(tag: "w-1"))

    var quick = WatchAppState()
    quick.apply(try context(sentAt: minute(10.5), closed: [closed("w-1", "finished", at: minute(10.4))]))
    #expect(quick.healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(10.5)) == .discard)
}

@Test func anUntaggedRecordingWithNothingBehindItIsThrownAway() throws {
    // Nothing open on the phone, and nothing ended there since it began.
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(20), closed: [closed("w-old", "finished", at: minute(-300))]))
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(21)) == .discard)
}

@Test func anUntaggedRecordingBesideAnEndedLiveWorkoutIsLeftForTheIdlePage() throws {
    // Finished here; the phone, not caught up, still sends it as open.
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    _ = state.finish(at: minute(7))
    state.apply(try context(sentAt: minute(12), live: live("w-1", sentAt: minute(12))))
    #expect(state.healthRecordingAction(taggedWith: nil, startedAt: minute(10), now: minute(13)) == .keep)
}

// MARK: - Trying again after a Health start failed (C8)

@Test func aStartThatFailedBeforeHealthWasAskedIsTriedAgain() {
    var retry = HealthRetry()
    // In the background, before the first foreground asked: not determined.
    retry.failed("w-1", authorized: false, notDetermined: true)
    #expect(retry.mayStart("w-1"))
    retry.failed("w-1", authorized: true, notDetermined: true)
    #expect(retry.mayStart("w-1"))
    // Refused, or unavailable: read afresh on each wake, never blocked.
    retry.failed("w-1", authorized: false)
    #expect(retry.mayStart("w-1"))
}

@Test func aStartThatFailedWithHealthAllowedWaitsForAGrant() {
    var retry = HealthRetry()
    retry.failed("w-1", authorized: true)
    #expect(!retry.mayStart("w-1"))
    #expect(retry.mayStart("w-2"))
    retry.granted()
    #expect(retry.mayStart("w-1"))
    retry.failed(nil, authorized: true)
    #expect(retry.blocked == nil)
}

// MARK: - The rest-over notification (C9)

private func rest(_ id: String = "r-1", endsAt: Date = minute(10)) -> RestState {
    RestState(id: id, startedAt: endsAt.addingTimeInterval(-150), endsAt: endsAt, seconds: 150, upNext: UpNext(name: "Lift a", detail: "Set 2 of 3"))
}

@Test func theRestOverNotificationIsWantedOnlyWhenNothingKeepsTheAppRunning() {
    let wanted = RestAlert.wanted(for: rest(), healthRecording: false, vibrate: true, now: minute(9))
    #expect(wanted == RestAlert(id: "r-1", fireAt: minute(10), upNext: UpNext(name: "Lift a", detail: "Set 2 of 3")))
    // Health records: the in-process cues play wrist-down.
    #expect(RestAlert.wanted(for: rest(), healthRecording: true, vibrate: true, now: minute(9)) == nil)
    #expect(RestAlert.wanted(for: nil, healthRecording: false, vibrate: true, now: minute(9)) == nil)
    #expect(RestAlert.wanted(for: rest(), healthRecording: false, vibrate: true, now: minute(10)) == nil)
    #expect(RestAlert.wanted(for: rest(), healthRecording: false, vibrate: false, now: minute(9)) == nil)
}

@Test func theScheduledNotificationFollowsTheRest() {
    let first = RestAlert(id: "r-1", fireAt: minute(10), upNext: UpNext(name: "a", detail: "b"))
    // Scheduled once.
    #expect(RestAlert.reconcile(scheduled: nil, wanted: first) == (nil, first))
    #expect(RestAlert.reconcile(scheduled: first, wanted: first) == (nil, nil))
    // +30 s: the same rest, later.
    var longer = first
    longer.fireAt = minute(10.5)
    #expect(RestAlert.reconcile(scheduled: first, wanted: longer) == ("r-1", longer))
    // A new set's rest replaces it.
    let next = RestAlert(id: "r-2", fireAt: minute(13), upNext: UpNext(name: "a", detail: "b"))
    #expect(RestAlert.reconcile(scheduled: first, wanted: next) == ("r-1", next))
    // Skipped, run out, ended, or Health took over.
    #expect(RestAlert.reconcile(scheduled: first, wanted: nil) == ("r-1", nil))
}

@Test func theRestOverCueIsTheAppsInFrontAndTheNotificationsWristDown() {
    // In front and awake: the app plays it, whatever the notification would do.
    #expect(RestAlert.cuer(appActive: true, notificationSounds: true) == .app)
    #expect(RestAlert.cuer(appActive: true, notificationSounds: false) == .app)
    // Wrist down (inactive, still frontmost) or in the background: the
    // notification, when it will sound.
    #expect(RestAlert.cuer(appActive: false, notificationSounds: true) == .system)
    // None will (refused, its sound off, or Health records and none was
    // scheduled): the app tries.
    #expect(RestAlert.cuer(appActive: false, notificationSounds: false) == .app)
}

// MARK: - The rest-over repeat (C10)

@Test func theRestOverRepeatPlaysOnlyForTheSessionStillRunning() {
    #expect(restOverPlaysAgain(noticed: false, restRunning: false, restSession: "w-1", runningSession: "w-1"))
    #expect(!restOverPlaysAgain(noticed: true, restRunning: false, restSession: "w-1", runningSession: "w-1"))
    #expect(!restOverPlaysAgain(noticed: false, restRunning: true, restSession: "w-1", runningSession: "w-1"))
    // Finished or discarded on the phone, or replaced by another workout.
    #expect(!restOverPlaysAgain(noticed: false, restRunning: false, restSession: "w-1", runningSession: nil))
    #expect(!restOverPlaysAgain(noticed: false, restRunning: false, restSession: "w-1", runningSession: "w-2"))
}
