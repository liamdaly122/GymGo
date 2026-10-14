import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// The store's seams for the other parts of build 7 (docs/build7-plan.md,
// "Seams"): Done with the numbers on screen for the Action button, the save
// hook the complications hang off, and the wrist's skips and jumps reaching
// the phone at once. On the Mac: HealthKit and WatchKit are compiled out.

@MainActor
private func running(_ name: String = "two straight lifts") throws -> WatchSessionStore {
    let store = WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
    store.receive(try context(sentAt: Date(), live: snapshotObject(name, workoutId: "w-1", sentAt: iso(Date()))))
    return store
}

@MainActor
@Test func doneFromOutsideTheScreenLogsTheNumbersOnIt() throws {
    let store = try running()
    // Nothing dialled: the set's own numbers.
    #expect(store.logSetOnScreen())
    #expect(store.session?.logged["a-s0"].map { ($0.weight, $0.reps) } ?? (0, 0) == (100, 5))

    // Dialled on the screen for the set in hand: those.
    let hand = try #require(store.setInHand)
    let rung = hand.dial.index(for: 102.5)
    store.draft = SetDraft(setId: hand.set.id, weightIndex: Double(rung), reps: 6, onReps: false)
    #expect(store.logSetOnScreen())
    #expect(store.session?.logged["a-s1"].map { ($0.weight, $0.reps) } ?? (0, 0) == (102.5, 6))
    #expect(store.draft == nil)

    // Dialled for another set: not this one's numbers.
    store.draft = SetDraft(setId: "b-s0", weightIndex: 0, reps: 12, onReps: false)
    #expect(store.logSetOnScreen())
    #expect(store.session?.logged["a-s2"].map { ($0.weight, $0.reps) } ?? (0, 0) == (102.5, 6))
}

@MainActor
@Test func doneWithNoRepsOnScreenLogsNothingAndSaysSo() throws {
    var object = try snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(Date()))
    var sets = object["sets"] as! [[String: Any]]
    sets[0]["reps"] = NSNull()
    sets[0]["weight"] = NSNull()
    object["sets"] = sets
    let store = WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
    store.receive(try context(sentAt: Date(), live: object))
    var cues: [WatchCue] = []
    store.haptics.observe = { cues.append($0) }

    #expect(!store.logSetOnScreen())
    #expect(cues == [.failed])
    #expect(store.session?.logged.isEmpty == true)
    #expect(store.state.unconfirmed.allSatisfy { $0.kind != .completeSet })

    // Nothing in hand at all: false, and no tap.
    let idle = WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
    #expect(!idle.logSetOnScreen())
}

@MainActor
@Test func everySaveIsHandedOnEvenWithNoFileToSaveTo() throws {
    let store = WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
    var saved: [WatchAppState] = []
    store.onSaved = { saved.append($0) }
    store.receive(try context(sentAt: Date(), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(Date()))))
    #expect(saved.last?.session?.workoutId == "w-1")
    let before = saved.count
    store.done(weight: 100, reps: 5)
    #expect(saved.count > before)
    #expect(saved.last == store.state)
}

@MainActor
@Test func aSkipOrAJumpOnTheWristReachesThePhoneAtOnce() throws {
    let store = try running()
    var reports: [WatchStateReport] = []
    store.sendState = { json in
        if let report = try? JSONDecoder().decode(WatchStateReport.self, from: Data(json.utf8)) { reports.append(report) }
    }
    store.skipSetInHand()
    #expect(reports.last?.skipped == ["a-s0"])
    #expect(reports.last?.inHand == WatchStateReport.InHand(name: "Lift a", detail: "Set 2 of 3 · 100 × 5"))

    #expect(store.go(toStation: 1))
    #expect(reports.last?.setId == "b-s0")
    #expect(reports.last?.inHand?.name == "Lift b")

    store.doneWithLift()
    #expect(reports.last?.skipped.count == 4)
    #expect(store.setInHand?.set.id == "a-s1")

    // Everything left skipped: nothing in hand, and the phone hears so.
    store.skipSetInHand()
    store.skipSetInHand()
    #expect(store.setInHand == nil)
    #expect(reports.last?.setId == nil && reports.last?.inHand == nil && reports.last?.skipped.count == 6)
    #expect(store.session?.nothingLeftTitle == "Nothing left · 6 skipped")
}

@MainActor
@Test func aSkippedPartnersRestTimesItsCuesAndNotification() throws {
    let store = try running("a superset and a pyramid")
    for _ in 0..<3 { store.done(weight: 100, reps: 5) }
    store.skipRest()
    store.done(weight: 40, reps: 12)
    #expect(store.rest == nil)
    store.skipSetInHand()
    let rest = try #require(store.rest)
    #expect(rest.seconds == 90)
    #expect(store.restAlerts.scheduled?.id == rest.id)
}
