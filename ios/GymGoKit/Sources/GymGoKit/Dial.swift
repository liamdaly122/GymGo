import Foundation

// The numbers on the set screen: where the Crown starts for the set in hand,
// and what Done logs. One rule, so the Done button, the Action button and the
// state report the phone's Live Activity shows all read the same numbers.

/// The weights the Crown moves through, and what a position on it reads.
public struct SetDial: Sendable, Equatable {
    /// The most reps the screen dials to.
    public static let maxReps = 50

    /// Every weight the lift's equipment makes; never empty.
    public let ladder: [Double]

    public init(ladder: [Double]) {
        self.ladder = ladder.isEmpty ? [0] : ladder
    }

    /// The rung a weight starts at: the heaviest at or below it, else the
    /// lightest. A weight off the ladder (added weight on bodyweight work,
    /// say) rounds down, never up.
    public func index(for weight: Double?) -> Int {
        ladder.lastIndex { $0 <= (weight ?? 0) + 1e-9 } ?? 0
    }

    /// The weight at a Crown position.
    public func weight(at position: Double) -> Double {
        ladder[min(max(Int(position.rounded()), 0), ladder.count - 1)]
    }

    /// The reps at a Crown position.
    public func reps(_ value: Double) -> Int {
        min(max(Int(value.rounded()), 0), Self.maxReps)
    }
}

/// What was dialled in for a set, so the numbers survive the set screen
/// going away behind the rest and coming back.
public struct SetDraft: Equatable, Sendable {
    public var setId: String
    /// A Crown position on the lift's ladder.
    public var weightIndex: Double
    public var reps: Double
    /// The reps tile is the one the Crown moves.
    public var onReps: Bool

    public init(setId: String, weightIndex: Double, reps: Double, onReps: Bool) {
        self.setId = setId
        self.weightIndex = weightIndex
        self.reps = reps
        self.onReps = onReps
    }
}

extension SetInHand {
    public var dial: SetDial { SetDial(ladder: lift.ladder) }

    /// Where the set screen stands: what was dialled for this set if
    /// anything was, else the set's own numbers, the weight down to a rung of
    /// the ladder, with the Crown on the reps when there are none yet.
    public func dialled(_ draft: SetDraft?) -> SetDraft {
        if let draft, draft.setId == set.id { return draft }
        let reps = max(0, self.reps ?? 0)
        return SetDraft(setId: set.id, weightIndex: Double(dial.index(for: weight)), reps: Double(reps), onReps: reps == 0)
    }

    /// The numbers on the set screen: exactly what Done logs.
    public func numbersOnScreen(_ draft: SetDraft?) -> (weight: Double, reps: Int) {
        let dialled = dialled(draft)
        return (dial.weight(at: dialled.weightIndex), dial.reps(dialled.reps))
    }

    /// The set as its screen opens on it, for the phone: "Set 2 of 4 · 100 × 5",
    /// "BW" for no weight, and no numbers until there are reps.
    public var screenDetail: String {
        let numbers = numbersOnScreen(nil)
        return numbers.reps > 0 ? "\(set.label) · \(formatLogged(numbers.weight, numbers.reps))" : set.label
    }
}
