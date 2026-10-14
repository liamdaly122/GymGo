import Foundation
import Testing
@testable import GymGoKit

// When the iPhone's Live Activity starts, updates and ends, and what it shows.

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

private func report(
    _ workoutId: String? = "w-1", session: WatchStateReport.Session = .running, owner: WatchStateReport.Owner = .watch,
    setId: String? = "s-1", rest: WatchStateReport.Rest? = nil, heartRate: Double? = 121.6
) -> WatchStateReport {
    WatchStateReport(
        at: WatchSession.isoString(t0), seq: 1, workoutId: workoutId, session: session, owner: owner,
        seenPhoneClaim: nil, setId: setId, rest: rest, heartRate: heartRate, activeKcal: nil, health: .recording
    )
}

@Test func startsOnlyWhenAllowed() {
    let running = report()
    #expect(LiveSession.step(report: running, receivedAt: t0, now: t0, showing: nil, mayStart: true, declined: []) == .start(workoutId: "w-1"))
    // In the background: nothing until the app is opened.
    #expect(LiveSession.step(report: running, receivedAt: t0, now: t0, showing: nil, mayStart: false, declined: []) == .nothing)
    // Swiped away for this workout: not again.
    #expect(LiveSession.step(report: running, receivedAt: t0, now: t0, showing: nil, mayStart: true, declined: ["w-1"]) == .nothing)
}

@Test func updatesTheOneOnScreenEvenInTheBackground() {
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: t0, showing: "w-1", mayStart: false, declined: []) == .update)
}

@Test func endsWhenTheSessionEndsOrGoesQuiet() {
    #expect(LiveSession.step(report: report(session: .ended), receivedAt: t0, now: t0, showing: "w-1", mayStart: false, declined: []) == .end)
    #expect(LiveSession.step(report: nil, receivedAt: nil, now: t0, showing: "w-1", mayStart: true, declined: []) == .end)
    let late = t0.addingTimeInterval(LiveSession.staleAfter + 1)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: late, showing: "w-1", mayStart: true, declined: []) == .end)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: late, showing: nil, mayStart: true, declined: []) == .nothing)
}

@Test func anotherWorkoutReplacesOrEnds() {
    let next = report("w-2")
    #expect(LiveSession.step(report: next, receivedAt: t0, now: t0, showing: "w-1", mayStart: true, declined: []) == .replace(workoutId: "w-2"))
    #expect(LiveSession.step(report: next, receivedAt: t0, now: t0, showing: "w-1", mayStart: false, declined: []) == .end)
}

@Test func aRestCarriesItsSpanAndUpNext() {
    let endsAt = t0.addingTimeInterval(150)
    let resting = report(rest: .init(endsAt: WatchSession.isoString(endsAt), upNext: UpNext(name: "Bench Press", detail: "Set 3 of 4 · 100 × 5")))
    let inHand = LiveSessionInHand(exercise: "Bench Press", detail: "Set 2 of 4 · 100 × 5")
    let content = LiveSession.content(for: resting, inHand: inHand, restStart: t0)
    #expect(content.phase == .resting)
    #expect(content.restStart == t0)
    #expect(content.restEnd == endsAt)
    #expect(content.upNext == "Bench Press")
    #expect(content.heartRate == 122)
    // A start later than the end (a late first sight) is held to the end.
    #expect(LiveSession.content(for: resting, inHand: nil, restStart: endsAt.addingTimeInterval(5)).restStart == endsAt)
}

@Test func thePhoneTakingLoggingBackShowsSo() {
    #expect(LiveSession.content(for: report(owner: .phone), inHand: nil, restStart: nil).phase == .onPhone)
}

@Test func encodedStateStaysWellUnderFourKilobytes() throws {
    let long = String(repeating: "Single-Arm Cable Lateral Raise ", count: 4)
    let content = LiveSessionContent(
        phase: .resting, exercise: long, detail: long, restStart: t0, restEnd: t0, upNext: long, upNextDetail: long, heartRate: 180
    )
    #expect(try JSONEncoder().encode(content).count < 2048)
}
