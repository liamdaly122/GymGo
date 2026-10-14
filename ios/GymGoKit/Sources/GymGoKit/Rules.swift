import Foundation

// The three rules the watch keeps for itself, because while the phone is
// locked it cannot ask. Each is a port of one TypeScript function, held to it
// by the cases in fixtures/watch/ (scripts/watchFixtures.ts). A fourth rule on
// the watch needs a fixture too, or it does not go in.

/// A set as the rules need it: what was logged, and what kind of set it was.
public struct LoggedSet: Codable, Sendable, Equatable {
    public var setId: String
    public var type: String
    public var isChild: Bool
    public var weight: Double
    public var reps: Int
    public var completedAt: Date
    /// An AMRAP set: rule 1 never steps down off one. Optional because it is
    /// saved in `watch-state.json` and a set saved by build 6 has none; nil is false.
    public var isAmrap: Bool?

    public init(setId: String, type: String, isChild: Bool, weight: Double, reps: Int, completedAt: Date, isAmrap: Bool? = nil) {
        self.setId = setId
        self.type = type
        self.isChild = isChild
        self.weight = weight
        self.reps = reps
        self.completedAt = completedAt
        self.isAmrap = isAmrap
    }

    /// `isTopWorkingSet` in `src/domain/sets.ts`: a completed, top-level working set.
    public var isTopWorkingSet: Bool { type == "working" && !isChild }
}

// MARK: - Rule 1: carry forward

/// `latestWorkingSet` in `src/domain/sets.ts`. From the second set on, the
/// numbers start at the working set done most recently today. Warm-ups, drops,
/// back-offs and an empty tick are never carried. Ties go to the later set.
public func carriedSet(_ sets: [LoggedSet]) -> (weight: Double, reps: Int)? {
    var latest: LoggedSet?
    for set in sets where set.isTopWorkingSet && set.reps > 0 {
        if latest == nil || set.completedAt >= latest!.completedAt { latest = set }
    }
    return latest.map { ($0.weight, $0.reps) }
}

// MARK: - Rule 2: the back-off target

/// `loadableWeight(target, profile, { direction: 'down' })` in `src/domain/plates.ts`:
/// the heaviest weight the equipment can make that is no heavier than `target`.
/// A barbell reads its ladder, which holds every weight its plates make.
public func loadableWeightDown(_ target: Double, loading: LoadingProfile, ladder: [Double]) -> Double {
    guard target.isFinite, target > 0 else { return 0 }
    switch loading.mode {
    case "free":
        return (target * 100).rounded() / 100
    case "fixed_step":
        let step = loading.step ?? 5
        guard step > 0 else { return target }
        let snapped = (target / step).rounded(.down) * step
        return max(step, (snapped * 1000).rounded() / 1000)
    default:
        let bar = loading.barWeight ?? 20
        if target <= bar { return bar }
        return ladder.last(where: { $0 <= target + 1e-9 }) ?? bar
    }
}

public let schemeLoadStep = 0.1
public let schemeRepStep = 2

/// `schemeTarget` in `src/domain/schemes.ts`: 10% lighter per step from the top
/// set, rounded down through what the equipment makes, and two reps more.
public func schemeTarget(top: (weight: Double, reps: Int), steps: Int, loading: LoadingProfile, ladder: [Double]) -> (weight: Double, reps: Int) {
    guard steps > 0 else { return top }
    let weight = top.weight > 0
        ? loadableWeightDown(top.weight * (1 - schemeLoadStep * Double(steps)), loading: loading, ladder: ladder)
        : 0
    return (weight, top.reps + schemeRepStep * steps)
}

// MARK: - Rule 3: the record check

/// `estimate1RM` in `src/domain/epley.ts`: weight × (1 + reps / 30).
public func estimate1RM(weight: Double, reps: Int) -> Double {
    guard weight > 0, reps > 0 else { return 0 }
    return weight * (1 + Double(reps) / 30)
}

/// `recordMarks` in `src/domain/prs.ts`, over record-eligible sets only.
public func recordMarks(_ sets: [LoggedSet]) -> RecordMarks? {
    let eligible = sets.filter(\.isTopWorkingSet)
    guard !eligible.isEmpty else { return nil }
    var marks = RecordMarks(weight: 0, e1rm: 0, unloadedReps: 0)
    for set in eligible {
        marks.weight = max(marks.weight, set.weight)
        marks.e1rm = max(marks.e1rm, estimate1RM(weight: set.weight, reps: set.reps))
        if set.weight == 0 { marks.unloadedReps = max(marks.unloadedReps, set.reps) }
    }
    return marks
}

public func mergeMarks(_ a: RecordMarks?, _ b: RecordMarks?) -> RecordMarks? {
    guard let a else { return b }
    guard let b else { return a }
    return RecordMarks(weight: max(a.weight, b.weight), e1rm: max(a.e1rm, b.e1rm), unloadedReps: max(a.unloadedReps, b.unloadedReps))
}

public enum RecordKind: String, Codable, Sendable { case weight, e1rm, reps }

public struct SetRecord: Codable, Sendable, Equatable {
    public var kind: RecordKind
    public var value: Double
    public var previous: Double
}

/// `marksBroken` in `src/domain/prs.ts`. Strictly beats: a tie is not a record.
public func marksBroken(during: RecordMarks, before: RecordMarks) -> [RecordKind] {
    var broken: [RecordKind] = []
    if during.weight > before.weight { broken.append(.weight) }
    if during.e1rm > 0 && during.e1rm > before.e1rm { broken.append(.e1rm) }
    if during.weight == 0 && before.weight == 0 && during.unloadedReps > before.unloadedReps { broken.append(.reps) }
    return broken
}

/// `setBreaksRecord` in `src/domain/prs.ts`: whether a set beats every earlier
/// session (`prior`) and the sets of the lift already done today (`earlier`).
/// Nil for a first, a tie, and any set the record gate refuses.
public func setBreaksRecord(_ set: LoggedSet, prior: RecordMarks?, earlier: [LoggedSet]) -> SetRecord? {
    guard let prior, set.isTopWorkingSet, let now = recordMarks([set]) else { return nil }
    let before = mergeMarks(prior, recordMarks(earlier.filter { $0.setId != set.setId }))!
    let broken = marksBroken(during: now, before: before)
    if broken.contains(.weight) { return SetRecord(kind: .weight, value: now.weight, previous: before.weight) }
    if broken.contains(.e1rm) { return SetRecord(kind: .e1rm, value: now.e1rm, previous: before.e1rm) }
    if broken.contains(.reps) { return SetRecord(kind: .reps, value: Double(now.unloadedReps), previous: Double(before.unloadedReps)) }
    return nil
}
