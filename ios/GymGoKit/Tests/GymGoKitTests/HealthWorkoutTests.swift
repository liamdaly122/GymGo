import Foundation
import Testing
@testable import GymGoKit

// The decisions behind the watch's Health workout: when a failed start is
// tried again.

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
