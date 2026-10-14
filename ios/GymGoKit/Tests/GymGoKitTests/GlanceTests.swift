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
