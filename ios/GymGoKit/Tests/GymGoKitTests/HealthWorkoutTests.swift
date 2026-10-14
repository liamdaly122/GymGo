import Foundation
import Testing
@testable import GymGoKit

// The decisions behind the watch's Health workout: when a failed start is
// tried again, and the rest-over notification for when nothing keeps the
// app running.

// MARK: - Trying again after a Health start failed (C8)

@Test func aStartThatFailedBeforeHealthWasAskedIsTriedAgain() {
    var retry = HealthRetry()
    // In the background, before the first foreground asked: not determined.
    retry.failed("w-1", authorized: false, notDetermined: true)
    #expect(retry.mayStart("w-1"))
    retry.failed("w-1", authorized: true, notDetermined: true)
    #expect(retry.mayStart("w-1"))
    // Refused, or unavailable: read afresh on each wake, never blocked.
    retry.failed("w-1", authorized: false)
    #expect(retry.mayStart("w-1"))
}

@Test func aStartThatFailedWithHealthAllowedWaitsForAGrant() {
    var retry = HealthRetry()
    retry.failed("w-1", authorized: true)
    #expect(!retry.mayStart("w-1"))
    #expect(retry.mayStart("w-2"))
    retry.granted()
    #expect(retry.mayStart("w-1"))
    retry.failed(nil, authorized: true)
    #expect(retry.blocked == nil)
}

// MARK: - The rest-over notification (C9)

private func rest(_ id: String = "r-1", endsAt: Date = minute(10)) -> RestState {
    RestState(id: id, startedAt: endsAt.addingTimeInterval(-150), endsAt: endsAt, seconds: 150, upNext: UpNext(name: "Lift a", detail: "Set 2 of 3"))
}

@Test func theRestOverNotificationIsWantedOnlyWhenNothingKeepsTheAppRunning() {
    let wanted = RestAlert.wanted(for: rest(), healthRecording: false, vibrate: true, now: minute(9))
    #expect(wanted == RestAlert(id: "r-1", fireAt: minute(10), upNext: UpNext(name: "Lift a", detail: "Set 2 of 3")))
    // Health records: the in-process cues play wrist-down.
    #expect(RestAlert.wanted(for: rest(), healthRecording: true, vibrate: true, now: minute(9)) == nil)
    #expect(RestAlert.wanted(for: nil, healthRecording: false, vibrate: true, now: minute(9)) == nil)
    #expect(RestAlert.wanted(for: rest(), healthRecording: false, vibrate: true, now: minute(10)) == nil)
    #expect(RestAlert.wanted(for: rest(), healthRecording: false, vibrate: false, now: minute(9)) == nil)
}

@Test func theScheduledNotificationFollowsTheRest() {
    let first = RestAlert(id: "r-1", fireAt: minute(10), upNext: UpNext(name: "a", detail: "b"))
    // Scheduled once.
    #expect(RestAlert.reconcile(scheduled: nil, wanted: first) == (nil, first))
    #expect(RestAlert.reconcile(scheduled: first, wanted: first) == (nil, nil))
    // +30 s: the same rest, later.
    var longer = first
    longer.fireAt = minute(10.5)
    #expect(RestAlert.reconcile(scheduled: first, wanted: longer) == ("r-1", longer))
    // A new set's rest replaces it.
    let next = RestAlert(id: "r-2", fireAt: minute(13), upNext: UpNext(name: "a", detail: "b"))
    #expect(RestAlert.reconcile(scheduled: first, wanted: next) == ("r-1", next))
    // Skipped, run out, ended, or Health took over.
    #expect(RestAlert.reconcile(scheduled: first, wanted: nil) == ("r-1", nil))
}

// MARK: - The rest-over repeat (C10)

@Test func theRestOverRepeatPlaysOnlyForTheSessionStillRunning() {
    #expect(restOverPlaysAgain(noticed: false, restRunning: false, restSession: "w-1", runningSession: "w-1"))
    #expect(!restOverPlaysAgain(noticed: true, restRunning: false, restSession: "w-1", runningSession: "w-1"))
    #expect(!restOverPlaysAgain(noticed: false, restRunning: true, restSession: "w-1", runningSession: "w-1"))
    // Finished or discarded on the phone, or replaced by another workout.
    #expect(!restOverPlaysAgain(noticed: false, restRunning: false, restSession: "w-1", runningSession: nil))
    #expect(!restOverPlaysAgain(noticed: false, restRunning: false, restSession: "w-1", runningSession: "w-2"))
}
