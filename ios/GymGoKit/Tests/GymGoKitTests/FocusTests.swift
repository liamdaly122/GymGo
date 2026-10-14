import Foundation
import Testing
@testable import GymGoKit

// Running the session from the wrist (docs/watch-protocol.md, rules 4 and 5):
// a station tapped, a set skipped, Done with this lift, and what the counts,
// the rest and Up next make of them. The test macros capture their operands
// immutably, so every mutating call is made before its #expect.

private func named(_ name: String) throws -> WatchSnapshot { try decodeSnapshot(snapshotObject(name)) }

/// "Lift a" × 3, then "Lift b" × 3, each its own station.
private func straight() throws -> WatchSession { WatchSession(snapshot: try named("two straight lifts")) }

@discardableResult
private func log(_ session: inout WatchSession, _ weight: Double, _ reps: Int, at m: Double) throws -> LogOutcome {
    let outcome = session.logSetInHand(weight: weight, reps: reps, at: minute(m))
    return try #require(outcome)
}

// MARK: - Skip this set, Done with this lift

@Test func skipThisSetMovesToTheNextAndCountsItNeitherDoneNorLeft() throws {
    var session = try straight()
    let skipped = session.skipSetInHand()
    #expect(skipped == ["a-s0"])
    #expect(session.setInHand?.set.id == "a-s1")
    #expect(session.skipped == ["a-s0"])
    #expect(session.remainingSets.count == 5)
    #expect(session.progress == (0, 6))
    #expect(session.stationProgress(0) == StationProgress(done: 0, left: 2, skipped: 1))
    #expect(session.finishMessage == "0 of 6 logged · 1 skipped; sets not logged are dropped.")
    #expect(session.stationLine(0) == "Barbell · 3 × 5 · 0/3 · 1 skipped")
    #expect(session.stationLine(1) == "Dumbbell · 3 × 10 · 0/3")
}

@Test func skipThisSetTakesWhatHangsOffIt() throws {
    var snapshot = try named("two straight lifts")
    var drop = snapshot.sets[0]
    drop.id = "a-d0"
    drop.type = "drop"
    drop.parentSetId = "a-s0"
    drop.label = "Drop · set 1"
    drop.carries = false
    snapshot.sets.insert(drop, at: 1)
    var session = WatchSession(snapshot: snapshot)
    let skipped = session.skipSetInHand()
    #expect(skipped == ["a-s0", "a-d0"])
    #expect(session.setInHand?.set.id == "a-s1")
}

@Test func doneWithThisLiftSkipsTheWholeStationASupersetsPartnerWithIt() throws {
    var session = WatchSession(snapshot: try named("a superset and a pyramid"))
    for m in 1...3 { try log(&session, 100, 5, at: Double(m)) }
    #expect(session.setInHand?.set.id == "b-s0")
    let skipped = session.skipStationInHand()
    #expect(skipped?.count == 6)
    #expect(session.setInHand == nil)
    #expect(session.nothingLeftTitle == "Nothing left · 6 skipped")
    #expect(session.finishMessage == "3 of 9 logged · 6 skipped; sets not logged are dropped.")
    #expect(session.stationProgress(1).finished == false)
}

@Test func withNothingSkippedTheWordsAreAsBefore() throws {
    var session = try straight()
    #expect(session.nothingLeftTitle == "All sets logged")
    for m in 1...6 { try log(&session, 100, 5, at: Double(m)) }
    #expect(session.finishMessage == "Every set is logged.")
    #expect(session.stationProgress(0).finished)
}

// MARK: - Tap a station

@Test func aTappedStationIsWhereTheSetInHandGoesAndItStaysThere() throws {
    var session = try straight()
    let went = session.go(toStation: 1)
    #expect(went)
    #expect(session.setInHand?.set.id == "b-s0")
    // Up next is worded the phone's way, from what the wrist does next.
    let first = try log(&session, 22.5, 10, at: 1)
    #expect(first.upNext == UpNext(name: "Lift b", detail: "Set 2 of 3 · 22.5 × 10"))
    try log(&session, 22.5, 10, at: 3)
    // The list says Finish after b-s2; on the wrist, Lift a is still to do.
    let last = try log(&session, 22.5, 10, at: 5)
    #expect(last.upNext == UpNext(name: "Lift a", detail: "Barbell · 3 × 5"))
    // On round to the station skipped past.
    #expect(session.setInHand?.set.id == "a-s0")
}

@Test func aStationWithOnlySkippedSetsLeftGetsThemBack() throws {
    var session = try straight()
    session.skipStationInHand()
    #expect(session.setInHand?.set.id == "b-s0")
    let back = session.go(toStation: 0)
    #expect(back)
    #expect(session.skipped.isEmpty)
    #expect(session.setInHand?.set.id == "a-s0")

    // With sets left as well as skipped, a tap only goes there.
    session.skipSetInHand()
    let away = session.go(toStation: 1)
    let again = session.go(toStation: 0)
    #expect(away && again)
    #expect(session.setInHand?.set.id == "a-s1")
    #expect(session.skipped == ["a-s0"])
}

@Test func aFinishedStationIsNotSomewhereToGo() throws {
    var session = try straight()
    for m in 1...3 { try log(&session, 100, 5, at: Double(m)) }
    let finished = session.go(toStation: 0)
    let missing = session.go(toStation: 7)
    #expect(!finished && !missing)
    #expect(session.setInHand?.set.id == "b-s0")
}

// MARK: - The phone's next list

@Test func aNewerListKeepsTheFocusAndDropsSkipsThePhoneHasDone() throws {
    let original = try named("two straight lifts")
    var session = WatchSession(snapshot: original)
    session.skipSetInHand()
    session.skipSetInHand()
    #expect(session.skipped == ["a-s0", "a-s1"])
    session.go(toStation: 1)

    // The phone logged a-s0 itself.
    var newer = original
    newer.sentAt = "2026-10-14T17:06:00.000Z"
    newer.sets.removeFirst()
    newer.lifts["ex-a"]!.doneToday = [DoneSet(setId: "a-s0", weight: 100, reps: 5, completedAt: iso(minute(2)))]
    let received = session.receive(newer)
    #expect(received == .updated)
    #expect(session.skipped == ["a-s1"])
    #expect(session.setInHand?.set.id == "b-s0")
}

@Test func aStationThePhoneHasFinishedHandsOnToWhereTheSessionGoes() throws {
    // Three stations; the wrist jumps to the second and does all of it.
    let original = try named("a plan, last time, a step down and an AMRAP set")
    var session = WatchSession(snapshot: original)
    session.go(toStation: 1)
    for m in 1...3 { try log(&session, 22.5, 8, at: Double(m)) }
    #expect(session.setInHand?.set.id == "c-s1")

    // The phone confirms them: they leave the list, and the focus with them.
    var newer = original
    newer.sentAt = "2026-10-14T17:30:00.000Z"
    newer.sets.removeAll { $0.exerciseId == "ex-b" }
    newer.lifts["ex-b"]!.doneToday = ["b-s0", "b-s1", "b-s2"].enumerated().map {
        DoneSet(setId: $1, weight: 22.5, reps: 8, completedAt: iso(minute(Double($0 + 1))))
    }
    let received = session.receive(newer)
    #expect(received == .updated)
    // Still on from the second station, not back to the first.
    #expect(session.setInHand?.set.id == "c-s1")
}

@Test func anotherWorkoutStartsWithNoFocusAndNothingSkipped() throws {
    var session = try straight()
    session.skipSetInHand()
    session.go(toStation: 1)
    let received = session.receive(try decodeSnapshot(snapshotObject("two straight lifts", workoutId: "w-2")))
    #expect(received == .replaced)
    #expect(session.focus == nil && session.skipped.isEmpty)
    #expect(session.setInHand?.set.id == "a-s0")
}

@Test func focusAndSkipsSurviveARelaunch() throws {
    var session = try straight()
    session.skipSetInHand()
    session.go(toStation: 1)
    let restored = try JSONDecoder().decode(WatchSession.self, from: JSONEncoder().encode(session))
    #expect(restored == session)
    #expect(restored.setInHand?.set.id == "b-s0")
}

// MARK: - Rests and cues

@Test func aSetWhosePartnerWasSkippedRestsAsThePartnerWould() throws {
    // Saved with the partner's first set skipped already.
    var object = try snapshotObject("a superset and a pyramid")
    object["sets"] = (object["sets"] as! [[String: Any]]).filter { !($0["id"] as! String).hasPrefix("a-") }
    let saved = try JSONSerialization.data(withJSONObject: ["snapshot": object, "skipped": ["c-s0"]])
    var session = try JSONDecoder().decode(WatchSession.self, from: saved)
    #expect(session.setInHand?.set.id == "b-s0")
    let outcome = try log(&session, 40, 12, at: 1)
    #expect(outcome.set.restAfter == nil)
    #expect(outcome.restSeconds == 90)
    #expect(outcome.upNext == UpNext(name: "Lift b", detail: "Set 2 of 3 · 40 × 12"))
}

@Test func skippingThePartnerJustAfterTheFirstHalfStartsItsRest() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("a superset and a pyramid")))
    for m in 6...8 { _ = state.logSet(weight: 100, reps: 5, at: minute(Double(m))) }
    _ = state.skipRest(at: minute(9))
    let half = state.logSet(weight: 40, reps: 12, at: minute(10))
    #expect(half?.outcome.restSeconds == nil && state.rest == nil)
    #expect(state.setInHand?.set.id == "c-s0")

    let skipped = state.skipSetInHand(at: minute(11), restId: "handed")
    #expect(skipped)
    let rest = try #require(state.rest)
    #expect(rest.id == "handed" && rest.seconds == 90 && rest.startedAt == minute(11))
    #expect(rest.upNext == UpNext(name: "Lift b", detail: "Set 2 of 3 · 40 × 12"))

    // Once: that rest over, moving about later starts nothing.
    let ranOut = state.restRanOut(id: "handed")
    let toFinished = state.go(toStation: 0, at: minute(14))
    let toOpen = state.go(toStation: 1, at: minute(14))
    #expect(ranOut && !toFinished && toOpen)
    #expect(state.rest == nil)
}

@Test func aSkipDuringARestSaysWhatIsNextNow() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Set 2 of 3 · 100 × 5"))
    let doneWith = state.skipStationInHand(at: minute(7))
    #expect(doneWith)
    #expect(state.rest?.upNext == UpNext(name: "Lift b", detail: "Dumbbell · 3 × 10"))
    // Back to the lift the rest followed: worded as its next set.
    let back = state.go(toStation: 0, at: minute(7))
    #expect(back)
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Set 2 of 3 · 100 × 5"))
}

@Test func aSkippedSetNeverHoldsBackTheLastSetCue() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    let skipped = state.skipSetInHand(at: minute(7))
    #expect(skipped)
    let last = state.logSet(weight: 100, reps: 5, at: minute(8))
    #expect(last?.lastOfExercise == true)
    #expect(last?.cue == .lastSetOfExercise)
}

@Test func nothingMovesWhileThePhoneLogs() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts")))
    state.apply(try context(sentAt: minute(6), live: snapshotObject("two straight lifts"), claim: ["workoutId": "w-1", "at": iso(minute(6))]))
    let skipped = state.skipSetInHand(at: minute(7))
    let doneWith = state.skipStationInHand(at: minute(7))
    let went = state.go(toStation: 1, at: minute(7))
    #expect(!skipped && !doneWith && !went)
    #expect(state.session?.skipped.isEmpty == true)
}
