import Foundation
import Testing
@testable import GymGoKit

// MARK: - Haptics: the contract's table

@Test func everyCueIsTheContractsSequence() {
    func kinds(_ cue: WatchCue) -> [String] { cue.steps.map { "\($0.after):\($0.kind.rawValue)" } }
    #expect(kinds(.workoutStarted) == ["0:start"])
    #expect(kinds(.restBegins) == ["0:stop", "250:directionDown"])
    #expect(kinds(.partnerNext) == ["0:directionUp"])
    #expect(kinds(.lastSetOfExercise) == ["0:stop", "300:success"])
    #expect(kinds(.record) == ["0:success", "700:success"])
    #expect(kinds(.tenSecondsLeft) == ["0:retry"])
    #expect(kinds(.countdown) == ["0:click"])
    #expect(kinds(.restOver) == ["0:notification", "600:notification", "600:start"])
    #expect(kinds(.restAdjusted) == ["0:click"])
    #expect(kinds(.endedOnPhone) == ["0:stop", "500:directionDown"])
    #expect(kinds(.savedToHealth) == ["0:success"])
    #expect(kinds(.failed) == ["0:failure"])
}

@Test func tapsAreSpacedSoNoneIsCutOff() {
    for cue in WatchCue.allCases {
        let steps = cue.steps
        #expect(steps.first?.after == 0, "\(cue)")
        for (previous, step) in zip(steps, steps.dropFirst()) {
            #expect(step.after >= (previous.kind.isLong ? 600 : 250), "\(cue): \(previous.kind) then \(step.kind)")
        }
    }
}

@Test func aRecordBeatsTheLastSetWhichBeatsTheRest() {
    #expect(cueForLoggedSet(record: true, lastOfExercise: true, rests: true) == .record)
    #expect(cueForLoggedSet(record: false, lastOfExercise: true, rests: true) == .lastSetOfExercise)
    #expect(cueForLoggedSet(record: false, lastOfExercise: false, rests: true) == .restBegins)
    #expect(cueForLoggedSet(record: false, lastOfExercise: false, rests: false) == .partnerNext)
}

@Test func aLongRestWarnsAtTenThenCountsThreeTwoOne() {
    let ends = minute(10)
    let cues = restCues(endsAt: ends, seconds: 90, now: minute(8.5))
    #expect(cues.map(\.cue) == [.tenSecondsLeft, .countdown, .countdown, .countdown, .restOver])
    #expect(cues.map { $0.at.timeIntervalSince(ends) } == [-10, -3, -2, -1, 0])
}

@Test func aShortRestHasNoTenSecondWarning() {
    let cues = restCues(endsAt: minute(1), seconds: 15, now: minute(0.75))
    #expect(cues.map(\.cue) == [.countdown, .countdown, .countdown, .restOver])
}

@Test func onlyTheWarningsStillToComeAreScheduled() {
    let ends = minute(10)
    let late = restCues(endsAt: ends, seconds: 90, now: ends.addingTimeInterval(-2.5))
    #expect(late.map(\.cue) == [.countdown, .countdown, .restOver])
    let over = restCues(endsAt: ends, seconds: 90, now: ends.addingTimeInterval(5))
    #expect(over.map(\.cue) == [.restOver])
}

// MARK: - The Today page

@Test func todayWithTheWeek() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let card = state.todayCard(now: minute(6), timeZone: london)
    #expect(card.kind == .ready)
    #expect(card.heading == "Today · Week 3 of 5")
    #expect(card.title == "Push A")
    #expect(card.detail == "2 exercises · about 55 min")
    #expect(card.startLabel == "Start")
    #expect(card.movedFrom == nil)
}

@Test func aRolledSessionSaysWhereItWasMeantToBe() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject(movedFrom: "2026-10-12")))
    #expect(state.todayCard(now: minute(6), timeZone: london).movedFrom == "Moved from Mon")
}

@Test func doneTodayThenNextOnItsDay() throws {
    var state = WatchAppState()
    state.apply(try context(
        ready: readyObject(date: "2026-10-16", status: "upcoming"),
        doneToday: [["workoutId": "w-0", "name": "Pull A"]]
    ))
    let card = state.todayCard(now: minute(6), timeZone: london)
    #expect(card.kind == .ready)
    #expect(card.heading == "Next · Fri")
    #expect(card.doneToday == ["Pull A"])
    #expect(card.startLabel == "Start early")
}

@Test func yesterdaysDataRollsTheSessionToToday() throws {
    var state = WatchAppState()
    state.apply(try context(
        ready: readyObject(date: "2026-10-14", status: "today"), today: "2026-10-14",
        doneToday: [["workoutId": "w-0", "name": "Pull A"]]
    ))
    let tomorrow = minute(6).addingTimeInterval(24 * 3600)
    let card = state.todayCard(now: tomorrow, timeZone: london)
    #expect(card.heading == "Today · Week 3 of 5")
    #expect(card.startLabel == "Start")
    // What the phone called done "today" was done yesterday.
    #expect(card.doneToday.isEmpty)
}

@Test func farOffSessionsGiveTheDate() {
    #expect(dayLabel("2026-10-24", from: "2026-10-14", timeZone: london) == "24 Oct")
    #expect(dayLabel("2026-10-15", from: "2026-10-14", timeZone: london) == "Thu")
    #expect(localDay(Date(timeIntervalSince1970: 1_792_018_800), timeZone: london) == "2026-10-15") // 23:00 UTC, midnight in London
}

@Test func theOtherStates() throws {
    #expect(WatchAppState().todayCard(now: minute(0), timeZone: london).kind == .noPhone)

    var noPlan = WatchAppState()
    noPlan.apply(try context(state: "noPlan"))
    #expect(noPlan.todayCard(now: minute(6), timeZone: london).kind == .noPlan)
    #expect(!noPlan.todayCard(now: minute(6), timeZone: london).canStart)

    var blockDone = WatchAppState()
    blockDone.apply(try context(state: "blockDone"))
    let done = blockDone.todayCard(now: minute(6), timeZone: london)
    #expect(done.kind == .blockDone)
    #expect(done.message == "Start the next one on your iPhone.")

    // The phone has a workout open that ended up claimed elsewhere: shown, not offered.
    var phone = WatchAppState()
    phone.apply(try context(state: "running"))
    #expect(phone.todayCard(now: minute(6), timeZone: london).kind == .runningOnPhone)
}

@Test func endingAStrayRecordingSaysOnTheButtonThatItIsNotSaved() {
    // End throws the Health workout away; it used to save it. A lifter who
    // reads only the button must not expect it saved.
    #expect(StrayRecording.endLabel.localizedCaseInsensitiveContains("not saved"))
    #expect(StrayRecording.endSpoken.localizedCaseInsensitiveContains("not saved"))
    #expect(StrayRecording.endSpoken.localizedCaseInsensitiveContains("Health"))
}
