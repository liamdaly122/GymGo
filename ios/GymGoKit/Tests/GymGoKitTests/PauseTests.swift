import Foundation
import Testing
@testable import GymGoKit

// Pause and resume, and the Action button: the pure rules (Pause.swift).

// MARK: - Both buttons together: HealthKit's pauseOrResumeRequest

@Test func aRequestTogglesOnTheSessionsOwnState() {
    #expect(PauseRequest.answer(.running, lastAsked: nil, now: minute(0)) == .pause)
    #expect(PauseRequest.answer(.paused, lastAsked: nil, now: minute(0)) == .resume)
    #expect(PauseRequest.answer(.other, lastAsked: nil, now: minute(0)) == nil)
}

@Test func aRequestRightAfterAnAskedForPauseIsItsEchoAndIgnored() {
    // The Ultra's Action and side buttons call the pause intent; if HealthKit
    // also raises the request, toggling on it would resume straight away.
    let asked = minute(0)
    #expect(PauseRequest.answer(.paused, lastAsked: asked, now: asked) == nil)
    #expect(PauseRequest.answer(.paused, lastAsked: asked, now: asked.addingTimeInterval(1.9)) == nil)
    // And the mirror: a resume's echo must not pause again.
    #expect(PauseRequest.answer(.running, lastAsked: asked, now: asked.addingTimeInterval(0.5)) == nil)
    // An echo that arrives before the intent is handled on the main actor is
    // still inside the window.
    #expect(PauseRequest.answer(.running, lastAsked: asked, now: asked.addingTimeInterval(-0.3)) == nil)
}

@Test func aRequestTwoSecondsOnIsTheLiftersOwn() {
    let asked = minute(0)
    #expect(PauseRequest.answer(.paused, lastAsked: asked, now: asked.addingTimeInterval(2)) == .resume)
    #expect(PauseRequest.answer(.running, lastAsked: asked, now: asked.addingTimeInterval(30)) == .pause)
}

// MARK: - Health's active time

@Test func activeTimeRunsOnFromItsReading() {
    let read = ActiveTime(seconds: 600, at: minute(0), running: true)
    #expect(read.seconds(at: minute(0)) == 600)
    #expect(read.seconds(at: minute(1)) == 660)
    // A clock asked about a moment before the reading never goes backwards.
    #expect(read.seconds(at: minute(-1)) == 600)
}

@Test func activeTimeStandsStillWhilePaused() {
    let paused = ActiveTime(seconds: 600, at: minute(0), running: false)
    #expect(paused.seconds(at: minute(0)) == 600)
    #expect(paused.seconds(at: minute(45)) == 600)
}

@Test func activeTimeIsNeverNegative() {
    #expect(ActiveTime(seconds: -3, at: minute(0), running: false).seconds(at: minute(1)) == 0)
}

// MARK: - A press mid-session

@Test func aPressWhileThePhoneLogsDoesNothingButResume() {
    #expect(ActionPress.decide(phoneLogs: true, paused: false, resting: true, setInHand: true) == .nothing)
    #expect(ActionPress.decide(phoneLogs: true, paused: false, resting: false, setInHand: false) == .nothing)
    // Resuming touches no sets, so it cannot fight the phone, and no set
    // logged on the phone resumes Health.
    #expect(ActionPress.decide(phoneLogs: true, paused: true, resting: true, setInHand: true) == .resume)
}

@Test func aPressWhilePausedResumesWhateverElseIsOnScreen() {
    #expect(ActionPress.decide(phoneLogs: false, paused: true, resting: true, setInHand: true) == .resume)
    #expect(ActionPress.decide(phoneLogs: false, paused: true, resting: false, setInHand: true) == .resume)
    #expect(ActionPress.decide(phoneLogs: false, paused: true, resting: false, setInHand: false) == .resume)
}

@Test func aPressDuringARestSkipsItEvenWithASetInHand() {
    #expect(ActionPress.decide(phoneLogs: false, paused: false, resting: true, setInHand: true) == .skipRest)
    #expect(ActionPress.decide(phoneLogs: false, paused: false, resting: true, setInHand: false) == .skipRest)
}

@Test func aPressWithASetInHandLogsIt() {
    #expect(ActionPress.decide(phoneLogs: false, paused: false, resting: false, setInHand: true) == .logSet)
}

@Test func aPressWithNothingToDoDoesNothingAndNeverFinishes() {
    // Every set logged, the summary up, or no session at all.
    #expect(ActionPress.decide(phoneLogs: false, paused: false, resting: false, setInHand: false) == .nothing)
}

// MARK: - The first press: today's session, worded as the Today card words it

@Test func theFirstPressStartsASessionDueToday() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    #expect(ActionButtonStart.decide(state.todayCard(now: minute(6), timeZone: london)) == .start)
}

@Test func theFirstPressNeverTrainsALaterDay() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject(date: "2026-10-16", status: "upcoming")))
    let card = state.todayCard(now: minute(6), timeZone: london)
    #expect(card.startLabel == "Start early")
    #expect(ActionButtonStart.decide(card) == .refuse("Not due today: start it on the watch"))
}

@Test func aRefusedPressSaysWhatTheTodayCardSays() throws {
    #expect(ActionButtonStart.decide(WatchAppState().todayCard(now: minute(0), timeZone: london))
        == .refuse("Open GymGo on your iPhone to load your sessions."))

    var noPlan = WatchAppState()
    noPlan.apply(try context(state: "noPlan"))
    #expect(ActionButtonStart.decide(noPlan.todayCard(now: minute(6), timeZone: london))
        == .refuse("No session planned. Plan one on your iPhone, or start a workout there."))

    var blockDone = WatchAppState()
    blockDone.apply(try context(state: "blockDone"))
    #expect(ActionButtonStart.decide(blockDone.todayCard(now: minute(6), timeZone: london))
        == .refuse("Block done. Start the next one on your iPhone."))

    var phone = WatchAppState()
    phone.apply(try context(state: "running"))
    #expect(ActionButtonStart.decide(phone.todayCard(now: minute(6), timeZone: london))
        == .refuse("A workout is open on your iPhone."))
}

@Test func aPressAfterTodaysSessionSaysItIsDone() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let ready = try #require(state.home?.ready)
    #expect(state.start(ready, at: minute(6)) != nil)
    #expect(state.finish(at: minute(50)) != nil)
    let card = state.todayCard(now: minute(51), timeZone: london)
    #expect(card.kind == .started)
    #expect(ActionButtonStart.decide(card) == .refuse("Done today. Next session loads from your iPhone."))
}

@Test func everyRefusalOfTheCardsReadsAsTheCard() {
    // Every kind of card that cannot start gives a reason, and the reason
    // carries the card's own message, so the two never drift apart.
    let kinds: [TodayCard.Kind] = [.noPhone, .started, .waitingForPhone, .discarded, .runningOnPhone, .blockDone, .noPlan]
    for kind in kinds {
        let card = TodayCard(kind: kind, heading: "Heading", message: "The card's message.")
        guard case .refuse(let reason) = ActionButtonStart.decide(card) else {
            Issue.record("\(kind) should refuse")
            continue
        }
        #expect(reason.hasSuffix("The card's message."))
    }
}

@Test func healthNotRecordingSaysWhyAndThatTheSessionRunsOn() {
    #expect(ActionButtonStart.notRecording(.denied).hasPrefix("Turn on Health for GymGo"))
    for health in [WatchStateReport.Health.denied, .unavailable, .off] {
        #expect(ActionButtonStart.notRecording(health).hasSuffix("The session runs without it."))
    }
}
