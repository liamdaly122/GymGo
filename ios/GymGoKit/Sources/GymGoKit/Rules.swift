import Foundation

// The rules the watch keeps for itself, because while the phone is locked it
// cannot ask. Each is a port of one TypeScript function, held to it by the
// cases in fixtures/watch/ (scripts/watchFixtures.ts). Rules 1 to 3 are here;
// rules 4 and 5, where the session goes and how Up next words it, are in
// Stations.swift. A new rule on the watch needs a fixture too, or it does not
// go in.

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

/// Why a carried set is lighter than the set just done. Mirrors `StepDown` in
/// `src/domain/carry.ts`.
public struct StepDown: Codable, Sendable, Equatable {
    /// The set just done, which fell short.
    public var from: SetNumbers
    /// The bottom of the range it fell short of: the reps the next set aims for.
    public var repLow: Int

    public init(from: SetNumbers, repLow: Int) {
        self.from = from
        self.repLow = repLow
    }
}

/// What the next set starts at. Mirrors `Carried` in `src/domain/carry.ts`.
public struct Carried: Sendable, Equatable {
    public var weight: Double
    public var reps: Int
    /// Set when the set just done fell short of the range and this is lighter.
    public var stepped: StepDown?

    public init(weight: Double, reps: Int, stepped: StepDown? = nil) {
        self.weight = weight
        self.reps = reps
        self.stepped = stepped
    }
}

/// `STEP_DOWN_FLOOR`: at most this much lighter, unless one real step is already more.
public let stepDownFloor = 0.9

/// `carryForward` in `src/domain/carry.ts`. From the second set on, the
/// numbers start at the working set done most recently today
/// (`latestWorkingSet`: warm-ups, drops, back-offs and an empty tick are
/// never carried; ties go to the later set), a notch lighter when it fell
/// short of the range:
///
/// 1. the weight that should give `repLow` reps, by the records' estimate;
/// 2. never more than 10% lighter than the set just done;
/// 3. rounded down through what the equipment makes;
/// 4. and at least one real step lighter, with the reps at `repLow`.
///
/// Carried exactly as done at or above `repLow`, with no `repLow` (or no
/// loading: the carry as it was before build 7), for an AMRAP set, for 0kg,
/// for `free` loading, and when nothing lighter can be loaded.
public func carriedSet(_ sets: [LoggedSet], repLow: Int? = nil, loading: LoadingProfile? = nil, ladder: [Double] = []) -> Carried? {
    var found: LoggedSet?
    for set in sets where set.isTopWorkingSet && set.reps > 0 {
        if found == nil || set.completedAt >= found!.completedAt { found = set }
    }
    guard let latest = found else { return nil }
    let asDone = Carried(weight: latest.weight, reps: latest.reps)

    guard let repLow, repLow > 0, latest.reps < repLow else { return asDone }
    guard latest.isAmrap != true, latest.weight > 0, let loading, loading.mode != "free" else { return asDone }

    let oneStep = nextLoadableBelow(latest.weight, loading: loading, ladder: ladder)
    guard oneStep < latest.weight else { return asDone }

    let forRepLow = estimate1RM(weight: latest.weight, reps: latest.reps) / (1 + Double(repLow) / 30)
    let target = loadableWeightDown(max(forRepLow, latest.weight * stepDownFloor), loading: loading, ladder: ladder)
    return Carried(
        weight: min(target, oneStep), reps: repLow,
        stepped: StepDown(from: SetNumbers(weight: latest.weight, reps: latest.reps), repLow: repLow)
    )
}

/// `nextLoadableBelow` in `src/domain/plates.ts`: the next weight down this
/// equipment can make. A barbell reads its ladder: the previous rung at or
/// above the bar, the bar itself when there is none. Fixed steps never go
/// below one step, so never to the ladder's 0 rung.
public func nextLoadableBelow(_ weight: Double, loading: LoadingProfile, ladder: [Double]) -> Double {
    switch loading.mode {
    case "free":
        return max(0, weight - 1.25)
    case "fixed_step":
        let step = loading.step ?? 5
        guard step > 0 else { return weight }
        return max(step, (weight / step - 1e-9).rounded(.up) * step - step)
    default:
        let bar = loading.barWeight ?? 20
        return ladder.last(where: { $0 >= bar - 1e-9 && $0 < weight - 1e-9 }) ?? bar
    }
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
