import Foundation
import Testing
@testable import GymGoKit

// When the iPhone's Live Activity starts, updates and ends, and what it shows.

private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
private func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

private func report(
    _ workoutId: String? = "w-1", session: WatchStateReport.Session = .running, owner: WatchStateReport.Owner = .watch,
    setId: String? = "s-1", inHand: WatchStateReport.InHand? = nil, rest: WatchStateReport.Rest? = nil,
    paused: String? = nil, heartRate: Double? = 121.6
) -> WatchStateReport {
    WatchStateReport(
        at: WatchSession.isoString(t0), seq: 1, workoutId: workoutId, session: session, owner: owner,
        seenPhoneClaim: nil, setId: setId, inHand: inHand, rest: rest, paused: paused, heartRate: heartRate,
        activeKcal: nil, health: .recording
    )
}

/// An activity on screen that a report has already reached.
private func shown(_ workoutId: String = "w-1") -> LiveSession.Showing {
    LiveSession.Showing(workoutId: workoutId, waitingSince: nil)
}

/// One the phone's Start put up, still waiting for the watch's first report.
private func waiting(_ workoutId: String = "w-1", since: Date = t0) -> LiveSession.Showing {
    LiveSession.Showing(workoutId: workoutId, waitingSince: since)
}

// MARK: - Start, update, end

@Test func startsOnlyWhenAllowed() {
    let running = report()
    #expect(LiveSession.step(report: running, receivedAt: t0, now: t0, showing: nil, mayStart: true, declined: []) == .start(workoutId: "w-1"))
    // In the background: nothing until the app is opened.
    #expect(LiveSession.step(report: running, receivedAt: t0, now: t0, showing: nil, mayStart: false, declined: []) == .nothing)
    // Swiped away for this workout: not again.
    #expect(LiveSession.step(report: running, receivedAt: t0, now: t0, showing: nil, mayStart: true, declined: ["w-1"]) == .nothing)
    // A session that is over, or a report gone quiet, starts nothing.
    #expect(LiveSession.step(report: report(session: .ended), receivedAt: t0, now: t0, showing: nil, mayStart: true, declined: []) == .nothing)
    #expect(LiveSession.step(report: running, receivedAt: t0, now: at(301), showing: nil, mayStart: true, declined: []) == .nothing)
}

@Test func updatesTheOneOnScreenEvenInTheBackground() {
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: t0, showing: shown(), mayStart: false, declined: []) == .update)
}

@Test func endsWhenTheSessionEndsOrGoesQuiet() {
    #expect(LiveSession.step(report: report(session: .ended), receivedAt: t0, now: t0, showing: shown(), mayStart: false, declined: []) == .end)
    #expect(LiveSession.step(report: report(session: .none), receivedAt: t0, now: t0, showing: shown(), mayStart: false, declined: []) == .end)
    #expect(LiveSession.step(report: nil, receivedAt: nil, now: t0, showing: shown(), mayStart: true, declined: []) == .end)
    let late = t0.addingTimeInterval(LiveSession.staleAfter + 1)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: late, showing: shown(), mayStart: true, declined: []) == .end)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: late, showing: nil, mayStart: true, declined: []) == .nothing)
}

/// Launched in the background by the watch's message after the phone sat in
/// a locker past the stale time: the report saved on disk is stale, but the
/// watch is still there, and in the background nothing ended could come
/// back. A stale report of its own leaves it up (its stale date already says
/// "Out of touch") for the fresh report that follows.
@Test func aStaleReportInTheBackgroundLeavesItForTheNextOne() {
    let late = t0.addingTimeInterval(LiveSession.staleAfter + 60)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: late, showing: shown(), mayStart: false, declined: []) == .nothing)
    // The report that launched the app, a moment later: it carries on.
    #expect(LiveSession.step(report: report(), receivedAt: late, now: late, showing: shown(), mayStart: false, declined: []) == .update)
    // In the foreground a stale one still ends: a fresh report can start it again.
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: late, showing: shown(), mayStart: true, declined: []) == .end)
    // Over is over, in the background too.
    #expect(LiveSession.step(report: report(session: .ended), receivedAt: t0, now: late, showing: shown(), mayStart: false, declined: []) == .end)
}

/// What the phone holds is a report it can read, none at all, or one it
/// cannot read (a newer watch's health value, or a broken one). The last
/// changes nothing: read as "no report", it would end the activity on every
/// report, with no way back while the phone is locked.
@Test func aReportThePhoneCannotReadIsNotNoReport() throws {
    #expect(LiveSession.heard(nil) == .nothing)
    let json = try String(decoding: JSONEncoder().encode(report()), as: UTF8.self)
    #expect(LiveSession.heard(json) == .report(report()))
    let newerHealth = json.replacingOccurrences(of: "\"recording\"", with: "\"sleeping\"")
    #expect(newerHealth != json)
    #expect(LiveSession.heard(newerHealth) == .unreadable)
    #expect(LiveSession.heard("not json") == .unreadable)
}

/// A rest is drawn only while the activity is fresh: gone stale, it would
/// be long over, so no ring and no frozen 0:00 in the Dynamic Island or on
/// the watch, as on the Lock Screen.
@Test func aStaleRestIsNotDrawn() {
    let resting = LiveSessionContent(phase: .resting, restStart: at(-30), restEnd: at(60))
    #expect(resting.restRange(isStale: false) == at(-30)...at(60))
    #expect(resting.restRange(isStale: true) == nil)
    #expect(LiveSessionContent(phase: .lifting, restStart: at(-30), restEnd: at(60)).restRange(isStale: false) == nil)
    #expect(LiveSessionContent(phase: .resting, restStart: at(60), restEnd: at(-30)).restRange(isStale: false) == nil)
}

@Test func anotherWorkoutReplacesOrEnds() {
    let next = report("w-2")
    #expect(LiveSession.step(report: next, receivedAt: t0, now: t0, showing: shown("w-1"), mayStart: true, declined: []) == .replace(workoutId: "w-2"))
    #expect(LiveSession.step(report: next, receivedAt: t0, now: t0, showing: shown("w-1"), mayStart: false, declined: []) == .end)
    #expect(LiveSession.step(report: next, receivedAt: t0, now: t0, showing: shown("w-1"), mayStart: true, declined: ["w-2"]) == .end)
}

/// Swiped away means gone while this install had it up; installing the app
/// again ends its Live Activities without anyone saying no.
@Test func onlyAPersonSwipingItAwayKeepsItDown() {
    let here = "/var/containers/Bundle/Application/A/App.app"
    let there = "/var/containers/Bundle/Application/B/App.app"
    #expect(LiveSession.declined(startedFor: "w-1", startedInstall: here, currentInstall: here, showing: nil) == ["w-1"])
    #expect(LiveSession.declined(startedFor: "w-1", startedInstall: nil, currentInstall: here, showing: nil) == ["w-1"])
    // An update or a build from Xcode since it went up: not a no.
    #expect(LiveSession.declined(startedFor: "w-1", startedInstall: there, currentInstall: here, showing: nil).isEmpty)
    // Still up, or never started: nothing declined.
    #expect(LiveSession.declined(startedFor: "w-1", startedInstall: here, currentInstall: here, showing: shown()).isEmpty)
    #expect(LiveSession.declined(startedFor: nil, startedInstall: nil, currentInstall: here, showing: nil).isEmpty)
    // And a declined workout is not started again from its reports.
    let declined = LiveSession.declined(startedFor: "w-1", startedInstall: here, currentInstall: here, showing: nil)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: t0, showing: nil, mayStart: true, declined: declined) == .nothing)
}

// MARK: - The phone's Start

@Test func thePhonesStartPutsOneUpAtTheTap() {
    #expect(LiveSession.stepForPhoneStart(workoutId: "w-1", showing: nil, mayStart: true) == .start(workoutId: "w-1"))
    // ActivityKit refuses a start from the background: nothing to try.
    #expect(LiveSession.stepForPhoneStart(workoutId: "w-1", showing: nil, mayStart: false) == .nothing)
    // Already up for this workout (the watch reported first): left as it is.
    #expect(LiveSession.stepForPhoneStart(workoutId: "w-1", showing: shown("w-1"), mayStart: true) == .nothing)
    // Another workout's is still up: this one takes its place.
    #expect(LiveSession.stepForPhoneStart(workoutId: "w-2", showing: shown("w-1"), mayStart: true) == .replace(workoutId: "w-2"))
    #expect(LiveSession.stepForPhoneStart(workoutId: "w-2", showing: shown("w-1"), mayStart: false) == .nothing)
}

/// Started at the tap, before the watch has opened GymGo: what the phone
/// last heard is about an older workout, or nothing. It waits for the
/// watch's first report for as long as a report counts as fresh.
@Test func aStartAtTheTapWaitsForTheWatchsFirstReport() {
    let since = t0
    let step = { (r: WatchStateReport?, receivedAt: Date?, now: Date) in
        LiveSession.step(report: r, receivedAt: receivedAt, now: now, showing: waiting("w-2", since: since), mayStart: true, declined: [])
    }
    // Nothing heard yet, or only about the workout before.
    #expect(step(nil, nil, at(60)) == .nothing)
    #expect(step(report("w-1", session: .ended), at(-600), at(60)) == .nothing)
    #expect(step(report("w-1"), at(-30), at(60)) == .nothing)
    // The watch has no session yet while GymGo opens on it.
    #expect(step(report(nil, session: .none, setId: nil), at(5), at(60)) == .nothing)
    // Its first report updates it.
    #expect(step(report("w-2"), at(8), at(60)) == .update)
    // Five minutes with nothing: the watch never took it.
    #expect(step(nil, nil, since.addingTimeInterval(LiveSession.staleAfter + 1)) == .end)
    // A newer session of another workout on the watch: that one is what runs.
    #expect(step(report("w-3"), at(20), at(60)) == .replace(workoutId: "w-3"))
}

@Test func thePhonesStartReadsTheContextJustSent() throws {
    let live = try snapshotObject("two straight lifts", workoutId: "w-live")
    let context = try WatchContext.decode(JSONSerialization.data(withJSONObject: contextObject(live: live)))
    let start = try #require(LiveSession.phoneStart(context: context, now: t0))
    #expect(start.workoutId == "w-live")
    #expect(start.facts.title == context.live?.title)
    #expect(start.facts.startedAt == WatchSession.date(context.live?.startedAt))
    // No workout open on the phone: nothing to put up.
    let idle = try WatchContext.decode(JSONSerialization.data(withJSONObject: contextObject()))
    #expect(LiveSession.phoneStart(context: idle, now: t0) == nil)
    #expect(LiveSession.phoneStart(context: nil, now: t0) == nil)
    // Until the watch reports, it says so.
    #expect(LiveSession.starting.phase == .starting)
}

// MARK: - Paused

@Test func aPausedWatchGoesStaleAfterAnHourNotFiveMinutes() {
    let paused = report(paused: WatchSession.isoString(t0))
    #expect(LiveSession.staleAfter(paused) == 60 * 60)
    #expect(LiveSession.staleAfter(report()) == 5 * 60)
    #expect(LiveSession.staleAfter(nil) == 5 * 60)
    #expect(LiveSession.step(report: paused, receivedAt: t0, now: at(10 * 60), showing: shown(), mayStart: false, declined: []) == .update)
    // Stale past the hour, or past five minutes unpaused: ended where it
    // could start again, left for the next report where it could not.
    #expect(LiveSession.step(report: paused, receivedAt: t0, now: at(61 * 60), showing: shown(), mayStart: true, declined: []) == .end)
    #expect(LiveSession.step(report: report(), receivedAt: t0, now: at(10 * 60), showing: shown(), mayStart: true, declined: []) == .end)
    #expect(LiveSession.step(report: paused, receivedAt: t0, now: at(61 * 60), showing: shown(), mayStart: false, declined: []) == .nothing)
}

@Test func aPauseShowsAndStopsTheClock() {
    let content = LiveSession.content(for: report(paused: WatchSession.isoString(at(-30))), inHandFallback: nil, restFirstSeen: nil)
    #expect(content.pausedAt == at(-30))
    #expect(LiveSession.content(for: report(), inHandFallback: nil, restFirstSeen: nil).pausedAt == nil)
}

// MARK: - What it shows

@Test func theSetInHandIsTheWatchsOwnWords() {
    let inHand = WatchStateReport.InHand(name: "Bench Press", detail: "Set 2 of 4 · 102.5 × 5")
    let phoneGuess = LiveSessionInHand(exercise: "Bench Press", detail: "Set 2 of 4 · 100 × 5")
    let content = LiveSession.content(for: report(inHand: inHand), inHandFallback: phoneGuess, restFirstSeen: nil)
    #expect(content.phase == .lifting)
    #expect(content.exercise == "Bench Press")
    #expect(content.detail == "Set 2 of 4 · 102.5 × 5")
    // A build 6 watch sends no inHand: the phone's own reading of the snapshot stands in.
    let old = LiveSession.content(for: report(inHand: nil), inHandFallback: phoneGuess, restFirstSeen: nil)
    #expect(old.detail == "Set 2 of 4 · 100 × 5")
    // Nothing in hand is nothing in hand.
    let none = LiveSession.content(for: report(setId: nil, inHand: nil), inHandFallback: phoneGuess, restFirstSeen: nil)
    #expect(none.exercise == nil && none.detail == nil)
}

@Test func aRestCarriesItsSpanAndUpNext() {
    let endsAt = at(150)
    let rest = WatchStateReport.Rest(
        endsAt: WatchSession.isoString(endsAt), startedAt: WatchSession.isoString(at(-60)),
        upNext: UpNext(name: "Bench Press", detail: "Set 3 of 4 · 100 × 5")
    )
    let content = LiveSession.content(for: report(rest: rest), inHandFallback: nil, restFirstSeen: t0)
    #expect(content.phase == .resting)
    // The watch's own start, not when the phone first heard of it.
    #expect(content.restStart == at(-60))
    #expect(content.restEnd == endsAt)
    #expect(content.upNext == "Bench Press")
    #expect(content.upNextDetail == "Set 3 of 4 · 100 × 5")
    #expect(content.heartRate == 122)
}

@Test func aBuild6RestStartsWhenThePhoneFirstSawIt() {
    let endsAt = at(150)
    let rest = WatchStateReport.Rest(endsAt: WatchSession.isoString(endsAt), upNext: UpNext(name: "Bench Press", detail: "Set 3 of 4"))
    #expect(LiveSession.content(for: report(rest: rest), inHandFallback: nil, restFirstSeen: t0).restStart == t0)
    // A start later than the end (a late first sight) is held to the end.
    #expect(LiveSession.content(for: report(rest: rest), inHandFallback: nil, restFirstSeen: at(155)).restStart == endsAt)

    // The first sighting is kept while the rest is the same one…
    var (start, held) = LiveSession.restStart(for: report(rest: rest), receivedAt: t0, held: nil)
    #expect(start == t0)
    (start, held) = LiveSession.restStart(for: report(rest: rest), receivedAt: at(30), held: held)
    #expect(start == t0)
    // …and when +30 s moves the end of the same set's rest on.
    let longer = WatchStateReport.Rest(endsAt: WatchSession.isoString(at(180)), upNext: rest.upNext)
    (start, held) = LiveSession.restStart(for: report(rest: longer), receivedAt: at(40), held: held)
    #expect(start == t0)
    // A new rest after another set starts again.
    let next = WatchStateReport.Rest(endsAt: WatchSession.isoString(at(400)), upNext: rest.upNext)
    (start, held) = LiveSession.restStart(for: report(setId: "s-2", rest: next), receivedAt: at(250), held: held)
    #expect(start == at(250))
    // No rest, nothing held.
    (start, held) = LiveSession.restStart(for: report(), receivedAt: at(260), held: held)
    #expect(start == nil && held == nil)
    // A build 7 report's own start wins over any sighting.
    let exact = WatchStateReport.Rest(endsAt: WatchSession.isoString(at(400)), startedAt: WatchSession.isoString(at(240)), upNext: rest.upNext)
    (start, _) = LiveSession.restStart(for: report(setId: "s-2", rest: exact), receivedAt: at(250), held: nil)
    #expect(start == at(240))
}

@Test func thePhoneTakingLoggingBackShowsSo() {
    #expect(LiveSession.content(for: report(owner: .phone), inHandFallback: nil, restFirstSeen: nil).phase == .onPhone)
}

/// The reports TypeScript writes (fixtures/watch/state.json) come out as the
/// Live Activity should show them.
@Test func theStateFixturesShowAsTheyShould() throws {
    let data = try Data(contentsOf: fixturesFolder.appendingPathComponent("state.json"))
    let cases = try #require(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    func decoded(_ prefix: String) throws -> WatchStateReport {
        let object = try #require(cases.first { ($0["name"] as? String)?.hasPrefix(prefix) == true }?["report"] as? [String: Any])
        return try JSONDecoder().decode(WatchStateReport.self, from: JSONSerialization.data(withJSONObject: object))
    }
    let full = try decoded("every field")
    let content = LiveSession.content(for: full, inHandFallback: nil, restFirstSeen: nil)
    #expect(content.phase == .resting)
    #expect(content.exercise == "Lift a" && content.detail == "Set 3 of 3 · 100 × 5")
    #expect(content.restStart == WatchSession.date("2026-10-14T17:30:30.000Z"))
    #expect(content.restEnd == WatchSession.date("2026-10-14T17:33:00.000Z"))
    #expect(content.pausedAt == WatchSession.date("2026-10-14T17:31:00.000Z"))
    #expect(content.heartRate == 128)
    #expect(LiveSession.staleAfter(full) == LiveSession.pausedStaleAfter)

    let quiet = try decoded("running with nothing new")
    #expect(LiveSession.content(for: quiet, inHandFallback: nil, restFirstSeen: nil).phase == .onPhone)
}

// MARK: - Title and start

@Test func theTitleSurvivesARemintOnTheWrist() throws {
    // The wrist discarded and started the ready session again under IDs it
    // minted: no snapshot carries the new workout ID yet, but the start event
    // names the same routine as the ready session.
    let context = try WatchContext.decode(JSONSerialization.data(withJSONObject: contextObject(ready: readyObject())))
    let ready = try #require(context.home.ready)
    let start = WatchEvent(id: "e-1", kind: .startWorkout, workoutId: "w-minted", at: WatchSession.isoString(at(-90)), routineId: ready.routineId)
    let facts = LiveSession.facts(workoutId: "w-minted", context: context, startEvents: [start], firstSeen: t0)
    #expect(facts.title == ready.snapshot.title)
    #expect(facts.startedAt == at(-90))
    // Nothing to go on: a plain title, from the first report.
    let bare = LiveSession.facts(workoutId: "w-unknown", context: nil, startEvents: [], firstSeen: t0)
    #expect(bare == LiveSessionFacts(title: "Workout", startedAt: t0))
}

@Test func encodedStateStaysWellUnderFourKilobytes() throws {
    let long = String(repeating: "Single-Arm Cable Lateral Raise ", count: 4)
    let content = LiveSessionContent(
        phase: .resting, exercise: long, detail: long, restStart: t0, restEnd: t0, upNext: long, upNextDetail: long,
        heartRate: 180, pausedAt: t0
    )
    #expect(try JSONEncoder().encode(content).count < 2048)
    #expect(try JSONDecoder().decode(LiveSessionContent.self, from: JSONEncoder().encode(content)) == content)
}
