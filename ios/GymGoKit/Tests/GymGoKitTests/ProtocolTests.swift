import Foundation
import Testing
@testable import GymGoKit

// JSON shaped exactly as src/domain/watchProtocol.ts writes it decodes into
// the Swift mirror, and what the watch writes reads back. The fixtures the
// TypeScript side writes (fixtures/watch/context.json, events.json) are decoded
// too: every object in them that has a context's or an event's keys.

@Test func aContextAsThePhoneSendsItDecodes() throws {
    let json = """
    {"v":1,"sentAt":"2026-10-14T17:05:00.000Z","live":null,
     "home":{"today":"2026-10-14","state":"ready","doneToday":[{"workoutId":"w-0","name":"Pull A"}],
       "closed":[{"workoutId":"w-0","how":"finished","at":"2026-10-14T08:00:00.000Z"},
                 {"workoutId":"w-9","how":"discarded","at":"2026-10-14T09:00:00.000Z"}],
       "ready":null,
       "week":[{"date":"2026-10-12","weekday":"Mon","state":"done","name":"Push A"},
               {"date":"2026-10-13","weekday":"Tue","state":"rest","name":null}]},
     "phoneClaim":{"workoutId":"w-1","at":"2026-10-14T17:04:00.000Z"},
     "settings":{"sound":false,"vibrate":true}}
    """
    let context = try WatchContext.decode(json)
    #expect(context.v == 1)
    #expect(context.live == nil)
    #expect(context.home.state == .ready)
    #expect(context.home.doneToday == [DoneWorkout(workoutId: "w-0", name: "Pull A")])
    #expect(context.home.closed.map(\.how) == [.finished, .discarded])
    #expect(context.home.week[1].name == nil)
    #expect(context.home.week[1].state == .rest)
    #expect(context.phoneClaim == PhoneClaim(workoutId: "w-1", at: "2026-10-14T17:04:00.000Z"))
    #expect(context.settings == WatchSettings(sound: false, vibrate: true))
}

@Test func aContextWithALiveWorkoutAndAReadySessionDecodes() throws {
    let context = try decodeContext(contextObject(
        live: try snapshotObject("a superset and a pyramid"),
        ready: try readyObject(movedFrom: "2026-10-12"),
        state: "running"
    ))
    #expect(context.live?.workoutId == "w-1")
    #expect(context.live?.stations.count == 2)
    let ready = try #require(context.home.ready)
    #expect(ready.movedFrom == "2026-10-12")
    #expect(ready.week == WatchReady.Week(week: 3, totalWeeks: 5, label: "Week 3 of 5"))
    #expect(ready.exercises[0].kit == "Barbell" && ready.exercises[1].badge == nil && ready.exercises[0].superset == nil)
    #expect(ready.status == .today)
    #expect(ready.snapshot.workoutId == "w-ready")
}

@Test func aContextFromANewerPhoneIsRefused() throws {
    var object = contextObject()
    object["v"] = 2
    #expect(throws: (any Error).self) { try decodeContext(object) }
}

@Test func eventsAsTheWatchWritesThemReadBack() throws {
    let set = WatchEvent(id: "s1", kind: .completeSet, workoutId: "w-1", setId: "a-s0", weight: 102.5, reps: 6, at: iso(minute(1)))
    let events = [
        WatchEvent(id: "st", kind: .startWorkout, workoutId: "w-1", at: iso(minute(0)), routineId: "r-1", layout: "{\"a\":[1,2]}"),
        set,
        WatchEvent(id: "sk", kind: .skipRest, workoutId: "w-1", at: iso(minute(2))),
        WatchEvent(id: "fi", kind: .finish, workoutId: "w-1", at: iso(minute(3)), sets: [set]),
        WatchEvent(id: "di", kind: .discard, workoutId: "w-2", at: iso(minute(4))),
    ]
    for event in events {
        let json = try event.json()
        #expect(try WatchEvent.decode(json) == event)
        let object = try #require(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        #expect(object["kind"] as? String == event.kind.rawValue)
    }
    let start = try #require(try JSONSerialization.jsonObject(with: Data(events[0].json().utf8)) as? [String: Any])
    #expect(start["layout"] as? String == "{\"a\":[1,2]}")
    #expect(start["routineId"] as? String == "r-1")
    let finish = try #require(try JSONSerialization.jsonObject(with: Data(events[3].json().utf8)) as? [String: Any])
    #expect((finish["sets"] as? [[String: Any]])?.first?["setId"] as? String == "a-s0")
}

@Test func eventsShapedAsTheTypeScriptTypesDecode() throws {
    let json = """
    [{"id":"e1","kind":"completeSet","workoutId":"w-1","at":"2026-10-14T17:01:00.000Z","setId":"a-s0","weight":102.5,"reps":6},
     {"id":"e2","kind":"startWorkout","workoutId":"w-1","at":"2026-10-14T17:00:00.000Z","setId":null,"weight":null,"reps":null,
      "routineId":"r-1","layout":"{}","sets":null},
     {"id":"e3","kind":"skipRest","workoutId":"w-1","at":"2026-10-14T17:02:00.000Z"},
     {"id":"e4","kind":"finish","workoutId":"w-1","at":"2026-10-14T17:30:00.000Z",
      "sets":[{"id":"e1","kind":"completeSet","workoutId":"w-1","at":"2026-10-14T17:01:00.000Z","setId":"a-s0","weight":102.5,"reps":6}]},
     {"id":"e5","kind":"discard","workoutId":"w-2","at":"2026-10-14T17:31:00.000Z"}]
    """
    let events = try JSONDecoder().decode([WatchEvent].self, from: Data(json.utf8))
    #expect(events.map(\.kind) == [.completeSet, .startWorkout, .skipRest, .finish, .discard])
    #expect(events[0].weight == 102.5 && events[0].reps == 6)
    #expect(events[1].setId == nil && events[1].layout == "{}")
    #expect(events[3].sets?.first == events[0])
}

// MARK: - The data builder's fixtures, when they exist

/// Every object anywhere in a JSON value that has all of these keys.
private func objects(in value: Any, with keys: Set<String>) -> [[String: Any]] {
    if let object = value as? [String: Any] {
        let here = keys.isSubset(of: Set(object.keys)) ? [object] : []
        return here + object.values.flatMap { objects(in: $0, with: keys) }
    }
    if let array = value as? [Any] { return array.flatMap { objects(in: $0, with: keys) } }
    return []
}

/// A fixture the TypeScript side writes (`npm run fixtures:watch`). Missing is
/// a failure: these tests are what holds the two sides of the contract together.
private func fixture(_ name: String) throws -> Any {
    let url = fixturesFolder.appendingPathComponent(name)
    return try JSONSerialization.jsonObject(with: Data(contentsOf: url))
}

@Test func theContextFixturesDecode() throws {
    let value = try fixture("context.json")
    let found = objects(in: value, with: ["v", "sentAt", "home", "settings"])
    #expect(!found.isEmpty, "context.json holds no context")
    for object in found {
        let context = try WatchContext.decode(JSONSerialization.data(withJSONObject: object))
        var state = WatchAppState()
        #expect(state.apply(context).applied)
        if let ready = context.home.ready {
            let started = WatchSession.start(from: ready, at: minute(0))
            #expect(started.outbox.first?.layout == ready.layout)
        }
    }
}

/// The state reports TypeScript types (fixtures/watch/state.json) decode, and
/// the watch writes each back exactly: every key, the same nulls, and
/// `rest.startedAt` left out where it is nil.
@Test func theStateFixturesDecodeAndWriteBackTheSame() throws {
    let cases = try #require(try fixture("state.json") as? [[String: Any]])
    #expect(cases.count >= 3)
    var reports: [String: WatchStateReport] = [:]
    for c in cases {
        let name = try #require(c["name"] as? String)
        let object = try #require(c["report"] as? [String: Any])
        let report = try JSONDecoder().decode(WatchStateReport.self, from: JSONSerialization.data(withJSONObject: object))
        let written = try #require(try JSONSerialization.jsonObject(with: Data(report.json().utf8)) as? [String: Any])
        #expect(NSDictionary(dictionary: written) == NSDictionary(dictionary: object), "\(name)")
        reports[name] = report
    }
    let full = try #require(reports.first { $0.key.hasPrefix("every field") }?.value)
    #expect(full.session == .running)
    #expect(full.inHand == WatchStateReport.InHand(name: "Lift a", detail: "Set 3 of 3 · 100 × 5"))
    #expect(full.rest?.startedAt == "2026-10-14T17:30:30.000Z")
    #expect(full.skipped == ["a-s1", "b-s2"])
    #expect(full.paused == "2026-10-14T17:31:00.000Z")
    let quiet = try #require(reports.first { $0.key.hasPrefix("running with nothing new") }?.value)
    #expect(quiet.skipped.isEmpty && quiet.paused == nil && quiet.inHand == nil)
    #expect(quiet.rest != nil && quiet.rest?.startedAt == nil)
}

@Test func theEventFixturesDecode() throws {
    let value = try fixture("events.json")
    let found = objects(in: value, with: ["id", "kind", "workoutId", "at"])
    #expect(!found.isEmpty, "events.json holds no event")
    for object in found {
        let event = try JSONDecoder().decode(WatchEvent.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(!event.id.isEmpty)
    }
}
