import Foundation

// Starting the same ready session again on the wrist, after a Discard here,
// with the phone locked.
//
// The phone lays the next session out with an ID for every row it will
// become, and the watch echoes that layout back when it starts it. Those IDs
// can be used once: the phone skips a start for a workout ID it has seen,
// even a discarded one. Until the phone app next opens it cannot offer new
// ones, so the watch mints them itself: the same layout, the same snapshot,
// every ID it minted replaced, consistently in both.

extension WatchReady {
    /// A random UUID in lowercase, as the phone's `crypto.randomUUID` writes it.
    public static func newId() -> String { UUID().uuidString.lowercased() }

    /// The IDs this offer minted, in the layout's order: the workout, then
    /// each exercise followed by its sets. Nil when the layout cannot be read,
    /// repeats an ID, or does not account for every workout, exercise and set
    /// ID in the snapshot: then it is not the watch's to lay out again.
    public var mintedIds: [String]? { LayoutIds(self)?.minted }

    /// The same session under new IDs, minted by `makeId`, in the layout and
    /// the snapshot alike. The routine, the gym, the plan and the library
    /// exercises are untouched: those rows exist already. Nil when
    /// `mintedIds` is.
    public func withFreshIds(_ makeId: () -> String = WatchReady.newId) -> WatchReady? {
        guard let ids = LayoutIds(self) else { return nil }
        var fresh: [String: String] = [:]
        for old in ids.minted { fresh[old] = makeId() }
        guard Set(fresh.values).count == fresh.count, fresh.values.allSatisfy({ fresh[$0] == nil }) else { return nil }
        func renamed(_ id: String) -> String { fresh[id] ?? id }

        var layout = ids.object
        layout["workoutId"] = renamed(snapshot.workoutId)
        layout["exercises"] = ids.exercises.map { exercise -> [String: Any] in
            var exercise = exercise
            if let id = exercise["id"] as? String { exercise["id"] = renamed(id) }
            if let sets = exercise["sets"] as? [[String: Any]] {
                exercise["sets"] = sets.map { set -> [String: Any] in
                    var set = set
                    if let id = set["id"] as? String { set["id"] = renamed(id) }
                    return set
                }
            }
            return exercise
        }
        guard let data = try? JSONSerialization.data(withJSONObject: layout, options: [.withoutEscapingSlashes]),
              let json = String(data: data, encoding: .utf8) else { return nil }

        var copy = self
        copy.layout = json
        copy.snapshot.workoutId = renamed(snapshot.workoutId)
        copy.snapshot.sets = snapshot.sets.map { set in
            var set = set
            set.id = renamed(set.id)
            set.workoutExerciseId = renamed(set.workoutExerciseId)
            set.parentSetId = set.parentSetId.map(renamed)
            set.scheme = set.scheme.map { SchemeLink(stepsFromTop: $0.stepsFromTop, topSetId: renamed($0.topSetId)) }
            return set
        }
        copy.snapshot.lifts = snapshot.lifts.mapValues { lift in
            var lift = lift
            lift.doneToday = lift.doneToday.map { done in
                var done = done
                done.setId = renamed(done.setId)
                return done
            }
            return lift
        }
        return copy
    }
}

/// The layout, read only as far as its IDs.
private struct LayoutIds {
    var object: [String: Any]
    var exercises: [[String: Any]]
    var minted: [String]

    init?(_ ready: WatchReady) {
        guard let parsed = try? JSONSerialization.jsonObject(with: Data(ready.layout.utf8)),
              let object = parsed as? [String: Any],
              let workoutId = object["workoutId"] as? String, workoutId == ready.snapshot.workoutId,
              let exercises = object["exercises"] as? [[String: Any]] else { return nil }
        var minted = [workoutId]
        var exerciseIds = Set<String>(), setIds = Set<String>()
        for exercise in exercises {
            guard let id = exercise["id"] as? String, let sets = exercise["sets"] as? [[String: Any]] else { return nil }
            minted.append(id)
            exerciseIds.insert(id)
            for set in sets {
                guard let setId = set["id"] as? String else { return nil }
                minted.append(setId)
                setIds.insert(setId)
            }
        }
        guard Set(minted).count == minted.count else { return nil }
        // Every row the snapshot names is one the layout writes.
        for set in ready.snapshot.sets {
            guard setIds.contains(set.id), exerciseIds.contains(set.workoutExerciseId),
                  set.parentSetId.map(setIds.contains) ?? true,
                  set.scheme.map({ setIds.contains($0.topSetId) }) ?? true else { return nil }
        }
        self.object = object
        self.exercises = exercises
        self.minted = minted
    }
}
