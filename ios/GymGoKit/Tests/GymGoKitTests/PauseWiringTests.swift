import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// Pause and resume, wired: the WorkoutController's bookkeeping on the Mac,
// where HealthKit is compiled out. The pure rules are in PauseTests.

@MainActor
@Test func aPauseAskedForSilencesItsEchoAndAResumeDoesToo() {
    let workout = WorkoutController()
    // Nothing asked: both buttons together toggle.
    #expect(workout.answerRequest(.running, now: Date()) == .pause)

    workout.pause()
    #expect(workout.answerRequest(.paused, now: Date()) == nil)
    #expect(workout.answerRequest(.paused, now: Date().addingTimeInterval(PauseRequest.echoWindow)) == .resume)

    workout.resume()
    #expect(workout.answerRequest(.running, now: Date()) == nil)
}

@MainActor
@Test func aPauseIsSaidOnceWithWhenItBegan() {
    let workout = WorkoutController()
    var told = 0
    workout.onPauseChanged = { told += 1 }

    let began = Date(timeIntervalSince1970: 1_792_000_000)
    workout.pauseChanged(paused: true, at: began)
    #expect(workout.isPaused)
    #expect(workout.pausedAt == began)
    #expect(told == 1)

    // HealthKit saying it again is no change.
    workout.pauseChanged(paused: true, at: began.addingTimeInterval(5))
    #expect(workout.pausedAt == began)
    #expect(told == 1)

    workout.pauseChanged(paused: false, at: began.addingTimeInterval(60))
    #expect(!workout.isPaused)
    #expect(workout.pausedAt == nil)
    #expect(told == 2)
}

@MainActor
@Test func whileHealthPromptsAreHeldNothingAsks() async {
    let workout = WorkoutController()
    #expect(!workout.promptsHeld)
    workout.holdHealthPrompts(for: 30)
    #expect(workout.promptsHeld)
    #expect(await workout.needsAuthorization() == false)
    workout.holdHealthPrompts(for: -1)
    #expect(!workout.promptsHeld)
}
