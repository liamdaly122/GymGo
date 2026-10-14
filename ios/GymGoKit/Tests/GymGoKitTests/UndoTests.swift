import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// "Logged · Undo" (docs/watch-protocol.md, "Undo"): a set logged on the
// wrist is logged and saved at once, but its event waits out a 5 s window
// before it goes to the phone. Undo inside the window takes it back and
// nothing reaches the phone.

private func running(_ name: String = "two straight lifts") throws -> WatchAppState {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject(name)))
    return state
}

private func at(_ m: Double, plus seconds: TimeInterval) -> Date { minute(m).addingTimeInterval(seconds) }

@Test func aSetLoggedOnTheWristIsHeldForItsUndoWindow() throws {
    var state = try running()
    let logged = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let result = try #require(logged)
    #expect(result.released == nil)
    #expect(state.undo?.setId == "a-s0" && state.undo?.until == at(6, plus: 5))
    // Logged and saved at once: the set in hand moves on and its rest runs.
    #expect(state.setInHand?.set.id == "a-s1")
    #expect(state.rest?.id == "e1")
    // Unconfirmed, but not to be sent while the window is open.
    #expect(state.unconfirmed.map(\.id) == ["e1"])
    #expect(state.sendable(now: at(6, plus: 4)).isEmpty)
    #expect(state.sendable(now: at(6, plus: 5)).map(\.id) == ["e1"])
    // It closes only once its time is up, and hands the event over to send.
    let early = state.closeUndo(ifOverAt: at(6, plus: 4.9))
    let onTime = state.closeUndo(ifOverAt: at(6, plus: 5))
    #expect(early == nil)
    #expect(onTime?.id == "e1")
    #expect(state.undo == nil)
    #expect(state.sendable(now: at(6, plus: 5)).map(\.id) == ["e1"])
}

@Test func undoInsideTheWindowPutsTheSetBackAndNothingReachesThePhone() throws {
    var state = try running()
    let before = state.session
    _ = state.logSet(weight: 102.5, reps: 4, at: minute(6), eventId: "e1")
    let entry = state.undoLastSet(at: at(6, plus: 3))
    #expect(entry?.setId == "a-s0" && entry?.weight == 102.5 && entry?.reps == 4)
    #expect(state.undo == nil)
    #expect(state.setInHand?.set.id == "a-s0")
    #expect(state.rest == nil)
    #expect(state.unconfirmed.isEmpty)
    #expect(state.session?.logged.isEmpty == true && state.session?.loggedHere.isEmpty == true)
    #expect(state.session?.progress.done == before?.progress.done && state.session?.progress.total == before?.progress.total)
    // Nothing logged any more: Discard is offered again.
    #expect(state.session?.canDiscard == true)
}

@Test func undoAfterTheWindowDoesNothing() throws {
    var state = try running()
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let late = state.undoLastSet(at: at(6, plus: 5))
    #expect(late == nil)
    #expect(state.session?.logged["a-s0"] != nil)
    #expect(state.unconfirmed.map(\.id) == ["e1"])
}

@Test func theNextSetClosesTheWindowOfTheOneBefore() throws {
    var state = try running()
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let logged = state.logSet(weight: 100, reps: 5, at: at(6, plus: 2), eventId: "e2")
    let second = try #require(logged)
    #expect(second.released?.id == "e1")
    #expect(state.undo?.eventId == "e2")
    #expect(state.sendable(now: at(6, plus: 3)).map(\.id) == ["e1"])
    // Undo takes back only the latest.
    let undone = state.undoLastSet(at: at(6, plus: 3))
    let again = state.undoLastSet(at: at(6, plus: 3))
    #expect(undone?.setId == "a-s1")
    #expect(state.session?.logged["a-s0"] != nil)
    #expect(again == nil)
}

@Test func undoBringsBackARestTheSetCutShortAndTheRecordSaidBeforeIt() throws {
    var state = try running()
    // A record: 102.5 beats 100.
    _ = state.logSet(weight: 102.5, reps: 5, at: minute(6), eventId: "e1")
    let record = try #require(state.lastRecord)
    let firstRest = try #require(state.rest)
    #expect(state.session?.records == 1)

    // The next set logged early, mid-rest, then taken back.
    _ = state.logSet(weight: 105, reps: 5, at: minute(7), eventId: "e2")
    #expect(state.rest?.id == "e2")
    #expect(state.session?.records == 2)
    _ = state.undoLastSet(at: at(7, plus: 1))
    #expect(state.rest == firstRest)
    #expect(state.lastRecord == record)
    #expect(state.session?.records == 1)

    // A rest it cut short that has run out since does not come back.
    _ = state.logSet(weight: 105, reps: 5, at: at(8, plus: 25), eventId: "e3")
    _ = state.undoLastSet(at: at(8, plus: 29))
    #expect(state.rest == firstRest)
    _ = state.logSet(weight: 105, reps: 5, at: at(8, plus: 29), eventId: "e4")
    _ = state.undoLastSet(at: at(8, plus: 31))
    #expect(state.rest == nil)
}

@Test func undoCancelsTheRestASkippedPartnerHandedOn() throws {
    var state = try running("a superset and a pyramid")
    for m in 6...8 { _ = state.logSet(weight: 100, reps: 5, at: minute(Double(m))) }
    _ = state.skipRest(at: minute(9))
    _ = state.logSet(weight: 40, reps: 12, at: minute(10), eventId: "half")
    _ = state.skipSetInHand(at: at(10, plus: 2))
    #expect(state.rest?.seconds == 90)
    _ = state.undoLastSet(at: at(10, plus: 3))
    #expect(state.rest == nil)
    #expect(state.setInHand?.set.id == "b-s0")
}

@Test func aFinishInsideTheWindowCarriesTheSet() throws {
    var state = try running()
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let held = state.closeUndo()
    #expect(held?.id == "e1")
    let finished = state.finish(at: at(6, plus: 2), eventId: "f")
    let finish = try #require(finished)
    #expect(finish.sets?.map(\.id) == ["e1"])
}

@Test func theWindowClosesAtOnceWhenThePhoneTakesOverOrEndsTheSession() throws {
    var claimed = try running()
    _ = claimed.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let claim = claimed.apply(try context(
        sentAt: minute(7), live: snapshotObject("two straight lifts"), claim: ["workoutId": "w-1", "at": iso(minute(7))]
    ))
    #expect(claim.released?.id == "e1")
    #expect(claimed.undo == nil)

    var ended = try running()
    _ = ended.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let end = ended.apply(try context(sentAt: minute(7), closed: [["workoutId": "w-1", "how": "finished", "at": iso(minute(7))]]))
    #expect(end.released?.id == "e1")
    #expect(ended.undo == nil)
    #expect(ended.sendable(now: minute(7)).map(\.id) == ["e1"])
}

@Test func theWindowSurvivesARelaunchAndABuild6StateHasNone() throws {
    var state = try running()
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "e1")
    let restored = try JSONDecoder().decode(WatchAppState.self, from: JSONEncoder().encode(state))
    #expect(restored == state)
    #expect(restored.undo?.eventId == "e1")

    var object = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
    object.removeValue(forKey: "undo")
    let build6 = try JSONDecoder().decode(WatchAppState.self, from: JSONSerialization.data(withJSONObject: object))
    #expect(build6.undo == nil)
    #expect(build6.session == state.session)
}

// MARK: - The store

@MainActor
private func store() throws -> (WatchSessionStore, () -> [String]) {
    let store = WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
    var sent: [String] = []
    store.sendEvent = { sent.append($0.id) }
    store.receive(try context(sentAt: Date(), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(Date()))))
    return (store, { sent })
}

@MainActor
@Test func theStoreHoldsASetsEventUntilItsWindowCloses() throws {
    let (store, sent) = try store()
    store.done(weight: 100, reps: 5)
    let first = try #require(store.state.undo?.eventId)
    #expect(sent().isEmpty)
    // Not resent on a reconnection either.
    #expect(store.unconfirmedEvents().isEmpty)
    // The next set sends it.
    store.skipRest()
    store.done(weight: 100, reps: 5)
    #expect(sent().contains(first))
    let second = try #require(store.state.undo?.eventId)
    #expect(!sent().contains(second))
    // Finish sends the held one, then the finish carrying it.
    store.finish()
    let order = sent()
    let held = try #require(order.firstIndex(of: second))
    #expect(order.count == held + 2)
}

@MainActor
@Test func theStoresUndoPutsTheSetBackWithItsNumbersAndStopsItsRest() throws {
    let (store, sent) = try store()
    store.done(weight: 102.5, reps: 4)
    #expect(store.rest != nil)
    #expect(store.restAlerts.scheduled != nil)
    store.undoLastSet()
    #expect(store.rest == nil)
    #expect(store.restAlerts.scheduled == nil)
    let hand = try #require(store.setInHand)
    #expect(hand.set.id == "a-s0")
    // The screen opens on the numbers it was logged at.
    #expect(hand.numbersOnScreen(store.draft) == (102.5, 4))
    #expect(sent().allSatisfy { $0 != store.state.unconfirmed.first?.id })
    #expect(store.state.unconfirmed.isEmpty)
}
