import Foundation
import Testing
@testable import GymGoKit

private func snapshot(_ name: String) throws -> WatchSnapshot {
    struct Case: Decodable { var name: String; var snapshot: WatchSnapshot }
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("fixtures/watch/snapshots.json")
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
    return try #require(cases.first { $0.name == name }).snapshot
}

private let start = Date(timeIntervalSince1970: 1_791_997_200) // 14 Oct 2026, 17:00 UTC
private func minute(_ m: Double) -> Date { start.addingTimeInterval(m * 60) }

@Test func walksTheListInOrderAndRestsWhereThePhoneWould() throws {
    var session = WatchSession(snapshot: try snapshot("two straight lifts"))
    let first = try #require(session.setInHand)
    #expect(first.set.label == "Set 1 of 3")
    #expect(first.weight == 100 && first.reps == 5)
    #expect(first.position == 1 && first.remaining == 6)

    let outcome = try log(&session, weight: 100, reps: 5, at: minute(1), eventId: "e1")
    #expect(outcome.restSeconds == 150)
    #expect(outcome.upNext.detail == "Set 2 of 3 · 100 × 5")
    #expect(outcome.event == WatchEvent(id: "e1", kind: .completeSet, workoutId: "w-1", setId: "a-s0", weight: 100, reps: 5, at: WatchSession.isoString(minute(1))))
    #expect(session.setInHand?.set.label == "Set 2 of 3")
}

@Test func carriesTheSetJustDone() throws {
    var session = WatchSession(snapshot: try snapshot("two straight lifts"))
    _ = session.logSetInHand(weight: 102.5, reps: 4, at: minute(1))
    let next = try #require(session.setInHand)
    #expect(next.weight == 102.5 && next.reps == 4)
}

@Test func aBackOffAimsOffTheTopSetLoggedOnTheWrist() throws {
    var session = WatchSession(snapshot: try snapshot("a superset and a pyramid"))
    #expect(session.setInHand?.set.label == "Set 1 of 3")
    _ = session.logSetInHand(weight: 110, reps: 5, at: minute(1))
    let backOff = try #require(session.setInHand)
    #expect(backOff.set.label == "Set 2 of 3 · Back-off")
    // 10% off 110 is 99, down through the plates to 97.5, and two more reps.
    #expect(backOff.weight == 97.5 && backOff.reps == 7)
}

@Test func flashesARecordOnlyWhenOneIsBroken() throws {
    var session = WatchSession(snapshot: try snapshot("two straight lifts"))
    // The marks to beat are 100kg and an estimated 116.7kg.
    let tie = try log(&session, weight: 100, reps: 5, at: minute(1))
    #expect(tie.record == nil)
    let heavier = try log(&session, weight: 102.5, reps: 5, at: minute(4))
    #expect(heavier.record?.kind == .weight)
    // Beating it again has to beat today's 102.5 too.
    let same = try log(&session, weight: 102.5, reps: 5, at: minute(7))
    #expect(same.record == nil)
}

@Test func supersetRunsStraightIntoItsPartner() throws {
    var session = WatchSession(snapshot: try snapshot("a superset and a pyramid"))
    for m in 1...3 { _ = session.logSetInHand(weight: 100, reps: 5, at: minute(Double(m))) }
    let a1 = try #require(session.setInHand)
    #expect(a1.station.name == "Lift b + Lift c")
    let first = try log(&session, weight: 40, reps: 12, at: minute(5))
    #expect(first.restSeconds == nil)
    #expect(first.upNext.name == "Lift c")
    let second = try log(&session, weight: 25, reps: 15, at: minute(6))
    #expect(second.restSeconds == 90)
}

@Test func aNewerListFromThePhoneKeepsWhatItHasNotAppliedYet() throws {
    let original = try snapshot("two straight lifts")
    var session = WatchSession(snapshot: original)
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(4))

    // The phone has applied the first set, not yet the second.
    var newer = original
    newer.sentAt = "2026-10-14T17:06:00.000Z"
    newer.sets.removeFirst()
    newer.lifts["ex-a"]!.doneToday = [DoneSet(setId: "a-s0", weight: 100, reps: 5, completedAt: WatchSession.isoString(minute(1)))]
    session.receive(newer)

    #expect(session.logged.keys.sorted() == ["a-s1"])
    #expect(session.setInHand?.set.id == "a-s2")
}

@Test func anOlderListIsIgnored() throws {
    let original = try snapshot("two straight lifts")
    var session = WatchSession(snapshot: original)
    var older = original
    older.sentAt = "2026-10-14T17:01:00.000Z"
    older.sets = []
    session.receive(older)
    #expect(session.snapshot == original)
}

@Test func eventsLeaveTheOutboxOnceThePhoneHasThem() throws {
    var session = WatchSession(snapshot: try snapshot("two straight lifts"))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1), eventId: "e1")
    session.skipRest(at: minute(2), eventId: "e2")
    session.finish(at: minute(3), eventId: "e3")
    #expect(session.outbox.map(\.id) == ["e1", "e2", "e3"])
    #expect(session.setInHand == nil)
    session.acknowledge(["e1", "e2"])
    #expect(session.outbox.map(\.id) == ["e3"])
}

@Test func survivesARelaunch() throws {
    var session = WatchSession(snapshot: try snapshot("two straight lifts"))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1))
    let saved = try JSONEncoder().encode(session)
    let restored = try JSONDecoder().decode(WatchSession.self, from: saved)
    #expect(restored == session)
    #expect(restored.setInHand?.set.label == "Set 2 of 3")
}

/// Logs the set in hand and fails the test if there was none.
private func log(_ session: inout WatchSession, weight: Double, reps: Int, at date: Date, eventId: String = UUID().uuidString) throws -> LogOutcome {
    let outcome = session.logSetInHand(weight: weight, reps: reps, at: date, eventId: eventId)
    return try #require(outcome)
}
