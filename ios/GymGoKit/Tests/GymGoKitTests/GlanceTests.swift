import Foundation
import Testing
@testable import GymGoKit

// The watch face reads what the app wrote, on a clock that keeps going.

/// The inputs as the complications get them: through the file.
private func throughTheFile(_ inputs: TodayInputs?) throws -> TodayInputs? {
    try JSONDecoder().decode(TodayInputs?.self, from: JSONEncoder().encode(inputs))
}

/// A state for every kind of Today card, and the clocks to read it at.
private func everyKindOfToday() throws -> [(String, WatchAppState, [Date])] {
    let clocks = [minute(6), minute(6).addingTimeInterval(24 * 3600), minute(6).addingTimeInterval(3 * 24 * 3600)]
    var cases: [(String, WatchAppState, [Date])] = [("no phone", WatchAppState(), clocks)]

    var ready = WatchAppState()
    ready.apply(try context(ready: readyObject(), doneToday: [["workoutId": "w-0", "name": "Pull A"]]))
    cases.append(("ready today", ready, clocks))

    var later = WatchAppState()
    later.apply(try context(ready: readyObject(date: "2026-10-16", status: "upcoming", movedFrom: "2026-10-12")))
    cases.append(("ready later", later, clocks + [noonOn("2026-10-16"), noonOn("2026-10-24")]))

    var started = WatchAppState()
    started.apply(try context(ready: readyObject()))
    _ = started.start(try #require(started.home?.ready), at: minute(6), eventId: "start")
    _ = started.logSet(weight: 100, reps: 5, at: minute(8))
    _ = started.finish(at: minute(30))
    cases.append(("started", started, clocks))

    var waiting = WatchAppState()
    waiting.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(minute(5)))))
    _ = waiting.logSet(weight: 100, reps: 5, at: minute(6))
    _ = waiting.finish(at: minute(7))
    cases.append(("waiting for the phone", waiting, clocks))

    var discardedLive = WatchAppState()
    discardedLive.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(minute(5)))))
    _ = discardedLive.discard(at: minute(6))
    cases.append(("discarded, open on the phone", discardedLive, clocks))

    // The fixture's layout lists no exercises: not one the watch can lay out
    // again under new IDs.
    var discardedReady = WatchAppState()
    discardedReady.apply(try context(ready: readyObject()))
    _ = discardedReady.start(try #require(discardedReady.home?.ready), at: minute(6), eventId: "start")
    _ = discardedReady.discard(at: minute(7))
    cases.append(("discarded, offered", discardedReady, clocks))

    var onPhone = WatchAppState()
    onPhone.apply(try context(state: "running"))
    cases.append(("running on the phone", onPhone, clocks))

    var blockDone = WatchAppState()
    blockDone.apply(try context(state: "blockDone", doneToday: [["workoutId": "w-0", "name": "Legs B"]]))
    cases.append(("block done", blockDone, clocks))

    var noPlan = WatchAppState()
    noPlan.apply(try context(state: "noPlan"))
    cases.append(("no plan", noPlan, clocks))
    return cases
}

/// Noon on a London day.
private func noonOn(_ day: String) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = london
    let parts = day.split(separator: "-").compactMap { Int($0) }
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))!
}

@Test func theFaceWordsEveryKindOfTodayAsTheTodayPageDoes() throws {
    var kinds: [TodayCard.Kind] = []
    for (name, state, clocks) in try everyKindOfToday() {
        let inputs = try throughTheFile(state.todayInputs)
        for clock in clocks {
            let page = state.todayCard(now: clock, timeZone: london)
            #expect(TodayCard(inputs, now: clock, timeZone: london) == page, "\(name) at \(iso(clock))")
            kinds.append(page.kind)
        }
    }
    let every: [TodayCard.Kind] = [.noPhone, .ready, .started, .waitingForPhone, .discarded, .runningOnPhone, .blockDone, .noPlan]
    #expect(every.allSatisfy(kinds.contains))
}

@Test func everyKindOfTodayKeepsItsWords() throws {
    let cards = try everyKindOfToday().map { name, state, clocks in (name, state.todayCard(now: clocks[0], timeZone: london)) }
    let headings = Dictionary(uniqueKeysWithValues: cards.map { ($0.0, $0.1.heading) })
    #expect(headings == [
        "no phone": "GymGo",
        "ready today": "Today · Week 3 of 5",
        "ready later": "Next · Fri",
        "started": "Done today",
        "waiting for the phone": "Done today",
        "discarded, open on the phone": "Discarded",
        "discarded, offered": "Discarded",
        "running on the phone": "On your iPhone",
        "block done": "Block done",
        "no plan": "No session planned",
    ])
    let kinds = Dictionary(uniqueKeysWithValues: cards.map { ($0.0, $0.1.kind) })
    #expect(kinds["started"] == .started && kinds["waiting for the phone"] == .waitingForPhone)
    #expect(kinds["discarded, offered"] == .discarded && kinds["discarded, open on the phone"] == .discarded)
}

// MARK: - The glance and its moments

private func glance(_ state: WatchAppState, at date: Date, previous: WatchGlance? = nil) -> WatchGlance {
    WatchGlance(state, now: date, previous: previous, timeZone: london)
}

/// 00:00 on a London day.
private func midnight(_ day: String) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = london
    let parts = day.split(separator: "-").compactMap { Int($0) }
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))!
}

@Test func nextFridayBecomesTodayAtMidnightWithNoReload() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject(date: "2026-10-16", status: "upcoming")))
    let moments = glance(state, at: minute(6)).moments(from: minute(6), timeZone: london)

    #expect(moments.count == 8)
    #expect(moments[0].card.heading == "Next · Fri")
    let friday = try #require(moments.first { $0.day == "2026-10-16" })
    #expect(friday.date == midnight("2026-10-16"))
    #expect(friday.card.heading == "Today · Week 3 of 5")
    #expect(friday.card.startLabel == "Start")
}

@Test func doneTodayEmptiesAtMidnight() throws {
    var state = WatchAppState()
    state.apply(try context(doneToday: [["workoutId": "w-0", "name": "Pull A"]]))
    let moments = glance(state, at: minute(6)).moments(from: minute(6), timeZone: london)
    #expect(moments[0].card.doneToday == ["Pull A"])
    #expect(moments[1].card.doneToday.isEmpty)
}

@Test func theMidnightsFollowTheClocksGoingBack() throws {
    // BST ends on Sunday 25 Oct 2026: that day is 25 hours long.
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let saturday = noonOn("2026-10-24")
    let moments = glance(state, at: saturday).moments(from: saturday, days: 3, timeZone: london)
    #expect(moments.map(\.day) == ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"])
    #expect(moments[2].date.timeIntervalSince(moments[1].date) == 25 * 3600)
}

@Test func theWeekRingCountsTrainingDaysAndGoesBlankOnceTheWeekIsOver() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let moments = glance(state, at: minute(6)).moments(from: minute(6), days: 7, timeZone: london)

    #expect(moments[0].week.map(\.letter) == ["M", "T", "W", "T", "F", "S", "S"])
    #expect(moments[0].week.filter(\.isToday).map(\.spoken) == ["Wed, today, Pull A, planned"])
    #expect(moments[0].planned == 3 && moments[0].done == 1)
    // Monday 19 Oct: the phone's week has not been sent; no marks for the old one.
    let monday = try #require(moments.first { $0.day == "2026-10-19" })
    #expect(monday.week.isEmpty && monday.planned == 0)
}

@Test func aWristStartSaysDoneTodayOnlyOnItsDay() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    _ = state.start(try #require(state.home?.ready), at: minute(6), eventId: "start")
    let running = glance(state, at: minute(6))
    #expect(running.doneHereDay == nil)
    _ = state.logSet(weight: 100, reps: 5, at: minute(8))
    _ = state.finish(at: minute(30))

    let after = glance(state, at: minute(31), previous: running)
    #expect(after.doneHereDay == "2026-10-14")
    let moments = after.moments(from: minute(31), timeZone: london)
    #expect(moments[0].card.heading == "Done today" && moments[0].doneHereToday)
    #expect(moments[0].week.first { $0.isToday }?.state == .done)
    // Thursday, the phone still not caught up: done Wednesday, not today.
    #expect(moments[1].card.heading == "Done · Wed" && !moments[1].doneHereToday)
    #expect(moments[1].card.title == "Push A")

    // Written again the next day, with the phone still not caught up: the day stays.
    let nextDay = glance(state, at: midnight("2026-10-15").addingTimeInterval(3600), previous: after)
    #expect(nextDay.doneHereDay == "2026-10-14")
}

@Test func aPhoneStartedWorkoutFinishedOnTheWristSaysDoneTodayOnlyOnItsDay() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(minute(5)))))
    let running = glance(state, at: minute(5))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    _ = state.finish(at: minute(7))
    #expect(state.todayCard(now: minute(8), timeZone: london).kind == .waitingForPhone)

    let after = glance(state, at: minute(8), previous: running)
    #expect(after.doneHereDay == "2026-10-14")
    let moments = after.moments(from: minute(8), timeZone: london)
    #expect(moments[0].card.heading == "Done today")
    #expect(moments[1].card.heading == "Done · Wed")
    #expect(moments[1].card.message == "It saves on your iPhone next time you open GymGo.")
}

@Test func aSessionFinishedAfterMidnightIsDoneOnTheDayItBegan() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let lateStart = midnight("2026-10-15").addingTimeInterval(-10 * 60)
    _ = state.start(try #require(state.home?.ready), at: lateStart, eventId: "start")
    let running = glance(state, at: lateStart)
    _ = state.logSet(weight: 100, reps: 5, at: lateStart.addingTimeInterval(120))
    let afterMidnight = midnight("2026-10-15").addingTimeInterval(30 * 60)
    _ = state.finish(at: afterMidnight)
    #expect(glance(state, at: afterMidnight, previous: running).doneHereDay == "2026-10-14")
}

@Test func aRestUnderWayEndsInItsOwnMoment() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    _ = state.start(try #require(state.home?.ready), at: minute(6), eventId: "start")
    let logged = state.logSet(weight: 100, reps: 5, at: minute(8))
    #expect(logged != nil)
    let rest = try #require(state.rest)

    let now = minute(8.5)
    let moments = glance(state, at: now).moments(from: now, timeZone: london)
    #expect(Array(moments.map(\.date).prefix(2)) == [now, rest.endsAt])
    #expect(moments.count == 9)
    guard case .resting(let session, let resting) = moments[0].phase else { Issue.record("not resting"); return }
    #expect(resting.endsAt == rest.endsAt && session.setsDone == 1)
    guard case .session = moments[1].phase else { Issue.record("still resting after the rest"); return }
}

@Test func theGlanceRoundTripsAndAnUnreadableOneIsNone() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let written = glance(state, at: minute(6))
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("glance-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }
    try written.encoded().write(to: url)
    #expect(WatchGlance.read(from: url) == written)

    try Data("{\"v\": 99}".utf8).write(to: url)
    #expect(WatchGlance.read(from: url) == nil)
    try Data("not json".utf8).write(to: url)
    #expect(WatchGlance.read(from: url) == nil)
    // No App Group: no URL, and the face says where to go.
    #expect(WatchGlance.read(from: nil) == nil)
    let empty = WatchGlance.empty.moments(from: minute(6), timeZone: london)[0]
    #expect(empty.card.kind == .noPhone && empty.card.message?.hasPrefix("Open GymGo on your iPhone") == true)
}

// MARK: - Reloads

@Test func aRestThatRanOutNeedsNoReloadButAnythingElseDoes() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    _ = state.start(try #require(state.home?.ready), at: minute(6), eventId: "start")
    _ = state.logSet(weight: 100, reps: 5, at: minute(8))
    let resting = glance(state, at: minute(8))
    let rest = try #require(state.rest)
    #expect(!resting.needsReload(over: resting, now: minute(9)))

    // Run out: the timeline's entry at its end already shows this.
    var ranOut = state
    let ranOutNow = ranOut.restRanOut(id: rest.id)
    #expect(ranOutNow)
    let over = glance(ranOut, at: rest.endsAt, previous: resting)
    #expect(over != resting)
    #expect(!over.needsReload(over: resting, now: rest.endsAt))

    // Skipped early: the timeline still shows the countdown.
    var skipped = state
    _ = skipped.skipRest(at: minute(8.5))
    #expect(glance(skipped, at: minute(8.5), previous: resting).needsReload(over: resting, now: minute(8.5)))

    // +30 s moves its end.
    var longer = state
    _ = longer.adjustRest(by: 30, now: minute(8.5))
    #expect(glance(longer, at: minute(8.5), previous: resting).needsReload(over: resting, now: minute(8.5)))

    // Run out, and a set logged with it: reload.
    var more = ranOut
    _ = more.logSet(weight: 100, reps: 5, at: rest.endsAt)
    _ = more.skipRest(at: rest.endsAt)
    #expect(glance(more, at: rest.endsAt, previous: resting).needsReload(over: resting, now: rest.endsAt))

    // The first glance ever written.
    #expect(resting.needsReload(over: nil, now: minute(8)))
}

// MARK: - The Smart Stack

@Test func theSmartStackOffersGymGoInEachTrainingDaysWakingHours() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let windows = glance(state, at: minute(6)).relevantWindows(from: minute(6), timeZone: london)
    // Wednesday (today, the session on offer) and Friday; Monday is done.
    #expect(windows.map { localDay($0.start, timeZone: london) } == ["2026-10-14", "2026-10-16"])
    let wednesday = try #require(windows.first)
    #expect(wednesday.start == midnight("2026-10-14").addingTimeInterval(5 * 3600))
    #expect(wednesday.end == midnight("2026-10-14").addingTimeInterval(22 * 3600))

    // Late at night today's window is over.
    let late = midnight("2026-10-14").addingTimeInterval(23 * 3600)
    let lateDays = glance(state, at: late).relevantWindows(from: late, timeZone: london).map { localDay($0.start, timeZone: london) }
    #expect(lateDays == ["2026-10-16"])

    // Done on the wrist: today drops out.
    _ = state.start(try #require(state.home?.ready), at: minute(6), eventId: "start")
    let running = glance(state, at: minute(6))
    _ = state.logSet(weight: 100, reps: 5, at: minute(8))
    _ = state.finish(at: minute(30))
    let done = glance(state, at: minute(31), previous: running)
    #expect(done.trainingDays(from: minute(31), timeZone: london) == ["2026-10-16"])
}
