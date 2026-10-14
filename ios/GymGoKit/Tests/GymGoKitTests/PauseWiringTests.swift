import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// Pause and resume, wired: the WorkoutController's bookkeeping on the Mac,
// where HealthKit is compiled out. The pure rules are in PauseTests.

@MainActor
@Test func aPauseAskedForSilencesItsEchoAndAResumeDoesToo() {
    let workout = WorkoutController()
    // Nothing asked: both buttons together toggle.
    #expect(workout.answerRequest(.running, now: Date()) == .pause)

    workout.pause()
    #expect(workout.answerRequest(.paused, now: Date()) == nil)
    #expect(workout.answerRequest(.paused, now: Date().addingTimeInterval(PauseRequest.echoWindow)) == .resume)

    workout.resume()
    #expect(workout.answerRequest(.running, now: Date()) == nil)
}

@MainActor
@Test func aPauseIsSaidOnceWithWhenItBegan() {
    let workout = WorkoutController()
    var told = 0
    workout.onPauseChanged = { told += 1 }

    let began = Date(timeIntervalSince1970: 1_792_000_000)
    workout.pauseChanged(paused: true, at: began)
    #expect(workout.isPaused)
    #expect(workout.pausedAt == began)
    #expect(told == 1)

    // HealthKit saying it again is no change.
    workout.pauseChanged(paused: true, at: began.addingTimeInterval(5))
    #expect(workout.pausedAt == began)
    #expect(told == 1)

    workout.pauseChanged(paused: false, at: began.addingTimeInterval(60))
    #expect(!workout.isPaused)
    #expect(workout.pausedAt == nil)
    #expect(told == 2)
}

@MainActor
@Test func whileHealthPromptsAreHeldNothingAsks() async {
    let workout = WorkoutController()
    #expect(!workout.promptsHeld)
    workout.holdHealthPrompts(for: 30)
    #expect(workout.promptsHeld)
    #expect(await workout.needsAuthorization() == false)
    workout.holdHealthPrompts(for: -1)
    #expect(!workout.promptsHeld)
}

// MARK: - The Action button, carried out by the store

@MainActor
private func store() -> WatchSessionStore {
    WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
}

private func liveContext(reps: Int? = 5, claim: [String: Any]? = nil) throws -> WatchContext {
    var live = try snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(Date()))
    if reps == nil, var sets = live["sets"] as? [[String: Any]] {
        sets[0]["reps"] = NSNull()
        sets[0]["source"] = "none"
        live["sets"] = sets
    }
    return try context(sentAt: Date(), live: live, claim: claim)
}

@MainActor
@Test func theFirstPressRefusesWithTheTodayCardsWords() async throws {
    let empty = store()
    await #expect(throws: ActionButtonRefusal("Open GymGo on your iPhone to load your sessions.")) {
        try await empty.startFromActionButton(waitingUpTo: 1)
    }
    #expect(empty.session == nil)

    let blockDone = store()
    blockDone.receive(try context(sentAt: Date(), state: "blockDone"))
    await #expect(throws: ActionButtonRefusal("Block done. Start the next one on your iPhone.")) {
        try await blockDone.startFromActionButton(waitingUpTo: 1)
    }
}

@MainActor
@Test func theFirstPressNeverStartsALaterDaysSession() async throws {
    let later = store()
    later.receive(try context(sentAt: Date(), ready: readyObject(date: "2099-01-05", status: "upcoming")))
    #expect(later.todayCard.startLabel == "Start early")
    await #expect(throws: ActionButtonRefusal(ActionButtonStart.notDueToday)) {
        try await later.startFromActionButton(waitingUpTo: 1)
    }
    #expect(later.session == nil)
}

@MainActor
@Test func theFirstPressStartsTodaysSessionWithoutAskingForHealth() async throws {
    let today = store()
    // A session planned for a day gone by has rolled to today.
    today.receive(try context(sentAt: Date(), ready: readyObject(date: "2026-01-05")))
    #expect(today.todayCard.startLabel == "Start")
    var sent: [WatchEvent] = []
    today.sendEvent = { sent.append($0) }
    // On the Mac, Health is unavailable: the session starts, and the press
    // says why Health is not recording it, at once rather than at the deadline.
    let began = Date()
    await #expect(throws: ActionButtonRefusal(ActionButtonStart.notRecording(.unavailable))) {
        try await today.startFromActionButton(waitingUpTo: 20)
    }
    #expect(Date().timeIntervalSince(began) < 5)
    #expect(today.session != nil)
    #expect(sent.count == 1)
    #expect(today.workout.promptsHeld)
}

@MainActor
@Test func aPressLogsTheSetInHandThenSkipsTheRestItStarted() throws {
    let store = store()
    store.receive(try liveContext())
    let first = try #require(store.setInHand)
    #expect(store.actionButtonPressed() == .logSet)
    #expect(store.session?.progress.done == 1)
    #expect(store.setInHand?.set.id != first.set.id)
    #expect(store.rest != nil)

    #expect(store.actionButtonPressed() == .skipRest)
    #expect(store.rest == nil)
    #expect(store.session?.progress.done == 1)
}

@MainActor
@Test func aPressWithNoRepsLogsNothingAndTapsFailure() throws {
    let store = store()
    store.receive(try liveContext(reps: nil))
    var cues: [WatchCue] = []
    store.haptics.observe = { cues.append($0) }
    #expect(store.actionButtonPressed() == .logSet)
    #expect(store.session?.progress.done == 0)
    // The failure tap, once, and nothing that says a set was logged:
    // `logSetOnScreen` owns the tap, and the press does not add another.
    #expect(cues == [.failed])
}

@MainActor
@Test func aPressWhilePausedResumesAndLogsNothing() throws {
    let store = store()
    store.receive(try liveContext())
    store.workout.pauseChanged(paused: true, at: Date())
    var cues: [WatchCue] = []
    store.haptics.observe = { cues.append($0) }
    #expect(store.actionButtonPressed() == .resume)
    #expect(store.session?.progress.done == 0)
    // The press taps, so a press wrist-down is never silent.
    #expect(cues == [.resumed])
    // The resume counts as asked for: its echo from both buttons is ignored.
    #expect(store.workout.answerRequest(.paused, now: Date()) == nil)
}

@MainActor
@Test func aPauseOrResumeAskedForOnTheWristTaps() throws {
    let store = store()
    store.workout.onPauseChanged = { store.workoutPauseChanged() }
    store.receive(try liveContext())
    var cues: [WatchCue] = []
    store.haptics.observe = { cues.append($0) }

    // Nothing recording: nothing to pause, and nothing said.
    store.pauseWorkout()
    #expect(cues.isEmpty)

    store.workout.recordForTests()
    store.pauseWorkout()
    #expect(cues == [.paused])
    // HealthKit saying it paused taps nothing more, and nor does Pause again.
    store.workout.pauseChanged(paused: true, at: Date())
    store.pauseWorkout()
    #expect(cues == [.paused])

    store.resumeWorkout()
    #expect(cues == [.paused, .resumed])
    store.workout.pauseChanged(paused: false, at: Date())
    store.resumeWorkout()
    #expect(cues == [.paused, .resumed])
}

@MainActor
@Test func bothButtonsTogetherTapAsTheyPauseOrResume() {
    let store = store()
    var cues: [WatchCue] = []
    store.haptics.observe = { cues.append($0) }
    #expect(store.workout.answerButtons(.running, now: Date()) == .pause)
    #expect(store.workout.answerButtons(.paused, now: Date()) == .resume)
    #expect(cues == [.paused, .resumed])
    // The echo of a pause asked for directly is ignored, and taps nothing.
    store.workout.pause()
    #expect(store.workout.answerButtons(.paused, now: Date()) == nil)
    #expect(cues == [.paused, .resumed])
}

@MainActor
@Test func aRecoveredPauseAndTheResumeALoggedSetCausesTapNothingOfTheirOwn() throws {
    let store = store()
    store.workout.onPauseChanged = { store.workoutPauseChanged() }
    store.receive(try liveContext())
    var cues: [WatchCue] = []
    store.haptics.observe = { cues.append($0) }
    // A recovery finds the session paused.
    store.workout.pauseChanged(paused: true, at: Date())
    #expect(cues.isEmpty)
    // A set logged while paused plays its own cue, uncut, and nothing else.
    store.done(weight: 100, reps: 5)
    #expect(cues == [.restBegins])
}

@MainActor
@Test func aPressWhileThePhoneLogsDoesNothingAtAll() throws {
    let store = store()
    store.receive(try liveContext(claim: ["workoutId": "w-1", "at": iso(Date())]))
    #expect(store.state.owner == .phone)
    #expect(store.actionButtonPressed() == .nothing)
    #expect(store.session?.progress.done == 0)
}

@MainActor
@Test func aPauseOrResumeIsReportedToThePhoneAtOnceAndOnlyOnce() throws {
    let store = store()
    // As the watch target wires it.
    store.workout.onPauseChanged = { store.workoutPauseChanged() }
    store.receive(try liveContext())
    var reports: [WatchStateReport] = []
    store.sendState = { json in
        if let report = try? JSONDecoder().decode(WatchStateReport.self, from: Data(json.utf8)) { reports.append(report) }
    }
    let began = Date()
    store.workout.pauseChanged(paused: true, at: began)
    // One report per flip: each wakes the phone.
    #expect(reports.count == 1)
    #expect(reports.last?.paused == WatchSession.isoString(began))
    store.workout.pauseChanged(paused: false, at: began.addingTimeInterval(60))
    #expect(reports.count == 2)
    #expect(reports.last?.paused == nil)
}
