import Foundation
import Testing
@testable import GymGoKit

// Starting a planned session on the wrist, discarding it, finishing it with
// its sets inside, and taking a list for another workout.

private func ready(key: String = "plan-1:3:1", workoutId: String = "w-ready") throws -> WatchReady {
    try JSONDecoder().decode(WatchReady.self, from: JSONSerialization.data(withJSONObject: readyObject(key: key, workoutId: workoutId)))
}

@Test func startingFromTheReadySessionPutsTheStartFirstAndEchoesTheLayout() throws {
    let offered = try ready()
    let session = WatchSession.start(from: offered, at: minute(10), eventId: "start-1")
    #expect(session.snapshot.startedAt == iso(minute(10)))
    #expect(session.snapshot.workoutId == "w-ready")
    #expect(session.snapshot.sets == offered.snapshot.sets)
    #expect(session.outbox.count == 1)
    let event = try #require(session.outbox.first)
    #expect(event.id == "start-1")
    #expect(event.kind == .startWorkout)
    #expect(event.workoutId == "w-ready")
    #expect(event.routineId == "routine-1")
    #expect(event.layout == offered.layout)
    #expect(event.at == iso(minute(10)))
    #expect(session.setInHand?.set.id == "a-s0")
}

@Test func setsLoggedAfterAStartQueueBehindIt() throws {
    var session = WatchSession.start(from: try ready(), at: minute(10), eventId: "start-1")
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(11), eventId: "set-1")
    #expect(session.outbox.map(\.id) == ["start-1", "set-1"])
    #expect(session.outbox.map(\.kind) == [.startWorkout, .completeSet])
}

@Test func discardIsOnlyOfferedBeforeTheFirstSet() throws {
    var fresh = WatchSession.start(from: try ready(), at: minute(10), eventId: "start-1")
    #expect(fresh.canDiscard)
    let eventResult = fresh.discard(at: minute(11), eventId: "d-1")
    let event = try #require(eventResult)
    #expect(event == WatchEvent(id: "d-1", kind: .discard, workoutId: "w-ready", at: iso(minute(11))))
    #expect(fresh.discarded)
    #expect(fresh.setInHand == nil)
    #expect(fresh.discard(at: minute(12)) == nil)
    #expect(fresh.finish(at: minute(12)) == nil)

    var logged = WatchSession.start(from: try ready(), at: minute(10))
    _ = logged.logSetInHand(weight: 100, reps: 5, at: minute(11))
    #expect(!logged.canDiscard)
    #expect(logged.discard(at: minute(12)) == nil)
    // Still not once the phone has confirmed that set and the outbox is empty.
    logged.acknowledge(Set(logged.outbox.map(\.id)))
    #expect(logged.outbox.isEmpty)
    #expect(!logged.canDiscard)
}

@Test func discardIsNotOfferedOnceThePhoneHasLoggedASet() throws {
    var object = try snapshotObject("two straight lifts")
    var lifts = object["lifts"] as! [String: Any]
    var lift = lifts["ex-a"] as! [String: Any]
    lift["doneToday"] = [["setId": "a-s0", "weight": 100, "reps": 5, "completedAt": iso(minute(1))]]
    lifts["ex-a"] = lift
    object["lifts"] = lifts
    let session = WatchSession(snapshot: try decodeSnapshot(object))
    #expect(!session.canDiscard)
}

@Test func finishCarriesEveryUnconfirmedSetInOrder() throws {
    var session = WatchSession(snapshot: try decodeSnapshot(snapshotObject("two straight lifts")))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1), eventId: "s1")
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(4), eventId: "s2")
    session.skipRest(at: minute(5), eventId: "skip")
    _ = session.logSetInHand(weight: 100, reps: 4, at: minute(7), eventId: "s3")
    session.acknowledge(["s1"])

    let finishResult = session.finish(at: minute(9), eventId: "fin")

    let finish = try #require(finishResult)
    #expect(finish.kind == .finish)
    #expect(finish.sets?.map(\.id) == ["s2", "s3"])
    #expect(finish.sets?.allSatisfy { $0.kind == .completeSet && $0.workoutId == "w-1" } == true)
    #expect(session.outbox.map(\.id) == ["s2", "skip", "s3", "fin"])
    #expect(session.finished)
    #expect(session.finish(at: minute(10)) == nil)
}

@Test func finishWithEverythingConfirmedCarriesAnEmptyList() throws {
    var session = WatchSession(snapshot: try decodeSnapshot(snapshotObject("two straight lifts")))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1), eventId: "s1")
    session.acknowledge(["s1"])
    let finishResult = session.finish(at: minute(2))
    let finish = try #require(finishResult)
    #expect(finish.sets == [])
}

@Test func aListForAnotherWorkoutWaitsWhileEventsAreUnconfirmed() throws {
    var session = WatchSession(snapshot: try decodeSnapshot(snapshotObject("two straight lifts")))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1), eventId: "s1")
    let other = try decodeSnapshot(snapshotObject("two straight lifts", workoutId: "w-other", sentAt: iso(minute(6))))
    #expect(session.receive(other) == .ignored)
    #expect(session.workoutId == "w-1")

    session.acknowledge(["s1"])
    #expect(session.receive(other) == .replaced)
    #expect(session.workoutId == "w-other")
    #expect(session.logged.isEmpty && session.outbox.isEmpty && session.loggedHere.isEmpty)
}

@Test func theCountsSurviveThePhoneConfirmingSets() throws {
    let original = try decodeSnapshot(snapshotObject("two straight lifts"))
    var session = WatchSession(snapshot: original)
    #expect(session.progress == (0, 6))
    _ = session.logSetInHand(weight: 100, reps: 5, at: minute(1))
    _ = session.logSetInHand(weight: 102.5, reps: 5, at: minute(4))
    #expect(session.progress == (2, 6))
    #expect(session.progress(ofStation: 0) == (2, 3))
    #expect(session.progress(ofStation: 1) == (0, 3))
    #expect(session.records == 1)

    var newer = original
    newer.sentAt = iso(minute(6))
    newer.sets.removeFirst()
    newer.lifts["ex-a"]!.doneToday = [DoneSet(setId: "a-s0", weight: 100, reps: 5, completedAt: iso(minute(1)))]
    session.receive(newer)
    #expect(session.progress == (2, 6))
    #expect(session.progress(ofStation: 0) == (2, 3))
}

@Test func aSessionSavedByBuildFourStillLoads() throws {
    let snapshot = try JSONSerialization.data(withJSONObject: snapshotObject("two straight lifts"))
    let json = "{\"snapshot\":\(String(decoding: snapshot, as: UTF8.self)),\"logged\":{},\"outbox\":[],\"finished\":false}"
    let session = try JSONDecoder().decode(WatchSession.self, from: Data(json.utf8))
    #expect(session.workoutId == "w-1")
    #expect(!session.discarded && session.loggedHere.isEmpty && session.records == 0)
}
