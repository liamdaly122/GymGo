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

/// The superset station with b-s0 logged on the wrist and confirmed by the
/// phone: gone from the list, and in Lift b's `doneToday`.
private func confirmingTheFirstHalf(at sentAt: Date) throws -> WatchContext {
    var object = try snapshotObject("a superset and a pyramid")
    object["sentAt"] = iso(sentAt)
    object["sets"] = (object["sets"] as! [[String: Any]]).filter { $0["id"] as! String != "b-s0" }
    var lifts = object["lifts"] as! [String: Any]
    var liftB = lifts["ex-b"] as! [String: Any]
    liftB["doneToday"] = [["setId": "b-s0", "weight": 40, "reps": 12, "completedAt": iso(minute(10))]]
    lifts["ex-b"] = liftB
    object["lifts"] = lifts
    return try context(sentAt: sentAt, live: object)
}

/// The superset first, its first half logged and its Undo window closed.
private func firstHalfLogged() throws -> WatchAppState {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("a superset and a pyramid")))
    _ = state.go(toStation: 1, at: minute(6))
    let half = state.logSet(weight: 40, reps: 12, at: minute(10))
    #expect(half?.outcome.restSeconds == nil && state.rest == nil)
    let closed = state.closeUndo()
    let held = try #require(closed)
    state.acknowledge([held.id])
    return state
}

@Test func skippingThePartnerStartsItsRestAfterThePhoneConfirmedTheFirstHalf() throws {
    var state = try firstHalfLogged()
    // The phone, awake, applies the set and sends a newer list without it.
    let applied = state.apply(try confirmingTheFirstHalf(at: minute(10.2)))
    #expect(applied.updated)
    #expect(state.setInHand?.set.id == "c-s0")

    let skipped = state.skipSetInHand(at: minute(11), restId: "handed")
    #expect(skipped)
    let rest = try #require(state.rest)
    #expect(rest.id == "handed" && rest.seconds == 90 && rest.startedAt == minute(11))
    #expect(rest.upNext == UpNext(name: "Lift b", detail: "Set 2 of 3 · 40 × 12"))
    // Once.
    #expect(state.handOffFrom == nil)
}

@Test func doneWithThisLiftStartsThePartnersRestAfterThePhoneConfirmedTheFirstHalf() throws {
    var state = try firstHalfLogged()
    state.apply(try confirmingTheFirstHalf(at: minute(10.2)))

    let doneWith = state.skipStationInHand(at: minute(11), restId: "handed")
    #expect(doneWith)
    let rest = try #require(state.rest)
    #expect(rest.id == "handed" && rest.seconds == 90)
    #expect(rest.upNext == UpNext(name: "Lift a", detail: "Barbell · 3 × 5"))
    #expect(state.setInHand?.set.id == "a-s0")
}

@Test func anUndoneSetGivesTheHandOffBackToTheSetBeforeIt() throws {
    var state = try firstHalfLogged()
    // The partner logged, then taken back: skipping it now hands the first
    // half's rest on, as it would have before.
    _ = state.logSet(weight: 25, reps: 15, at: minute(11))
    #expect(state.handOffFrom == nil && state.rest?.seconds == 90)
    _ = state.undoLastSet(at: minute(11.05))
    #expect(state.rest == nil && state.handOffFrom == "c-s0")
    let skipped = state.skipSetInHand(at: minute(12))
    #expect(skipped && state.rest?.seconds == 90)
}

@Test func aFirstHalfBroughtBackAfterItsPartnerWasDoneRestsAsThePartner() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("a superset and a pyramid")))
    _ = state.go(toStation: 1, at: minute(6))
    // Lift b's machine is busy: its first set is skipped, the rest done.
    _ = state.skipSetInHand(at: minute(6))
    for m in 7...11 {
        _ = state.skipRest(at: minute(Double(m)))
        _ = state.logSet(weight: 40, reps: 12, at: minute(Double(m)))
    }
    _ = state.skipRest(at: minute(12))
    #expect(state.session?.stationProgress(1) == StationProgress(done: 5, left: 0, skipped: 1))
    // Brought back from This session, and logged: the partner's rest, not
    // straight on to the next lift.
    let back = state.go(toStation: 1, at: minute(13))
    #expect(back && state.setInHand?.set.id == "b-s0")
    let result = state.logSet(weight: 40, reps: 12, at: minute(14))
    let logged = try #require(result)
    #expect(logged.outcome.set.restAfter == nil)
    #expect(logged.outcome.restSeconds == 90)
    #expect(state.rest?.seconds == 90)
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Barbell · 3 × 5"))

    // A first half whose partner is still to do still goes straight on.
    var inOrder = WatchAppState()
    inOrder.apply(try context(sentAt: minute(5), live: snapshotObject("a superset and a pyramid")))
    _ = inOrder.go(toStation: 1, at: minute(6))
    let half = inOrder.logSet(weight: 40, reps: 12, at: minute(7))
    #expect(half?.outcome.restSeconds == nil && inOrder.rest == nil)
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

@Test func aRestSaysWhatIsNextAfterThePhoneMovesAnExerciseEarlier() throws {
    let original = try snapshotObject("a plan, last time, a step down and an AMRAP set")
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: original))
    _ = state.logSet(weight: 90, reps: 8, at: minute(6))
    _ = state.skipRest(at: minute(7))
    _ = state.logSet(weight: 90, reps: 8, at: minute(8))
    #expect(state.rest?.upNext == UpNext(name: "Incline Dumbbell Press", detail: "Dumbbell · 3 × 8–12"))

    // The incline bench is taken: on the companion, Move earlier on the pull-ups.
    var moved = original
    var stations = moved["stations"] as! [[String: Any]]
    stations.swapAt(1, 2)
    moved["stations"] = stations
    let sets = (moved["sets"] as! [[String: Any]]).map { set -> [String: Any] in
        var set = set
        set["station"] = set["exerciseId"] as! String == "ex-c" ? 1 : set["exerciseId"] as! String == "ex-b" ? 2 : 0
        return set
    }
    moved["sets"] = sets.filter { $0["station"] as! Int == 0 } + sets.filter { $0["station"] as! Int == 1 }
        + sets.filter { $0["station"] as! Int == 2 }
    moved["sentAt"] = iso(minute(8.5))
    let applied = state.apply(try context(sentAt: minute(8.5), live: moved))
    #expect(applied.updated)
    #expect(state.setInHand?.lift.name == "Pull-up")
    #expect(state.rest?.upNext == UpNext(name: "Pull-up", detail: "Bodyweight · 2 × 6–10"))
    // What the phone and the Live Activity hear.
    let report = state.report(at: minute(8.6), heartRate: nil, activeKcal: nil, health: .recording)
    #expect(report.rest?.upNext == UpNext(name: "Pull-up", detail: "Bodyweight · 2 × 6–10"))
}

@Test func aRestSaysWhatIsNextAfterThePhoneAddsASet() throws {
    let original = try snapshotObject("two straight lifts")
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: original))
    for m in 6...8 {
        _ = state.skipRest(at: minute(Double(m)))
        _ = state.logSet(weight: 100, reps: 5, at: minute(Double(m)))
    }
    #expect(state.rest?.upNext == UpNext(name: "Lift b", detail: "Dumbbell · 3 × 10"))

    // Add set on the lift just finished, mid-rest.
    var added = original
    var sets = added["sets"] as! [[String: Any]]
    var extra = sets[2]
    extra["id"] = "a-s3"
    extra["label"] = "Set 4 of 4"
    sets.insert(extra, at: 3)
    added["sets"] = sets
    added["sentAt"] = iso(minute(8.5))
    state.apply(try context(sentAt: minute(8.5), live: added))
    #expect(state.setInHand?.set.id == "a-s3")
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Set 4 of 4 · 100 × 5"))
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

/// "Two straight lifts" with Lift a's first set made a warm-up, which never
/// rests by the phone's rule (`restsAfterSet`).
private func withWarmUp() throws -> [String: Any] {
    var object = try snapshotObject("two straight lifts")
    guard var sets = object["sets"] as? [[String: Any]],
          let index = sets.firstIndex(where: { ($0["id"] as? String) == "a-s0" }) else {
        throw CocoaError(.fileReadCorruptFile)
    }
    sets[index]["type"] = "warmup"
    sets[index]["restAfter"] = NSNull()
    object["sets"] = sets
    return object
}

@Test func aWarmUpHandsNoRestOnWhenTheFirstWorkingSetIsSkipped() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: withWarmUp()))
    #expect(state.setInHand?.set.id == "a-s0")
    _ = state.logSet(weight: 60, reps: 5, at: minute(6))
    #expect(state.rest == nil)
    // The bar is taken: skip working set 1. A warm-up rests by no rule, so
    // nothing is handed on.
    _ = state.skipSetInHand(at: minute(7))
    #expect(state.rest == nil)
}

@Test func aWarmUpBroughtBackRestsNotAsTheWorkingSetsAfterIt() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: withWarmUp()))
    _ = state.skipSetInHand(at: minute(6))
    for m in 7...9 {
        _ = state.skipRest(at: minute(Double(m)))
        _ = state.logSet(weight: 100, reps: 5, at: minute(Double(m)))
    }
    _ = state.skipRest(at: minute(10))
    let back = state.go(toStation: 0, at: minute(11))
    #expect(back && state.setInHand?.set.id == "a-s0")
    let logged = state.logSet(weight: 60, reps: 5, at: minute(12))
    let result = try #require(logged)
    #expect(result.outcome.restSeconds == nil)
    #expect(state.rest == nil)
}
