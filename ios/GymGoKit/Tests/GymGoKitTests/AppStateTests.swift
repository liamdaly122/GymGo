import Foundation
import Testing
@testable import GymGoKit

// The contract's rules for applying a context, owning the logging and
// reporting state (docs/watch-protocol.md), held to by WatchAppState.

private func live(_ workoutId: String = "w-1", sentAt: Date = minute(5), name: String = "two straight lifts") throws -> [String: Any] {
    try snapshotObject(name, workoutId: workoutId, sentAt: iso(sentAt))
}

private func closed(_ workoutId: String, _ how: String, at: Date = minute(20)) -> [String: Any] {
    ["workoutId": workoutId, "how": how, "at": iso(at)]
}

private func claim(_ workoutId: String, at: Date) -> [String: Any] {
    ["workoutId": workoutId, "at": iso(at)]
}

// MARK: - The context

@Test func anOlderContextIsIgnored() throws {
    var state = WatchAppState()
    #expect(state.apply(try context(sentAt: minute(5), vibrate: false)).applied)
    let older = state.apply(try context(sentAt: minute(4), live: live()))
    #expect(!older.applied)
    #expect(state.session == nil)
    #expect(state.settings.vibrate == false)
    #expect(state.lastSentAt == iso(minute(5)))
    // The same moment again is not older.
    #expect(state.apply(try context(sentAt: minute(5))).applied)
}

@Test func settingsHomeAndClaimFollowTheNewestContext() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(1), vibrate: false))
    #expect(state.settings == WatchSettings(sound: true, vibrate: false))
    #expect(state.home?.state == .noPlan)
    state.apply(try context(sentAt: minute(2), ready: readyObject()))
    #expect(state.settings.vibrate)
    #expect(state.home?.state == .ready)
    #expect(state.home?.ready?.key == "plan-1:3:1")
    #expect(state.home?.week.count == 7)
}

@Test func theLiveWorkoutIsAdoptedWhenNothingRuns() throws {
    var state = WatchAppState()
    let change = state.apply(try context(live: live("w-1")))
    #expect(change.adopted == "w-1")
    #expect(change.replaced == nil)
    #expect(state.session?.workoutId == "w-1")
    #expect(state.owner == .watch)
    #expect(state.setInHand?.set.id == "a-s0")
    #expect(state.liveWorkoutId == "w-1")
}

@Test func aLiveWorkoutThatEndedOnThePhoneIsNotAdopted() throws {
    var state = WatchAppState()
    let change = state.apply(try context(live: live("w-1"), closed: [closed("w-1", "discarded")]))
    #expect(change.adopted == nil)
    #expect(state.session == nil)
}

@Test func aLiveWorkoutThatEndedHereIsNotAdoptedAgain() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.finish(at: minute(30), eventId: "fin")
    #expect(state.session == nil)
    // The phone has not drained the finish yet: it still sends the workout as open.
    let stale = state.apply(try context(sentAt: minute(31), live: live("w-1", sentAt: minute(31))))
    #expect(stale.adopted == nil)
    #expect(state.session == nil)
    #expect(state.todayCard(now: minute(31), timeZone: london).kind == .waitingForPhone)
}

@Test func theRunningSessionTakesItsOwnWorkoutsNewerList() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")
    _ = state.logSet(weight: 100, reps: 5, at: minute(9), eventId: "s2")

    // The phone has applied the first set only.
    var newer = try live("w-1", sentAt: minute(10))
    var sets = newer["sets"] as! [[String: Any]]
    sets.removeFirst()
    newer["sets"] = sets
    var lifts = newer["lifts"] as! [String: Any]
    var lift = lifts["ex-a"] as! [String: Any]
    lift["doneToday"] = [["setId": "a-s0", "weight": 100, "reps": 5, "completedAt": iso(minute(6))]]
    lifts["ex-a"] = lift
    newer["lifts"] = lifts

    let change = state.apply(try context(sentAt: minute(10), live: newer))
    #expect(change.updated)
    #expect(change.adopted == nil)
    #expect(state.session?.logged.keys.sorted() == ["a-s1"])
    #expect(state.setInHand?.set.id == "a-s2")
}

@Test func anotherLiveWorkoutWaitsUntilTheWristHasNothingUnconfirmed() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")

    let waiting = state.apply(try context(sentAt: minute(7), live: live("w-2", sentAt: minute(7))))
    #expect(waiting.adopted == nil)
    #expect(state.session?.workoutId == "w-1")

    state.acknowledge(["s1"])
    let replaced = state.apply(try context(sentAt: minute(8), live: live("w-2", sentAt: minute(8))))
    #expect(replaced.adopted == "w-2")
    #expect(replaced.replaced == "w-1")
    #expect(state.session?.workoutId == "w-2")
    #expect(state.rest == nil)
}

@Test func finishOnThePhoneEndsTheSessionWithASummary() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")
    #expect(state.rest != nil)

    let change = state.apply(try context(sentAt: minute(20), closed: [closed("w-1", "finished", at: minute(19))]))
    #expect(change.ended?.how == .finished)
    #expect(state.session == nil)
    #expect(state.rest == nil)
    let summary = try #require(state.summary)
    #expect(summary.how == .finishedOnPhone)
    #expect(summary.workoutId == "w-1")
    #expect(summary.title == "Push A")
    #expect(summary.setsDone == 1)
    #expect(summary.setsTotal == 6)
    #expect(summary.endedAt == iso(minute(19)))
    #expect(summary.duration == 19 * 60)
    // The wrist's unconfirmed set is still resent until the phone says it has it.
    #expect(state.unconfirmed.map(\.id) == ["s1"])
    let report = state.report(at: minute(20), heartRate: 120, activeKcal: 80, health: .off)
    #expect(report.session == .ended)
    #expect(report.workoutId == "w-1")
    #expect(report.heartRate == nil)
}

@Test func discardOnThePhoneEndsTheSessionWithoutOne() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    let change = state.apply(try context(sentAt: minute(6), closed: [closed("w-1", "discarded", at: minute(6))]))
    #expect(change.ended?.how == .discarded)
    #expect(state.session == nil)
    #expect(state.summary == nil)
    // A late context that still has it open does not bring it back.
    let late = state.apply(try context(sentAt: minute(7), live: live("w-1", sentAt: minute(7))))
    #expect(late.adopted == nil)
}

@Test func aClosedWorkoutForAnotherSessionLeavesTheRunningOneAlone() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1"), closed: [closed("w-0", "finished", at: minute(1))]))
    #expect(state.session?.workoutId == "w-1")
    let change = state.apply(try context(sentAt: minute(6), live: live("w-1", sentAt: minute(6)), closed: [closed("w-0", "finished", at: minute(1))]))
    #expect(change.ended == nil)
    #expect(state.session?.workoutId == "w-1")
}

// MARK: - Starting on the wrist

@Test func theReadySessionStartsOnceAndOnlyOnce() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let ready = try #require(state.home?.ready)
    #expect(state.todayCard(now: minute(6), timeZone: london).canStart)

    let eventResult = state.start(ready, at: minute(6), eventId: "start")

    let event = try #require(eventResult)
    #expect(event.kind == .startWorkout && event.routineId == "routine-1" && event.layout == ready.layout)
    #expect(state.session?.workoutId == "w-ready")
    #expect(state.usedReadyKeys == ["plan-1:3:1"])
    #expect(state.start(ready, at: minute(7)) == nil)

    _ = state.logSet(weight: 100, reps: 5, at: minute(8))
    _ = state.finish(at: minute(30))
    #expect(state.start(ready, at: minute(31)) == nil)
    // The phone has not caught up: the same key, even with new IDs, does not start again.
    state.apply(try context(sentAt: minute(32), ready: readyObject(workoutId: "w-new")))
    #expect(state.start(state.home!.ready!, at: minute(33)) == nil)
    let card = state.todayCard(now: minute(33), timeZone: london)
    #expect(card.kind == .started)
    #expect(card.heading == "Done today")
}

@Test func aDiscardedStartCanBeStartedAgainOnceThePhoneOffersItAfresh() throws {
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let ready = try #require(state.home?.ready)
    _ = state.start(ready, at: minute(6), eventId: "start")
    let discardResult = state.discard(at: minute(7), eventId: "discard")
    let discard = try #require(discardResult)
    #expect(discard.kind == .discard)
    #expect(state.session == nil)
    #expect(state.summary == nil)
    #expect(state.unconfirmed.map(\.id) == ["start", "discard"])

    // The stale offer, with the discarded workout's IDs, stays refused.
    #expect(state.start(ready, at: minute(8)) == nil)
    #expect(state.todayCard(now: minute(8), timeZone: london).heading == "Discarded")
    // The phone's fresh offer of the same slot starts.
    state.apply(try context(sentAt: minute(9), ready: readyObject(workoutId: "w-again")))
    #expect(state.start(state.home!.ready!, at: minute(10)) != nil)
    #expect(state.session?.workoutId == "w-again")
}

@Test func aWristStartThePhoneDiscardedCanBeStartedAgainFromTheWrist() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), ready: readyObject()))
    let stale = try #require(state.home?.ready)
    _ = state.start(stale, at: minute(6), eventId: "start")
    #expect(state.session?.workoutId == "w-ready")

    // Discard on the phone: the session ends here, and the phone offers the
    // same slot again with new IDs.
    let change = state.apply(try context(
        sentAt: minute(8), ready: readyObject(workoutId: "w-again"), closed: [closed("w-ready", "discarded", at: minute(7))]
    ))
    #expect(change.ended?.how == .discarded)
    #expect(state.session == nil)
    #expect(state.usedReadyKeys.isEmpty)
    let card = state.todayCard(now: minute(9), timeZone: london)
    #expect(card.canStart)
    #expect(card.heading != "Done today")
    #expect(state.start(state.home!.ready!, at: minute(9)) != nil)
    #expect(state.session?.workoutId == "w-again")
}

@Test func aWristStartThePhoneDeletedFromHistoryCanBeStartedAgain() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), ready: readyObject()))
    _ = state.start(state.home!.ready!, at: minute(6), eventId: "start")
    _ = state.logSet(weight: 100, reps: 5, at: minute(7))
    _ = state.finish(at: minute(30), eventId: "fin")
    #expect(state.todayCard(now: minute(31), timeZone: london).kind == .started)

    // The phone has applied the start and the finish (it lists the workout),
    // and still offers that slot: the workout was deleted from history.
    state.apply(try context(
        sentAt: minute(40), ready: readyObject(workoutId: "w-again"), closed: [closed("w-ready", "finished", at: minute(30))]
    ))
    #expect(state.todayCard(now: minute(41), timeZone: london).canStart)
    #expect(state.start(state.home!.ready!, at: minute(41)) != nil)
}

@Test func aWristStartIsNotOfferedAgainBeforeThePhoneHasIt() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), ready: readyObject()))
    _ = state.start(state.home!.ready!, at: minute(6), eventId: "start")
    _ = state.finish(at: minute(30), eventId: "fin")
    // A context from before the drain, with another workout closed: the key stays used.
    state.apply(try context(
        sentAt: minute(31), ready: readyObject(workoutId: "w-new"), closed: [closed("w-other", "discarded", at: minute(2))]
    ))
    #expect(!state.todayCard(now: minute(32), timeZone: london).canStart)
    #expect(state.start(state.home!.ready!, at: minute(32)) == nil)
}

@Test func nothingStartsWhileASessionRuns() throws {
    var state = WatchAppState()
    state.apply(try context(live: live("w-1"), ready: readyObject()))
    #expect(state.start(try #require(state.home?.ready), at: minute(6)) == nil)
    #expect(state.session?.workoutId == "w-1")
}

@Test func theWatchStartIsKeptWhileThePhoneStillSendsTheOffer() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), ready: readyObject()))
    _ = state.start(state.home!.ready!, at: minute(6), eventId: "start")
    // A context built before the phone drained the start: no live, the same offer.
    let change = state.apply(try context(sentAt: minute(7), ready: readyObject()))
    #expect(change.ended == nil && change.adopted == nil)
    #expect(state.session?.workoutId == "w-ready")
    // Then the phone's own list for it.
    let caught = state.apply(try context(sentAt: minute(8), live: live("w-ready", sentAt: minute(8))))
    #expect(caught.updated)
    #expect(state.session?.outbox.first?.kind == .startWorkout)
}

// MARK: - Who logs

@Test func aPhoneClaimHandsLoggingToThePhoneUntilTheWatchTakesItBack() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    #expect(state.rest != nil)

    let claimed = state.apply(try context(sentAt: minute(7), live: live("w-1", sentAt: minute(7)), claim: claim("w-1", at: minute(7))))
    #expect(claimed.claimed)
    #expect(state.owner == .phone)
    #expect(state.seenPhoneClaim == iso(minute(7)))
    #expect(state.rest == nil)
    #expect(state.setInHand == nil)
    #expect(state.logSet(weight: 100, reps: 5, at: minute(8)) == nil)
    #expect(state.report(at: minute(8), heartRate: nil, activeKcal: nil, health: .recording).owner == .phone)

    // The same claim again changes nothing.
    let again = state.apply(try context(sentAt: minute(8), live: live("w-1", sentAt: minute(8)), claim: claim("w-1", at: minute(7))))
    #expect(!again.claimed)

    let flag1 = state.reclaim()

    #expect(flag1)
    #expect(state.owner == .watch)
    #expect(state.seenPhoneClaim == iso(minute(7)))
    let report = state.report(at: minute(9), heartRate: nil, activeKcal: nil, health: .recording)
    #expect(report.owner == .watch && report.seenPhoneClaim == iso(minute(7)))
    #expect(state.setInHand != nil)

    // The phone still holds that claim: it does not take logging away again.
    state.apply(try context(sentAt: minute(10), live: live("w-1", sentAt: minute(10)), claim: claim("w-1", at: minute(7))))
    #expect(state.owner == .watch)
    // A newer one does.
    state.apply(try context(sentAt: minute(11), live: live("w-1", sentAt: minute(11)), claim: claim("w-1", at: minute(11))))
    #expect(state.owner == .phone)
    #expect(state.seenPhoneClaim == iso(minute(11)))
}

@Test func aClaimForAnotherWorkoutIsIgnored() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1"), claim: claim("w-0", at: minute(4))))
    #expect(state.owner == .watch)
    let flag2 = state.reclaim()
    #expect(!flag2)
}

@Test func anAdoptedWorkoutThePhoneAlreadyClaimedStaysOnThePhone() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1"), claim: claim("w-1", at: minute(4))))
    #expect(state.session?.workoutId == "w-1")
    #expect(state.owner == .phone)
}

// MARK: - Logging and the rest

@Test func loggingASetStartsItsRestAndPicksItsCue() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    let firstResult = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")
    let first = try #require(firstResult)
    #expect(first.cue == .restBegins)
    #expect(!first.lastOfExercise)
    let rest = try #require(state.rest)
    #expect(rest.id == "s1")
    #expect(rest.seconds == 150)
    #expect(rest.endsAt == minute(6).addingTimeInterval(150))
    #expect(rest.upNext.detail == "Set 2 of 3 · 100 × 5")

    let recordResult = state.logSet(weight: 102.5, reps: 5, at: minute(9), eventId: "s2")

    let record = try #require(recordResult)
    #expect(record.cue == .record)
    #expect(state.lastRecord?.kind == .weight)

    let lastResult = state.logSet(weight: 100, reps: 5, at: minute(12), eventId: "s3")

    let last = try #require(lastResult)
    #expect(last.lastOfExercise)
    #expect(last.cue == .lastSetOfExercise)
    #expect(state.lastRecord == nil)
}

@Test func aSupersetsFirstHalfFollowsStraightOn() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1", name: "a superset and a pyramid")))
    for m in 6...8 { _ = state.logSet(weight: 100, reps: 5, at: minute(Double(m))) }
    let a1Result = state.logSet(weight: 40, reps: 12, at: minute(10))
    let a1 = try #require(a1Result)
    #expect(a1.cue == .partnerNext)
    #expect(state.rest == nil)
}

@Test func skipAdjustAndRunOut() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")
    let longerResult = state.adjustRest(by: 30, now: minute(6.5))
    let longer = try #require(longerResult)
    #expect(longer.endsAt == minute(6).addingTimeInterval(180))
    #expect(longer.seconds == 180)
    let shorterResult = state.adjustRest(by: -600, now: minute(7))
    let shorter = try #require(shorterResult)
    #expect(shorter.endsAt == minute(7))

    let flag3 = state.restRanOut(id: "other")

    #expect(!flag3)
    let flag4 = state.restRanOut(id: "s1")
    #expect(flag4)
    #expect(state.rest == nil)
    #expect(state.skipRest(at: minute(8)) == nil)

    _ = state.logSet(weight: 100, reps: 5, at: minute(9), eventId: "s2")
    let skipResult = state.skipRest(at: minute(10), eventId: "skip")
    let skip = try #require(skipResult)
    #expect(skip.kind == .skipRest)
    #expect(state.rest == nil)
}

@Test func aRestThatEndedWhileTheAppWasClosedEndsQuietly() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    let early = state.expireRest(now: minute(7))
    #expect(!early)
    #expect(state.rest != nil)
    let late = state.expireRest(now: minute(9))
    #expect(late)
    #expect(state.rest == nil)
}

@Test func loggingDuringARestReplacesIt() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")
    _ = state.logSet(weight: 100, reps: 5, at: minute(7), eventId: "s2")
    #expect(state.rest?.id == "s2")
}

// MARK: - Finishing on the wrist

@Test func finishOnTheWristLeavesASummaryAndKeepsResending() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 102.5, reps: 5, at: minute(6), eventId: "s1")
    let finishResult = state.finish(at: minute(40), eventId: "fin")
    let finish = try #require(finishResult)
    #expect(finish.sets?.map(\.id) == ["s1"])
    #expect(state.session == nil)
    #expect(state.summary?.how == .finishedHere)
    #expect(state.summary?.records == 1)
    #expect(state.summary?.setsDone == 1)
    #expect(state.unconfirmed.map(\.id) == ["s1", "fin"])
    #expect(state.discard(at: minute(41)) == nil)

    state.acknowledge(["s1", "fin"])
    #expect(state.unconfirmed.isEmpty)
    state.updateSummary { $0.health = .saved }
    #expect(state.summary?.health == .saved)
    state.closeSummary()
    #expect(state.summary == nil)
}

@Test func eventsTheyWouldDropStopBeingResentAfterSevenDays() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6), eventId: "s1")
    _ = state.finish(at: minute(7), eventId: "fin")
    state.prune(now: minute(8))
    #expect(state.unconfirmed.count == 2)
    state.prune(now: minute(8).addingTimeInterval(8 * 24 * 3600))
    #expect(state.unconfirmed.isEmpty)
}

// MARK: - State reports

@Test func reportsCountUpAndSayWhatRuns() throws {
    var state = WatchAppState()
    let none = state.report(at: minute(1), heartRate: 100, activeKcal: 10, health: .off)
    #expect(none.seq == 1 && none.session == .none && none.workoutId == nil && none.heartRate == nil)

    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    let running = state.report(at: minute(7), heartRate: 128, activeKcal: 42.5, health: .recording)
    #expect(running.seq == 2)
    #expect(running.v == 1)
    #expect(running.session == .running)
    #expect(running.workoutId == "w-1")
    #expect(running.setId == "a-s1")
    #expect(running.rest?.endsAt == iso(minute(6).addingTimeInterval(150)))
    #expect(running.rest?.upNext.name == "Lift a")
    #expect(running.heartRate == 128 && running.activeKcal == 42.5)
    #expect(running.health == .recording)
    #expect(running.at == iso(minute(7)))
}

@Test func theReportKeyMovesWithWhatThePhoneNeedsToKnow() throws {
    var state = WatchAppState()
    let idle = state.reportKey
    state.apply(try context(sentAt: minute(5), live: live("w-1")))
    let started = state.reportKey
    #expect(started != idle)
    _ = state.logSet(weight: 100, reps: 5, at: minute(6))
    let resting = state.reportKey
    #expect(resting != started)
    _ = state.report(at: minute(7), heartRate: nil, activeKcal: nil, health: .off)
    #expect(state.reportKey == resting)
}

@Test func theReportIsWrittenWithEveryNullThePhoneExpects() throws {
    var state = WatchAppState()
    let report = state.report(at: minute(1), heartRate: nil, activeKcal: nil, health: .unavailable)
    let json = try report.json()
    let object = try #require(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    for key in ["workoutId", "seenPhoneClaim", "setId", "rest", "heartRate", "activeKcal"] {
        #expect(object[key] is NSNull, "\(key)")
    }
    #expect(object["session"] as? String == "none")
    #expect(object["owner"] as? String == "watch")
    #expect(object["health"] as? String == "unavailable")
    #expect(object["seq"] as? Int == 1)
    let back = try JSONDecoder().decode(WatchStateReport.self, from: Data(json.utf8))
    #expect(back == report)
}

// MARK: - Saved and restored

@Test func theWholeStateSurvivesARelaunchMidRest() throws {
    var state = WatchAppState()
    state.apply(try context(sentAt: minute(5), live: live("w-1"), ready: readyObject()))
    _ = state.logSet(weight: 102.5, reps: 5, at: minute(6))
    _ = state.report(at: minute(6), heartRate: nil, activeKcal: nil, health: .off)
    let saved = try JSONEncoder().encode(state)
    let restored = try JSONDecoder().decode(WatchAppState.self, from: saved)
    #expect(restored == state)
    #expect(restored.rest?.endsAt == minute(6).addingTimeInterval(150))
    #expect(restored.lastRecord?.kind == .weight)
    #expect(restored.seq == 1)
}

@Test func anEmptyObjectIsAFreshState() throws {
    let state = try JSONDecoder().decode(WatchAppState.self, from: Data("{}".utf8))
    #expect(state == WatchAppState())
}
