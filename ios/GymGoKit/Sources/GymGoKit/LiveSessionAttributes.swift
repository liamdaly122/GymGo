// The Live Activity's type, shared by the App target (which starts, updates
// and ends it) and the "GymGo Live Activity" extension (which draws it). One
// definition in GymGoKit, so both sides agree on the name and the Codable
// shape by construction. ActivityKit exists only on iOS (it is marked
// unavailable on watchOS and macOS), so the watch app, the complications and
// `swift test` on the Mac never see this.

#if canImport(ActivityKit) && os(iOS)
import ActivityKit
import Foundation

public struct GymGoSessionAttributes: ActivityAttributes {
    public typealias ContentState = LiveSessionContent

    /// The workout the watch is running. One Live Activity per workout.
    public var workoutId: String
    /// The session's name, as Today shows it ("Push A").
    public var title: String
    /// When the session began, for the elapsed clock.
    public var startedAt: Date

    public init(workoutId: String, title: String, startedAt: Date) {
        self.workoutId = workoutId
        self.title = title
        self.startedAt = startedAt
    }
}
#endif
