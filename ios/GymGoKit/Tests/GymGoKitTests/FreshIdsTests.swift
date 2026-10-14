import Foundation
import Testing
@testable import GymGoKit

// A start discarded on the wrist can start again with the phone locked: the
// watch lays the same session out under IDs it mints itself, in the layout
// it echoes to the phone and the snapshot it runs, alike.

/// The context the TypeScript side writes with a session ready to start: a
/// real layout, as `planRoutineStart` lays it out.
private func readyContext() throws -> WatchContext {
    let data = try Data(contentsOf: fixturesFolder.appendingPathComponent("context.json"))
    let cases = try #require(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    let found = try #require(cases.first { ($0["context"] as? [String: Any]).flatMap { ($0["home"] as? [String: Any])?["ready"] as? [String: Any] } != nil })
    return try WatchContext.decode(JSONSerialization.data(withJSONObject: found["context"]!))
}

private func layoutObject(_ ready: WatchReady) throws -> [String: Any] {
    try #require(try JSONSerialization.jsonObject(with: Data(ready.layout.utf8)) as? [String: Any])
}

/// The shape `crypto.randomUUID` writes and the phone's `parseStartLayout` accepts.
private func isUUIDv4(_ id: String) -> Bool {
    id.wholeMatch(of: /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/) != nil
}

@Test func theWatchMintsTheIdsALowercaseVersionFourUuid() {
    for _ in 0..<20 {
        #expect(isUUIDv4(WatchReady.newId()))
    }
}

@Test func theOffersMintedIdsAreTheWorkoutItsExercisesAndTheirSets() throws {
    let ready = try #require(try readyContext().home.ready)
    let minted = try #require(ready.mintedIds)
    // One workout, three exercises, four sets each.
    #expect(minted.count == 1 + 3 + 12)
    #expect(minted.first == ready.snapshot.workoutId)
    #expect(Set(minted).count == minted.count)
    for set in ready.snapshot.sets {
        #expect(minted.contains(set.id) && minted.contains(set.workoutExerciseId))
    }
}

@Test func freshIdsReplaceEveryMintedIdEverywhereAndShareNone() throws {
    let ready = try #require(try readyContext().home.ready)
    let old = try #require(ready.mintedIds)
    let freshResult = ready.withFreshIds()
    let fresh = try #require(freshResult)
    let new = try #require(fresh.mintedIds)

    // As many, all new, none shared, each the shape the phone accepts.
    #expect(new.count == old.count)
    #expect(Set(new).count == new.count)
    #expect(Set(new).isDisjoint(with: Set(old)))
    for id in new { #expect(isUUIDv4(id), "\(id)") }

    // No old ID is left anywhere, in the layout or the snapshot.
    let snapshotJSON = String(decoding: try JSONEncoder().encode(fresh.snapshot), as: UTF8.self)
    for id in old {
        #expect(!fresh.layout.contains(id), "\(id) left in the layout")
        #expect(!snapshotJSON.contains(id), "\(id) left in the snapshot")
    }

    // The layout and the snapshot agree, row for row.
    #expect(fresh.snapshot.workoutId == new.first)
    let layout = try layoutObject(fresh)
    #expect(layout["workoutId"] as? String == fresh.snapshot.workoutId)
    let exercises = try #require(layout["exercises"] as? [[String: Any]])
    let setsOf = Dictionary(uniqueKeysWithValues: exercises.map { exercise in
        (exercise["id"] as! String, (exercise["sets"] as! [[String: Any]]).map { $0["id"] as! String })
    })
    for set in fresh.snapshot.sets {
        #expect(setsOf[set.workoutExerciseId]?.contains(set.id) == true, "\(set.id)")
    }
    // Position for position, the same rows renamed.
    let pairs = Dictionary(uniqueKeysWithValues: zip(old, new).map { ($0, $1) })
    for (before, after) in zip(ready.snapshot.sets, fresh.snapshot.sets) {
        #expect(pairs[before.id] == after.id)
        #expect(pairs[before.workoutExerciseId] == after.workoutExerciseId)
    }

    // Everything else is the same session: the routine, the gym, the slot,
    // the library exercises, the sets' types, the numbers.
    let before = try layoutObject(ready)
    #expect(layout["routineId"] as? String == before["routineId"] as? String)
    #expect(layout["gymId"] as? String == before["gymId"] as? String)
    #expect((layout["slot"] as? [String: Any])?["planId"] as? String == (before["slot"] as? [String: Any])?["planId"] as? String)
    #expect((layout["slot"] as? [String: Any])?["week"] as? Int == 2)
    let beforeExercises = try #require(before["exercises"] as? [[String: Any]])
    #expect(exercises.map { $0["exerciseId"] as? String } == beforeExercises.map { $0["exerciseId"] as? String })
    #expect(exercises.map { $0["tempo"] as? String } == beforeExercises.map { $0["tempo"] as? String })
    #expect(exercises.map { $0["restSeconds"] as? Int } == beforeExercises.map { $0["restSeconds"] as? Int })
    #expect(exercises.map { ($0["sets"] as! [[String: Any]]).map { $0["type"] as? String } }
        == beforeExercises.map { ($0["sets"] as! [[String: Any]]).map { $0["type"] as? String } })
    #expect(fresh.snapshot.sets.map(\.label) == ready.snapshot.sets.map(\.label))
    #expect(fresh.snapshot.sets.map(\.weight) == ready.snapshot.sets.map(\.weight))
    #expect(fresh.snapshot.lifts == ready.snapshot.lifts)
    #expect(fresh.key == ready.key && fresh.routineId == ready.routineId && fresh.exercises == ready.exercises)
}

@Test func aSchemeAndAChildFollowTheirSetsNewIds() throws {
    var ready = try #require(try readyContext().home.ready)
    // A back-off aiming off the first set, and a drop hanging off it.
    let top = ready.snapshot.sets[0].id
    ready.snapshot.sets[1].scheme = SchemeLink(stepsFromTop: 1, topSetId: top)
    ready.snapshot.sets[2].parentSetId = top
    var counter = 0
    let freshResult = ready.withFreshIds {
        counter += 1
        return String(format: "00000000-0000-4000-8000-%012d", 100 + counter)
    }
    let fresh = try #require(freshResult)
    #expect(fresh.snapshot.sets[1].scheme?.topSetId == fresh.snapshot.sets[0].id)
    #expect(fresh.snapshot.sets[2].parentSetId == fresh.snapshot.sets[0].id)
    #expect(fresh.snapshot.workoutId == "00000000-0000-4000-8000-000000000101")
}

@Test func aLayoutThatDoesNotAccountForTheSnapshotIsNotLaidOutAgain() throws {
    var ready = try #require(try readyContext().home.ready)
    ready.layout = "{\"workoutId\":\"\(ready.snapshot.workoutId)\",\"exercises\":[]}"
    #expect(ready.mintedIds == nil)
    #expect(ready.withFreshIds() == nil)
    ready.layout = "not json"
    #expect(ready.withFreshIds() == nil)
    // A generator that repeats itself is refused rather than sharing an ID.
    let good = try #require(try readyContext().home.ready)
    #expect(good.withFreshIds { "00000000-0000-4000-8000-000000000999" } == nil)
}

// MARK: - Nothing of the discarded workout's rows survives, in any field (W7)

/// Every string in a JSON value, keys included, however deep.
private func strings(in value: Any) -> [String] {
    switch value {
    case let string as String: [string]
    case let array as [Any]: array.flatMap(strings(in:))
    case let object as [String: Any]: Array(object.keys) + object.values.flatMap(strings(in:))
    default: []
    }
}

/// Any UUID, whatever its version: the shape every row ID has.
private func isUUID(_ string: String) -> Bool {
    string.wholeMatch(of: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/) != nil
}

@Test func aStartAgainLeavesNoIdOfTheDiscardedWorkoutAnywhere() throws {
    // Every ready offer the TypeScript side writes: a field the phone adds to
    // the layout shows up here without anyone touching this test.
    let data = try Data(contentsOf: fixturesFolder.appendingPathComponent("context.json"))
    let cases = try #require(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    var checked = 0
    for found in cases {
        let name = found["name"] as? String ?? "?"
        guard let object = found["context"] as? [String: Any],
              (object["home"] as? [String: Any])?["ready"] is [String: Any] else { continue }
        let ready = try #require(try WatchContext.decode(JSONSerialization.data(withJSONObject: object)).home.ready, "\(name)")
        let old = Set(try #require(ready.mintedIds, "\(name)"))
        let before = try layoutObject(ready)

        // The rows that exist already, which the session points at and a
        // start again keeps: the routine, the gym, the plan and the library
        // exercises.
        let slot = before["slot"] as? [String: Any]
        let beforeExercises = try #require(before["exercises"] as? [[String: Any]], "\(name)")
        let kept = [before["routineId"] as? String, before["gymId"] as? String, slot?["planId"] as? String].compactMap { $0 }
            + beforeExercises.compactMap { $0["exerciseId"] as? String }

        // Every ID in the layout is one the watch re-mints or one of those. A
        // new ID field is neither until it is added to `LayoutIds`, or here.
        for string in strings(in: before) where isUUID(string) {
            #expect(old.contains(string) || kept.contains(string), "\(name): \(string) in the layout is neither re-minted nor kept")
        }

        let freshResult = ready.withFreshIds()
        let fresh = try #require(freshResult, "\(name)")
        let after = try layoutObject(fresh)
        let snapshotAfter = try JSONSerialization.jsonObject(with: JSONEncoder().encode(fresh.snapshot))
        let everywhere = strings(in: after) + strings(in: snapshotAfter)
        // No string anywhere is the discarded workout's, or one of its
        // exercises' or sets'.
        for string in everywhere where old.contains(string) {
            Issue.record("\(name): \(string) of the discarded workout is left")
        }

        // The rows that exist already are the same rows, in the same places.
        let afterSlot = after["slot"] as? [String: Any]
        let afterExercises = try #require(after["exercises"] as? [[String: Any]], "\(name)")
        #expect(after["routineId"] as? String == before["routineId"] as? String, "\(name)")
        #expect(after["gymId"] as? String == before["gymId"] as? String, "\(name)")
        #expect(afterSlot?["planId"] as? String == slot?["planId"] as? String, "\(name)")
        #expect(afterExercises.map { $0["exerciseId"] as? String } == beforeExercises.map { $0["exerciseId"] as? String }, "\(name)")
        #expect(fresh.routineId == ready.routineId, "\(name)")
        #expect(fresh.snapshot.sets.map(\.exerciseId) == ready.snapshot.sets.map(\.exerciseId), "\(name)")
        #expect(fresh.snapshot.stations == ready.snapshot.stations, "\(name)")
        #expect(fresh.snapshot.lifts == ready.snapshot.lifts, "\(name)")
        checked += 1
    }
    #expect(checked > 0)
}

// MARK: - On the wrist

@Test func aStartDiscardedOnTheWristStartsAgainUnderNewIds() throws {
    var state = WatchAppState()
    state.apply(try readyContext())
    let offer = try #require(state.home?.ready)
    let firstResult = state.start(offer, at: minute(6), eventId: "start-1")
    let first = try #require(firstResult)
    _ = state.discard(at: minute(7), eventId: "discard-1")

    // The phone is locked: the same offer, with the discarded workout's IDs.
    let card = state.todayCard(now: minute(8), timeZone: london)
    #expect(card.canStart)
    #expect(card.startLabel == "Start")
    let againResult = state.start(offer, at: minute(8), eventId: "start-2")
    let again = try #require(againResult)

    #expect(again.workoutId != first.workoutId)
    #expect(isUUIDv4(again.workoutId))
    #expect(state.session?.workoutId == again.workoutId)
    let echoed = try #require(again.layout)
    let layout = try #require(try JSONSerialization.jsonObject(with: Data(echoed.utf8)) as? [String: Any])
    #expect(layout["workoutId"] as? String == again.workoutId)
    for id in try #require(offer.mintedIds) {
        #expect(!(again.layout ?? "").contains(id))
        #expect(!(state.session?.snapshot.sets.contains { $0.id == id || $0.workoutExerciseId == id } ?? true))
    }
    // The phone gets all three, in order: the start, its discard, the new start.
    #expect(state.unconfirmed.map(\.id) == ["start-1", "discard-1", "start-2"])
    #expect(state.usedReadyKeys == [offer.key])

    // Logging goes to the new set IDs.
    let loggedResult = state.logSet(weight: 60, reps: 8, at: minute(9), eventId: "set-1")
    let logged = try #require(loggedResult)
    #expect(logged.outcome.event.workoutId == again.workoutId)
    #expect(!(offer.mintedIds ?? []).contains(logged.outcome.event.setId ?? ""))
}

@Test func everyStartAgainHasItsOwnIds() throws {
    var state = WatchAppState()
    state.apply(try readyContext())
    let offer = try #require(state.home?.ready)
    var seen = Set(try #require(offer.mintedIds))
    _ = state.start(offer, at: minute(6))
    for round in 0..<3 {
        _ = state.discard(at: minute(Double(7 + 2 * round)))
        _ = state.start(offer, at: minute(Double(8 + 2 * round)))
        let session = try #require(state.session)
        let ids = [session.workoutId] + session.snapshot.sets.flatMap { [$0.id, $0.workoutExerciseId] }
        let fresh = Set(ids)
        #expect(fresh.isDisjoint(with: seen))
        seen.formUnion(fresh)
    }
}

@Test func aPhoneStartedWorkoutDiscardedOnTheWristSaysSoNotDone() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(minute(5)))))
    _ = state.discard(at: minute(6))
    // The phone is locked: its last context still has the workout open.
    let card = state.todayCard(now: minute(7), timeZone: london)
    #expect(card.kind == .discarded)
    #expect(card.heading == "Discarded")
    #expect(card.message?.contains("saves") == false)

    // Finished here instead, it waits to save.
    var finished = WatchAppState()
    finished.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(minute(5)))))
    _ = finished.logSet(weight: 100, reps: 5, at: minute(6))
    _ = finished.finish(at: minute(7))
    #expect(finished.todayCard(now: minute(8), timeZone: london).kind == .waitingForPhone)
}
