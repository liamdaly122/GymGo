import Foundation
import Testing
@testable import GymGoKit

/// The Swift port of the watch's three rules, run over the cases the
/// TypeScript rules answered (fixtures/watch/, from scripts/watchFixtures.ts).
/// If the two sides ever disagree, these fail.

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
    var at: String

    func asSet(_ id: String) -> LoggedSet {
        LoggedSet(setId: id, type: type ?? "working", isChild: parent ?? false, weight: weight, reps: reps, completedAt: WatchSession.date(at))
    }
}

private struct Numbers: Decodable, Equatable { var weight: Double; var reps: Int }

@Test func carryForwardMatchesTypeScript() throws {
    struct Case: Decodable { var name: String; var logged: [Logged]; var expected: Numbers? }
    let cases = try load("carry.json", as: [Case].self)
    #expect(cases.count > 5)
    for c in cases {
        let carried = carriedSet(c.logged.enumerated().map { $1.asSet("s\($0)") })
        #expect(carried.map { Numbers(weight: $0.weight, reps: $0.reps) } == c.expected, "\(c.name)")
    }
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
}
