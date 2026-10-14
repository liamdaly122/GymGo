import Foundation
import Testing
@testable import GymGoKit

/// The Swift port of the watch's own rules, run over the cases the
/// TypeScript rules answered (fixtures/watch/, from scripts/watchFixtures.ts).
/// If the two sides ever disagree, these fail. Build 7's step-down,
/// `nextStation` and `upNextFor` have fixtures before their ports: until the
/// ports land, those files are only decoded here.

private let fixtures = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("fixtures/watch")

private func load<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(contentsOf: fixtures.appendingPathComponent(name)))
}

private struct Logged: Decodable {
    var weight: Double
    var reps: Int
    var type: String?
    var parent: Bool?
    var amrap: Bool?
    var at: String

    func asSet(_ id: String) -> LoggedSet {
        LoggedSet(setId: id, type: type ?? "working", isChild: parent ?? false, weight: weight, reps: reps, completedAt: WatchSession.date(at), isAmrap: amrap)
    }
}

private struct Numbers: Decodable, Equatable { var weight: Double; var reps: Int }

/// Rule 1. The first cases carry no range and no loading: the carry as it
/// was before build 7. The rest give `repLow`, `loading` and `ladder`, and a
/// case that steps down expects `stepped`.
private struct CarryCase: Decodable {
    struct Expected: Decodable {
        var weight: Double
        var reps: Int
        var stepped: Stepped?
        var numbers: Numbers { Numbers(weight: weight, reps: reps) }
    }
    struct Stepped: Decodable, Equatable { var from: Numbers; var repLow: Int }
    var name: String
    var logged: [Logged]
    var repLow: Int?
    var loading: LoadingProfile?
    var ladder: [Double]?
    /// `nextLoadableBelow` of the set carried, wherever the loading can step.
    var below: Double?
    var expected: Expected?
}

@Test func carryForwardMatchesTypeScript() throws {
    let cases = try load("carry.json", as: [CarryCase].self)
    #expect(cases.count > 5)
    for c in cases {
        // The step-down is ported by the watch-logic part of build 7, which
        // passes `repLow`, `loading` and `ladder` to `carriedSet` and drops
        // this skip. Until then the port carries as done, which is what every
        // case without `stepped` expects.
        if c.expected?.stepped != nil { continue }
        let carried = carriedSet(c.logged.enumerated().map { $1.asSet("s\($0)") })
        #expect(carried.map { Numbers(weight: $0.weight, reps: $0.reps) } == c.expected?.numbers, "\(c.name)")
    }
}

@Test func theStepDownCasesDecode() throws {
    let cases = try load("carry.json", as: [CarryCase].self)
    let stepped = cases.filter { $0.expected?.stepped != nil }
    #expect(stepped.count >= 10)
    for c in stepped {
        let expected = try #require(c.expected)
        let from = try #require(expected.stepped?.from)
        #expect(c.repLow != nil && c.loading != nil && c.ladder?.isEmpty == false, "\(c.name)")
        #expect(expected.weight < from.weight && expected.reps == c.repLow, "\(c.name)")
        #expect(c.below != nil, "\(c.name)")
    }
    // Every loading profile, and the cases that must carry unchanged.
    let modes = Set(cases.compactMap { $0.loading?.mode })
    #expect(modes == ["barbell", "fixed_step", "free"])
    #expect(cases.contains { $0.logged.contains { $0.amrap == true } && $0.expected?.stepped == nil })
}

@Test func theStationCasesDecode() throws {
    struct Case: Decodable { var name: String; var open: [Bool]; var from: Int; var expected: Int? }
    let cases = try load("stations.json", as: [Case].self)
    #expect(cases.count > 5)
    for c in cases {
        // Structure only: watch-logic ports `nextStation` and runs it here.
        #expect(c.open.indices.contains(c.from), "\(c.name)")
        if let expected = c.expected {
            #expect(expected != c.from && c.open.indices.contains(expected) && c.open[expected], "\(c.name)")
        }
    }
    #expect(cases.contains { $0.expected == nil })
}

@Test func theUpNextCasesDecode() throws {
    struct Next: Decodable { var station: Int; var name: String; var label: String; var weight: Double?; var reps: Int? }
    struct Case: Decodable { var name: String; var from: Int; var next: Next?; var stations: [WatchStation]; var expected: UpNext }
    let cases = try load("upnext.json", as: [Case].self)
    #expect(cases.count > 5)
    for c in cases {
        // Structure only: watch-logic ports `upNextFor` and runs it here.
        #expect(c.stations.indices.contains(c.from), "\(c.name)")
        if let next = c.next { #expect(c.stations.indices.contains(next.station), "\(c.name)") }
        #expect(!c.expected.name.isEmpty, "\(c.name)")
    }
    #expect(cases.contains { $0.next == nil && $0.expected == UpNext(name: "Finish", detail: "Last set done") })
}

@Test func backOffTargetMatchesTypeScript() throws {
    struct Case: Decodable {
        var name: String; var loading: LoadingProfile; var ladder: [Double]
        var top: Numbers; var steps: Int; var expected: Numbers; var roundedDown: Double
    }
    let cases = try load("scheme.json", as: [Case].self)
    #expect(cases.count > 5)
    for c in cases {
        let target = schemeTarget(top: (c.top.weight, c.top.reps), steps: c.steps, loading: c.loading, ladder: c.ladder)
        #expect(Numbers(weight: target.weight, reps: target.reps) == c.expected, "\(c.name)")
        #expect(loadableWeightDown(c.top.weight * 0.85, loading: c.loading, ladder: c.ladder) == c.roundedDown, "\(c.name): rounding")
    }
}

@Test func recordCheckMatchesTypeScript() throws {
    struct Case: Decodable { var name: String; var prior: RecordMarks?; var earlier: [Logged]; var set: Logged; var expected: SetRecord? }
    let cases = try load("records.json", as: [Case].self)
    #expect(cases.count > 5)
    for c in cases {
        let record = setBreaksRecord(c.set.asSet("now"), prior: c.prior, earlier: c.earlier.enumerated().map { $1.asSet("e\($0)") })
        #expect(record?.kind == c.expected?.kind, "\(c.name)")
        #expect(abs((record?.value ?? 0) - (c.expected?.value ?? 0)) < 1e-9, "\(c.name)")
        #expect(abs((record?.previous ?? 0) - (c.expected?.previous ?? 0)) < 1e-9, "\(c.name)")
    }
}

@Test func everySnapshotDecodes() throws {
    struct Case: Decodable { var name: String; var snapshot: WatchSnapshot }
    let cases = try load("snapshots.json", as: [Case].self)
    #expect(!cases.isEmpty)
    for c in cases {
        #expect(c.snapshot.version == WatchSnapshot.supportedVersion, "\(c.name)")
        #expect(!c.snapshot.sets.isEmpty, "\(c.name)")
        for set in c.snapshot.sets { #expect(c.snapshot.lifts[set.exerciseId] != nil, "\(c.name): \(set.id)") }
    }
    // Build 7's fields arrive: the plan, last time, the range, AMRAP, a step-down.
    let lifts = cases.flatMap { $0.snapshot.lifts.values }
    let sets = cases.flatMap(\.snapshot.sets)
    let bench = try #require(lifts.first { $0.lastTime != nil && $0.plan != nil })
    #expect(bench.plan == LiftPlan(kind: "add_weight", verb: "Go up", reason: "You hit 10 on every set at 97.5kg. Add 2.5kg."))
    #expect(bench.lastTime == LastTime(day: "2026-10-03", top: SetNumbers(weight: 97.5, reps: 8), sets: [97.5, 97.5, 97.5].enumerated().map { SetNumbers(weight: $1, reps: $0 == 2 ? 7 : 8) }))
    #expect(bench.repLow == 8)
    #expect(lifts.contains { $0.repLow == nil && $0.lastTime == nil })
    #expect(sets.contains { $0.amrap == true })
    #expect(sets.contains { $0.source == "stepped" })
    #expect(sets.filter { $0.amrap != nil }.allSatisfy { $0.amrap == true })
}

/// A snapshot from a build 6 phone, which has none of build 7's fields, still
/// decodes, and a session saved by build 6 restores with no focus and nothing skipped.
@Test func aBuild6SnapshotAndSessionStillDecode() throws {
    var object = try snapshotObject("two straight lifts")
    var lifts = try #require(object["lifts"] as? [String: [String: Any]])
    for key in lifts.keys {
        for field in ["plan", "lastTime", "repLow"] { lifts[key]?.removeValue(forKey: field) }
    }
    object["lifts"] = lifts
    let snapshot = try WatchSnapshot.decode(JSONSerialization.data(withJSONObject: object))
    #expect(snapshot.lifts.values.allSatisfy { $0.plan == nil && $0.lastTime == nil && $0.repLow == nil })

    let saved = try JSONSerialization.data(withJSONObject: ["snapshot": object, "logged": [
        "a-s0": ["setId": "a-s0", "type": "working", "isChild": false, "weight": 100, "reps": 5, "completedAt": 0],
    ]])
    let session = try JSONDecoder().decode(WatchSession.self, from: saved)
    #expect(session.focus == nil && session.skipped.isEmpty)
    #expect(session.remainingSets.count == snapshot.sets.count - 1)

    // And what this build saves reads back, the new fields with it.
    let again = try JSONDecoder().decode(WatchSession.self, from: JSONEncoder().encode(session))
    #expect(again == session)
}
