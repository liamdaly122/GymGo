import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// The store's wiring, on the Mac: HealthKit and WatchKit are compiled out, so
// no Health workout ever records here, which is exactly when the rest-over
// notification is wanted. Real time: each test's rests run minutes ahead.

@MainActor
private func store(fileURL: URL? = nil) -> WatchSessionStore {
    WatchSessionStore(workout: WorkoutController(), fileURL: fileURL, restAlerts: RestAlerts())
}

private func now(plus seconds: TimeInterval = 0) -> Date { Date().addingTimeInterval(seconds) }

private func liveContext(
    _ workoutId: String = "w-1", sentAt: Date, closed: [[String: Any]] = [], claim: [String: Any]? = nil, vibrate: Bool = true
) throws -> WatchContext {
    try context(
        sentAt: sentAt, live: snapshotObject("two straight lifts", workoutId: workoutId, sentAt: iso(sentAt)),
        closed: closed, claim: claim, vibrate: vibrate
    )
}

// MARK: - The rest-over notification follows the rest (C9)

@MainActor
@Test func aRestSchedulesItsNotificationAndEveryChangeKeepsItInStep() throws {
    let store = store()
    store.receive(try liveContext(sentAt: now()))
    #expect(store.restAlerts.scheduled == nil)

    store.done(weight: 100, reps: 5)
    let first = try #require(store.rest)
    #expect(store.restAlerts.scheduled?.id == first.id)
    #expect(store.restAlerts.scheduled?.fireAt == first.endsAt)

    // +30 s moves it.
    store.addRest()
    #expect(store.restAlerts.scheduled?.fireAt == first.endsAt.addingTimeInterval(30))

    // Skip removes it.
    store.skipRest()
    #expect(store.restAlerts.scheduled == nil)

    // A set logged during a rest replaces it with its own.
    store.done(weight: 100, reps: 5)
    let second = try #require(store.rest)
    store.done(weight: 100, reps: 5)
    let third = try #require(store.rest)
    #expect(second.id != third.id)
    #expect(store.restAlerts.scheduled?.id == third.id)

    // Run out in-process: gone, so no banner follows the cue.
    store.restRanOut(id: third.id)
    #expect(store.restAlerts.scheduled == nil)
}

@MainActor
@Test func theNotificationGoesWhenThePhoneEndsOrClaimsTheSession() throws {
    let ended = store()
    ended.receive(try liveContext(sentAt: now()))
    ended.done(weight: 100, reps: 5)
    #expect(ended.restAlerts.scheduled != nil)
    ended.receive(try context(sentAt: now(plus: 1), closed: [["workoutId": "w-1", "how": "finished", "at": iso(now())]]))
    #expect(ended.restAlerts.scheduled == nil)

    let claimed = store()
    claimed.receive(try liveContext(sentAt: now()))
    claimed.done(weight: 100, reps: 5)
    #expect(claimed.restAlerts.scheduled != nil)
    claimed.receive(try liveContext(sentAt: now(plus: 1), claim: ["workoutId": "w-1", "at": iso(now(plus: 1))]))
    #expect(claimed.restAlerts.scheduled == nil)

    let finished = store()
    finished.receive(try liveContext(sentAt: now()))
    finished.done(weight: 100, reps: 5)
    finished.finish()
    #expect(finished.restAlerts.scheduled == nil)
}

@MainActor
@Test func noNotificationWithThePhonesVibrateSwitchOff() throws {
    let store = store()
    store.receive(try liveContext(sentAt: now(), vibrate: false))
    store.done(weight: 100, reps: 5)
    #expect(store.rest != nil)
    #expect(store.restAlerts.scheduled == nil)
}

@MainActor
@Test func theNotificationInTheForegroundPlaysTheCueOnceAndOnlyOnce() throws {
    let store = store()
    store.receive(try liveContext(sentAt: now()))
    store.done(weight: 100, reps: 5)
    let rest = try #require(store.rest)
    // Delivered in the foreground: the rest ends here, as its own timer would.
    #expect(store.restAlerts.onPresented?(rest.id) == false)
    #expect(store.rest == nil)
    let repeatAfterFirst = store.repeatTask
    // Its own timer, a moment later, finds it over: nothing plays again.
    store.restRanOut(id: rest.id)
    #expect(store.repeatTask == repeatAfterFirst)
}

// MARK: - One rest-over cue: the app's in front, the notification's wrist-down (W2)

/// The cues the store asked for.
@MainActor
private final class Taps {
    var cues: [WatchCue] = []
    var restOvers: Int { cues.filter { $0 == .restOver }.count }
}

/// A store resting, with the app active or not (`WKApplicationState`), and the
/// rest's notification allowed to sound or not.
@MainActor
private func resting(appActive: Bool, notificationSounds: Bool = true) throws -> (WatchSessionStore, RestState, Taps) {
    let store = store()
    store.appIsActive = { appActive }
    store.restAlerts.soundsAllowed = notificationSounds
    store.receive(try liveContext(sentAt: now()))
    store.done(weight: 100, reps: 5)
    let rest = try #require(store.rest)
    #expect(store.restAlerts.scheduled?.id == rest.id)
    let taps = Taps()
    store.haptics.observe = { taps.cues.append($0) }
    return (store, rest, taps)
}

@MainActor
@Test func wristDownTheRestsNotificationPlaysTheCueAndTheAppDoesNot() throws {
    // The rest's own timer first, the app frontmost but inactive.
    let (store, rest, taps) = try resting(appActive: false)
    store.restRanOut(id: rest.id)
    #expect(store.rest == nil)
    #expect(taps.restOvers == 0)
    // The notification stays, to play it.
    #expect(store.restAlerts.scheduled?.id == rest.id)
    // It arrives with the app still frontmost: it sounds, and only it.
    #expect(store.restAlerts.onPresented?(rest.id) == true)
    #expect(taps.restOvers == 0)

    // The other order: the notification first, then the timer.
    let (other, otherRest, otherTaps) = try resting(appActive: false)
    #expect(other.restAlerts.onPresented?(otherRest.id) == true)
    #expect(other.rest == nil)
    other.restRanOut(id: otherRest.id)
    #expect(otherTaps.restOvers == 0)
}

@MainActor
@Test func inFrontTheAppPlaysTheCueAndTheNotificationIsSilent() throws {
    // The notification first.
    let (store, rest, taps) = try resting(appActive: true)
    #expect(store.restAlerts.onPresented?(rest.id) == false)
    store.restRanOut(id: rest.id)
    #expect(taps.restOvers == 1)
    #expect(store.restAlerts.scheduled == nil)

    // The timer first: the notification goes, and if it was already on its
    // way it arrives silent.
    let (other, otherRest, otherTaps) = try resting(appActive: true)
    other.restRanOut(id: otherRest.id)
    #expect(other.restAlerts.scheduled == nil)
    #expect(other.restAlerts.onPresented?(otherRest.id) == false)
    #expect(otherTaps.restOvers == 1)
}

@MainActor
@Test func wristDownWithNoNotificationToSoundTheAppStillTries() throws {
    // Refused, or its sound turned off: nothing else would reach the wrist.
    let (store, rest, taps) = try resting(appActive: false, notificationSounds: false)
    store.restRanOut(id: rest.id)
    #expect(taps.restOvers == 1)
    #expect(store.restAlerts.scheduled == nil)
}

// MARK: - The rest-over repeat stops with its session (C10)

@MainActor
@Test func theRestOverRepeatStopsWhenThePhoneFinishesTheSession() throws {
    let store = store()
    store.receive(try liveContext(sentAt: now()))
    store.screenChanged(awake: false)
    store.done(weight: 100, reps: 5)
    store.restRanOut(id: try #require(store.rest).id)
    let pending = try #require(store.repeatTask)
    #expect(!pending.isCancelled)

    store.receive(try context(sentAt: now(plus: 1), closed: [["workoutId": "w-1", "how": "finished", "at": iso(now())]]))
    #expect(pending.isCancelled)
}

@MainActor
@Test func theRestOverRepeatStopsWhenAnotherWorkoutReplacesTheSession() throws {
    let store = store()
    store.receive(try liveContext(sentAt: now()))
    store.screenChanged(awake: false)
    store.done(weight: 100, reps: 5)
    store.restRanOut(id: try #require(store.rest).id)
    let pending = try #require(store.repeatTask)
    // The phone confirms the set, then has another workout open.
    store.acknowledge(Set(store.state.unconfirmed.map(\.id)))
    store.receive(try liveContext("w-2", sentAt: now(plus: 1)))
    #expect(store.session?.workoutId == "w-2")
    #expect(pending.isCancelled)
}

// MARK: - Build 4's file (R2)

@MainActor
@Test func theStoreUpgradesBuildFoursFileWithNothingRunning() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("gymgo-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    var session = WatchSession(snapshot: try decodeSnapshot(snapshotObject("two straight lifts", workoutId: "w-old")))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(-3000), eventId: "old-set")
    let old = folder.appendingPathComponent("session.json")
    try JSONEncoder().encode(session).write(to: old)

    let fileURL = folder.appendingPathComponent("watch-state.json")
    let upgraded = store(fileURL: fileURL)
    #expect(upgraded.session == nil)
    #expect(upgraded.unconfirmedEvents().map(\.id) == ["old-set"])
    // Saved in the new file before the old one went.
    #expect(!FileManager.default.fileExists(atPath: old.path))
    let saved = try JSONDecoder().decode(WatchAppState.self, from: Data(contentsOf: fileURL))
    #expect(saved.unconfirmed.map(\.id) == ["old-set"])
    #expect(saved.session == nil)
}
