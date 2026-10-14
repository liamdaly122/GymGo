import Foundation
import Testing
@testable import GymGoKit

// Build 7's state report: the set in hand as its screen shows it, what was
// skipped, and the pause, each reported the moment it changes.

private func running(_ name: String = "two straight lifts") throws -> WatchAppState {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject(name)))
    return state
}

@Test func theReportCarriesTheSetInHandAsItsScreenShowsIt() throws {
    var state = try running()
    let first = state.report(at: minute(6), heartRate: nil, activeKcal: nil, health: .off)
    #expect(first.inHand == WatchStateReport.InHand(name: "Lift a", detail: "Set 1 of 3 · 100 × 5"))

    // After a set that fell short of nothing (no range): carried.
    _ = state.logSet(weight: 102.5, reps: 4, at: minute(7))
    let second = state.report(at: minute(8), heartRate: nil, activeKcal: nil, health: .off)
    #expect(second.inHand == WatchStateReport.InHand(name: "Lift a", detail: "Set 2 of 3 · 102.5 × 4"))
    #expect(second.setId == "a-s1")
}

@Test func theReportsSetInHandIsTheScreensNumbersNotTheRulesUnrounded() throws {
    // Unloaded bodyweight work reads BW, and a weight off the ladder is
    // reported as the rung the screen starts on.
    var state = try running("a plan, last time, a step down and an AMRAP set")
    _ = state.go(toStation: 2, at: minute(6))
    #expect(state.report(at: minute(6), heartRate: nil, activeKcal: nil, health: .off).inHand
        == WatchStateReport.InHand(name: "Pull-up", detail: "Set 2 of 2 · BW × 5"))

    let hand = try #require(state.setInHand)
    var odd = hand
    odd.weight = 15.75
    odd.lift.ladder = [0, 5, 10, 15, 20]
    #expect(odd.numbersOnScreen(nil) == (15, 5))
    #expect(odd.screenDetail == "Set 2 of 2 · 15 × 5")
    odd.reps = nil
    #expect(odd.screenDetail == "Set 2 of 2")
}

@Test func noSetInHandIsReportedWhileThePhoneLogsOrWithNothingLeft() throws {
    var claimed = try running()
    claimed.apply(try context(sentAt: minute(6), live: snapshotObject("two straight lifts"), claim: ["workoutId": "w-1", "at": iso(minute(6))]))
    #expect(claimed.report(at: minute(7), heartRate: nil, activeKcal: nil, health: .off).inHand == nil)

    var done = try running()
    _ = done.skipStationInHand(at: minute(6))
    _ = done.skipStationInHand(at: minute(6))
    let report = done.report(at: minute(7), heartRate: nil, activeKcal: nil, health: .off)
    #expect(report.inHand == nil && report.setId == nil)
    #expect(report.skipped == ["a-s0", "a-s1", "a-s2", "b-s0", "b-s1", "b-s2"])
}

@Test func thePauseIsReportedWhileASessionRuns() throws {
    var state = try running()
    let paused = state.report(at: minute(9), heartRate: nil, activeKcal: nil, health: .recording, paused: minute(8))
    #expect(paused.paused == iso(minute(8)))
    #expect(paused.session == .running)
    #expect(state.report(at: minute(10), heartRate: nil, activeKcal: nil, health: .recording).paused == nil)

    var idle = WatchAppState()
    #expect(idle.report(at: minute(1), heartRate: nil, activeKcal: nil, health: .off, paused: minute(1)).paused == nil)
}

@Test func aSkipAJumpOrAPauseReportsAtOnce() throws {
    var state = try running()
    let start = state.reportKey(paused: nil)

    _ = state.skipSetInHand(at: minute(6))
    let skipped = state.reportKey(paused: nil)
    #expect(skipped != start)

    _ = state.go(toStation: 1, at: minute(6))
    let jumped = state.reportKey(paused: nil)
    #expect(jumped != skipped)

    #expect(state.reportKey(paused: minute(7)) != jumped)

    // The set in hand's numbers moving is news too: a carry after a set.
    _ = state.logSet(weight: 25, reps: 8, at: minute(8))
    _ = state.skipRest(at: minute(8))
    let carried = state.reportKey(paused: nil)
    #expect(carried.inHand?.detail == "Set 2 of 3 · 25 × 8")
}

@Test func aRestReworkedByAJumpReportsAtOnce() throws {
    var state = try running()
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    let resting = state.reportKey
    _ = state.go(toStation: 1, at: minute(7))
    #expect(state.reportKey != resting)
    let report = state.report(at: minute(7), heartRate: nil, activeKcal: nil, health: .off)
    #expect(report.rest?.upNext == UpNext(name: "Lift b", detail: "Dumbbell · 3 × 10"))
}
