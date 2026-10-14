import Foundation
import Testing
@testable import GymGoKit

// What "the same station" and "the first set of a lift today" mean on the
// wrist, when a session holds the same lift twice or a warm-up is logged.
// Rule 5 (`upNextFor`) compares stations, never lifts: CLAUDE.md, "Two
// entries can share a lift". The test macros capture their operands
// immutably, so every mutating call is made before its #expect.

private func named(_ name: String) throws -> WatchSnapshot { try decodeSnapshot(snapshotObject(name)) }

private func object(_ snapshot: WatchSnapshot) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as! [String: Any]
}

@discardableResult
private func log(_ session: inout WatchSession, _ weight: Double, _ reps: Int, at m: Double) throws -> LogOutcome {
    let outcome = session.logSetInHand(weight: weight, reps: reps, at: minute(m))
    return try #require(outcome)
}

/// Lift a × 3, then Lift a again × 2 (its own entry, a different outline),
/// then Lift b × 3: two adjacent stations share a lift.
private func sameLiftTwice() throws -> WatchSnapshot {
    var snapshot = try named("two straight lifts")
    let b = snapshot.stations[1]
    snapshot.stations = [snapshot.stations[0], WatchStation(name: "Lift a", outline: "Barbell · 2 × 8", exerciseIds: ["ex-a"]), b]
    let again: [WatchSet] = (0..<2).map { index in
        var set = snapshot.sets[index]
        set.id = "a2-s\(index)"
        set.workoutExerciseId = "a2"
        set.station = 1
        set.label = "Set \(index + 1) of 2"
        set.weight = 80
        set.reps = 8
        set.carries = false
        return set
    }
    for index in snapshot.sets.indices where snapshot.sets[index].station == 1 { snapshot.sets[index].station = 2 }
    snapshot.sets.insert(contentsOf: again, at: 3)
    return snapshot
}

// MARK: - Up next, by station

@Test func upNextJudgesTheStationNotTheLiftWhenALiftComesTwice() throws {
    var session = WatchSession(snapshot: try sameLiftTwice())
    try log(&session, 100, 5, at: 1)
    try log(&session, 100, 5, at: 4)
    let last = try log(&session, 100, 5, at: 7)
    // A new station, though the same lift: its name and outline, as the
    // phone's `upNextFor` words it.
    #expect(session.setInHand?.set.id == "a2-s0")
    #expect(last.upNext == UpNext(name: "Lift a", detail: "Barbell · 2 × 8"))
}

@Test func aMoveDuringARestJudgesTheStationNotTheLift() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: object(try sameLiftTwice())))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    _ = state.logSet(weight: 100, reps: 5, at: minute(9))
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Set 3 of 3 · 100 × 5"))
    // Skip the last set of the first entry: the rest now leads to the second.
    let skipped = state.skipSetInHand(at: minute(10))
    #expect(skipped)
    #expect(state.setInHand?.set.id == "a2-s0")
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Barbell · 2 × 8"))
    // And back: the station the rest followed again.
    let back = state.go(toStation: 0, at: minute(10))
    #expect(back)
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Set 3 of 3 · 100 × 5"))
}

@Test func aRestFindsItsStationAfterThePhoneConfirmsTheSetsItFollowed() throws {
    var state = WatchAppState()
    let snapshot = try sameLiftTwice()
    state.apply(try context(sentAt: minute(5), live: object(snapshot)))
    for m in [6.0, 9, 12] { _ = state.logSet(weight: 100, reps: 5, at: minute(m)) }
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Barbell · 2 × 8"))

    // The phone confirms the first entry's sets: they leave the list.
    var newer = snapshot
    newer.sentAt = iso(minute(12.5))
    newer.sets.removeAll { $0.workoutExerciseId == "a" }
    newer.lifts["ex-a"]!.doneToday = ["a-s0", "a-s1", "a-s2"].enumerated().map {
        DoneSet(setId: $1, weight: 100, reps: 5, completedAt: iso(minute(6 + 3 * Double($0))))
    }
    state.apply(try context(sentAt: minute(12.5), live: object(newer)))
    // Skipped on the wrist, mid-rest: still a new station from the one it followed.
    let skipped = state.skipSetInHand(at: minute(13))
    #expect(skipped)
    #expect(state.setInHand?.set.id == "a2-s1")
    #expect(state.rest?.upNext == UpNext(name: "Lift a", detail: "Barbell · 2 × 8"))
}

@Test func aRestSavedBeforeItNotedItsStationIsStillWorded() throws {
    // Build 7's first rests noted only the lift they followed.
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    var saved = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as! [String: Any]
    var rest = try #require(saved["rest"] as? [String: Any])
    #expect(rest["afterStation"] != nil)
    rest["afterStation"] = nil
    saved["rest"] = rest
    var restored = try JSONDecoder().decode(WatchAppState.self, from: JSONSerialization.data(withJSONObject: saved))
    let doneWith = restored.skipStationInHand(at: minute(7))
    #expect(doneWith)
    #expect(restored.rest?.upNext == UpNext(name: "Lift b", detail: "Dumbbell · 3 × 10"))
    let back = restored.go(toStation: 0, at: minute(7))
    #expect(back)
    #expect(restored.rest?.upNext == UpNext(name: "Lift a", detail: "Set 2 of 3 · 100 × 5"))
}

@Test func aFinishedStationHandsOnFromItselfWhenItsLiftComesTwice() throws {
    let original = try sameLiftTwice()
    var session = WatchSession(snapshot: original)
    session.go(toStation: 1)
    try log(&session, 80, 8, at: 1)
    try log(&session, 80, 8, at: 4)
    #expect(session.setInHand?.set.id == "b-s0")

    // The phone confirms the second entry's sets.
    var newer = original
    newer.sentAt = "2026-10-14T17:10:00.000Z"
    newer.sets.removeAll { $0.workoutExerciseId == "a2" }
    newer.lifts["ex-a"]!.doneToday = [
        DoneSet(setId: "a2-s0", weight: 80, reps: 8, completedAt: iso(minute(1))),
        DoneSet(setId: "a2-s1", weight: 80, reps: 8, completedAt: iso(minute(4))),
    ]
    let received = session.receive(newer)
    #expect(received == .updated)
    // On from the second entry, as the set in hand was: not back to the first.
    #expect(session.setInHand?.set.id == "b-s0")
}

// MARK: - The rest's Up next line on the wrist

@Test func theRestsUpNextKeepsANewStationsOutline() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts")))
    for m in [6.0, 9, 12] { _ = state.logSet(weight: 100, reps: 5, at: minute(m)) }
    let rest = try #require(state.rest)
    let next = try #require(state.setInHand)
    // A solo station's name is its lift's: the outline still stands, as the
    // state report, the companion and the Live Activity say it.
    #expect(rest.upNext == UpNext(name: "Lift b", detail: "Dumbbell · 3 × 10"))
    #expect(next.upNextDetail(after: rest) == "Dumbbell · 3 × 10")

    // The same station: what the set screen starts at now, which a newer
    // list may have moved since the rest began.
    var same = WatchAppState()
    same.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts")))
    _ = same.logSet(weight: 100, reps: 5, at: minute(6))
    let sameRest = try #require(same.rest)
    var moved = try #require(same.setInHand)
    moved.weight = 102.5
    #expect(moved.upNextDetail(after: sameRest) == "Set 2 of 3 · 102.5 × 5")
}

// MARK: - The first set of a lift today

@Test func aWarmUpLoggedOnTheWristMeansTheLiftIsNoLongerFirstToday() throws {
    // Lift b with a warm-up in front of its working sets.
    var snapshot = try named("two straight lifts")
    var warmUp = snapshot.sets[3]
    warmUp.id = "b-w0"
    warmUp.type = "warmup"
    warmUp.label = "Warm-up 1 of 1"
    warmUp.weight = 10
    warmUp.carries = false
    snapshot.sets.insert(warmUp, at: 3)
    var session = WatchSession(snapshot: snapshot)
    session.go(toStation: 1)
    #expect(session.setInHand?.set.id == "b-w0")
    #expect(session.setInHand?.firstOfLiftToday == true)

    try log(&session, 10, 10, at: 6)
    #expect(session.setInHand?.set.id == "b-s0")
    #expect(session.setInHand?.firstOfLiftToday == false)

    // The phone confirms the warm-up: off the list, and not in doneToday,
    // which holds working sets only. Still a set of this lift today.
    var newer = snapshot
    newer.sentAt = iso(minute(8))
    newer.sets.removeAll { $0.id == "b-w0" }
    let received = session.receive(newer)
    #expect(received == .updated)
    #expect(session.setInHand?.set.id == "b-s0")
    #expect(session.setInHand?.firstOfLiftToday == false)
}
