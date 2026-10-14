import Foundation
@testable import GymGoKit

// Shared by the tests: the fixtures the TypeScript side writes, and contexts
// shaped exactly as the phone sends them.

let fixturesFolder = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("fixtures/watch")

/// A snapshot from fixtures/watch/snapshots.json, as JSON.
func snapshotObject(_ name: String) throws -> [String: Any] {
    let data = try Data(contentsOf: fixturesFolder.appendingPathComponent("snapshots.json"))
    let cases = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
    guard let found = cases.first(where: { $0["name"] as? String == name })?["snapshot"] as? [String: Any] else {
        throw CocoaError(.fileReadCorruptFile)
    }
    return found
}

/// The same snapshot under another workout ID, sent at another time.
func snapshotObject(_ name: String, workoutId: String, sentAt: String? = nil) throws -> [String: Any] {
    var object = try snapshotObject(name)
    object["workoutId"] = workoutId
    if let sentAt { object["sentAt"] = sentAt }
    return object
}

func decodeSnapshot(_ object: [String: Any]) throws -> WatchSnapshot {
    try JSONDecoder().decode(WatchSnapshot.self, from: JSONSerialization.data(withJSONObject: object))
}

let base = Date(timeIntervalSince1970: 1_791_997_200) // Wed 14 Oct 2026, 17:00 UTC
func minute(_ m: Double) -> Date { base.addingTimeInterval(m * 60) }
func iso(_ date: Date) -> String { WatchSession.isoString(date) }
let london = TimeZone(identifier: "Europe/London")!

/// A ready session as `home.ready`, in the phone's JSON shape.
func readyObject(
    key: String = "plan-1:3:1", workoutId: String = "w-ready", date: String = "2026-10-14",
    status: String = "today", movedFrom: Any = NSNull(), sentAt: String = "2026-10-14T17:05:00.000Z"
) throws -> [String: Any] {
    [
        "key": key,
        "routineId": "routine-1",
        "name": "Push A",
        "date": date,
        "status": status,
        "movedFrom": movedFrom,
        "week": ["week": 3, "totalWeeks": 5, "label": "Week 3 of 5"],
        "minutes": 55,
        "exercises": [
            ["name": "Lift a", "kit": "Barbell", "work": "3 × 5", "badge": "Main", "superset": NSNull()],
            ["name": "Lift b", "kit": "Dumbbell", "work": "3 × 10", "badge": NSNull(), "superset": NSNull()],
        ],
        "layout": "{\"workoutId\":\"\(workoutId)\",\"exercises\":[]}",
        "snapshot": try snapshotObject("two straight lifts", workoutId: workoutId, sentAt: sentAt),
    ]
}

/// A whole context, as the phone sends it: every nullable key present.
func contextObject(
    sentAt: Date = minute(5), live: Any = NSNull(), ready: Any = NSNull(),
    state: String? = nil, today: String = "2026-10-14",
    doneToday: [[String: Any]] = [], closed: [[String: Any]] = [],
    claim: Any = NSNull(), vibrate: Bool = true
) -> [String: Any] {
    let derived = state ?? (live is NSNull ? (ready is NSNull ? "noPlan" : "ready") : "running")
    return [
        "v": 1,
        "sentAt": iso(sentAt),
        "live": live,
        "home": [
            "today": today,
            "state": derived,
            "doneToday": doneToday,
            "closed": closed,
            "ready": ready,
            "week": [
                ["date": "2026-10-12", "weekday": "Mon", "state": "done", "name": "Push A"],
                ["date": "2026-10-13", "weekday": "Tue", "state": "rest", "name": NSNull()],
                ["date": "2026-10-14", "weekday": "Wed", "state": "today", "name": "Pull A"],
                ["date": "2026-10-15", "weekday": "Thu", "state": "rest", "name": NSNull()],
                ["date": "2026-10-16", "weekday": "Fri", "state": "planned", "name": "Legs A"],
                ["date": "2026-10-17", "weekday": "Sat", "state": "rest", "name": NSNull()],
                ["date": "2026-10-18", "weekday": "Sun", "state": "rest", "name": NSNull()],
            ],
        ] as [String: Any],
        "phoneClaim": claim,
        "settings": ["sound": true, "vibrate": vibrate],
    ]
}

func decodeContext(_ object: [String: Any]) throws -> WatchContext {
    try WatchContext.decode(JSONSerialization.data(withJSONObject: object))
}

func context(
    sentAt: Date = minute(5), live: [String: Any]? = nil, ready: [String: Any]? = nil,
    state: String? = nil, today: String = "2026-10-14", doneToday: [[String: Any]] = [],
    closed: [[String: Any]] = [], claim: [String: Any]? = nil, vibrate: Bool = true
) throws -> WatchContext {
    try decodeContext(contextObject(
        sentAt: sentAt, live: live ?? NSNull(), ready: ready ?? NSNull(), state: state, today: today,
        doneToday: doneToday, closed: closed, claim: claim ?? NSNull(), vibrate: vibrate
    ))
}
