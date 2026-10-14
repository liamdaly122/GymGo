import CoreText
import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// Why this number, and last time, on the wrist: the set screen's verb, the
// lift sheet's plan and last time, and the rest's third line.

private func named(_ name: String) throws -> WatchSnapshot { try decodeSnapshot(snapshotObject(name)) }

@discardableResult
private func log(_ session: inout WatchSession, _ weight: Double, _ reps: Int, at m: Double) throws -> LogOutcome {
    let outcome = session.logSetInHand(weight: weight, reps: reps, at: minute(m))
    return try #require(outcome)
}

// MARK: - The verb on the set screen

@Test func thePlansVerbShowsOnlyWhileTheNumbersAreItsSuggestion() throws {
    var session = WatchSession(snapshot: try named("two straight lifts"))
    let first = try #require(session.setInHand)
    #expect(first.verb == "Go up")
    #expect(first.headerLine(stations: 2) == "Set 1 of 3 · Go up")

    // After a carry the numbers are what was just done: no verb, and the
    // station's place is back.
    try log(&session, 100, 5, at: 1)
    let carried = try #require(session.setInHand)
    #expect(carried.verb == nil)
    #expect(carried.headerLine(stations: 2) == "Set 2 of 3 · 1/2")
}

@Test func aSteppedSetSaysLighterAndWhy() throws {
    let session = WatchSession(snapshot: try named("a plan, last time, a step down and an AMRAP set"))
    let hand = try #require(session.setInHand)
    #expect(hand.verb == "Lighter")
    #expect(hand.headerLine(stations: 3) == "Set 2 of 3 · Lighter")
    #expect(hand.stepDownReason == "5 was under 8, so 90kg for 8.")
}

@Test func noVerbForABackOffAWarmUpOrALiftWithNoPlan() throws {
    var pyramid = WatchSession(snapshot: try named("a superset and a pyramid"))
    try log(&pyramid, 110, 5, at: 1)
    #expect(pyramid.setInHand?.verb == nil)

    var noPlan = try named("two straight lifts")
    noPlan.lifts["ex-a"]!.plan = nil
    #expect(WatchSession(snapshot: noPlan).setInHand?.verb == nil)

    var warmUp = try named("two straight lifts")
    warmUp.sets[0].type = "warmup"
    #expect(WatchSession(snapshot: warmUp).setInHand?.verb == nil)
}

/// The header shares its row with the heart rate on a 41 mm screen (176
/// points), in Barlow Medium at 12 points, shrinking to 0.8 at most. The
/// longest verbs and labels must fit; with the station's place as well,
/// the longest would not, which is why it goes while a verb shows.
@Test func theHeaderFitsA41mmScreen() throws {
    Theme.registerFonts()
    let font = CTFontCreateWithName("Barlow-Medium" as CFString, 12, nil)
    #expect(CTFontCopyPostScriptName(font) as String == "Barlow-Medium")
    func width(_ text: String) -> Double {
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [.init(kCTFontAttributeName as String): font]))
        return CTLineGetTypographicBounds(line, nil, nil, nil)
    }
    // The screen less its margins, the heart rate badge and the spacing.
    let room = (176.0 - 2 * 8 - 34 - 6) / 0.8
    for verb in ["Go up", "More reps", "Hold", "Back off", "Estimate", "Lighter"] {
        #expect(width("Set 10 of 10 · \(verb)") <= room, "\(verb)")
    }
    #expect(width("Set 10 of 10 · More reps · 10/10") > room)
}

// MARK: - The lift sheet

@Test func lastTimeIsWordedFromTheDayAndTheSets() throws {
    let last = LastTime(day: "2026-10-03", top: SetNumbers(weight: 97.5, reps: 8), sets: [
        SetNumbers(weight: 97.5, reps: 8), SetNumbers(weight: 97.5, reps: 8), SetNumbers(weight: 97.5, reps: 7),
    ])
    #expect(last.heading(today: "2026-10-14", timeZone: london) == "Last time · 3 Oct")
    #expect(last.heading(today: "2026-10-06", timeZone: london) == "Last time · Sat")
    #expect(last.setsLine == "97.5 × 8, 8, 7")

    let mixed = LastTime(day: "2026-10-03", top: SetNumbers(weight: 100, reps: 5), sets: [
        SetNumbers(weight: 100, reps: 5), SetNumbers(weight: 95, reps: 6),
    ])
    #expect(mixed.setsLine == "100 × 5, 95 × 6")
    let bodyweight = LastTime(day: "2026-10-07", top: SetNumbers(weight: 0, reps: 10), sets: [
        SetNumbers(weight: 0, reps: 10), SetNumbers(weight: 0, reps: 9),
    ])
    #expect(bodyweight.setsLine == "BW × 10, 9")
}

// MARK: - The rest's third line

@Test func theRestSaysHowTheNextLiftWentLastTimeUnlessASetupNoteTakesTheLine() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("a plan, last time, a step down and an AMRAP set")))
    // The pull-ups already have a set today: no "Last" for them.
    _ = state.go(toStation: 2, at: minute(6))
    let pullUp = try #require(state.setInHand)
    #expect(!pullUp.firstOfLiftToday)

    // Lift a's last set, on to the incline press: its first set today, with
    // no setup note, and no last time either (a first).
    _ = state.go(toStation: 0, at: minute(6))
    _ = state.logSet(weight: 90, reps: 8, at: minute(7))
    _ = state.logSet(weight: 90, reps: 8, at: minute(10))
    let rest = try #require(state.rest)
    let incline = try #require(state.setInHand)
    #expect(incline.lift.name == "Incline Dumbbell Press" && incline.firstOfLiftToday)
    #expect(incline.restNote(after: rest) == nil)

    // With a last time, it says so.
    var withLast = incline
    withLast.lift.lastTime = LastTime(day: "2026-10-03", top: SetNumbers(weight: 22.5, reps: 9), sets: [SetNumbers(weight: 22.5, reps: 9)])
    #expect(withLast.restNote(after: rest) == "Last 22.5 × 9")

    // A setup note wins.
    var withNote = withLast
    withNote.lift.setupNote = "Bench at 30°"
    #expect(withNote.restNote(after: rest) == "Bench at 30°")

    // Not the first set of the lift today: nothing.
    var later = withLast
    later.firstOfLiftToday = false
    #expect(later.restNote(after: rest) == nil)
}
