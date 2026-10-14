// The Live Activity for a session the watch runs: the Lock Screen, the
// Dynamic Island, and the small view the paired watch's Smart Stack gets.
// What it shows and when it starts and ends is GymGoKit's `LiveSession`; the
// phone's LiveSessionActivities.swift does the starting and ending.
//
// Nothing here runs a timer. Every countdown is `Text(timerInterval:)` or
// `ProgressView(timerInterval:)`, which the system animates on its own, so the
// phone sends one update when a rest starts and one when it ends, not one a
// second.
//
// The look is the app's (CLAUDE.md, "Design: Bold"): near-black ground, chalk
// type, one blue highlight. Blue marks where you are (the rest bar, the
// keyline, a pause); chalk is the type. Nothing here is a button, so nothing
// is chalk as an action. It never alerts: the rest's one cue is the watch's.

import ActivityKit
import GymGoKit
import SwiftUI
import WidgetKit

@main
struct GymGoLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        GymGoSessionLiveActivity()
    }
}

/// The app's colours, as `Theme` in GymGoWatchUI has them. Kept here rather
/// than linking GymGoWatchUI (WatchKit, HealthKit, fonts) into an extension.
private enum Look {
    static let ground = Color(red: 12 / 255, green: 12 / 255, blue: 11 / 255)
    static let chalk = Color(red: 243 / 255, green: 241 / 255, blue: 234 / 255)
    static let hot = Color(red: 91 / 255, green: 132 / 255, blue: 255 / 255)
    static let muted = Color(red: 243 / 255, green: 241 / 255, blue: 234 / 255).opacity(0.55)

    /// Poster numbers and names. SF's compressed width stands in for Big
    /// Shoulders Display; the bundled face would need its .ttf files in this
    /// extension and UIAppFonts in its Info.plist, unproven in a Live Activity.
    static func display(_ size: CGFloat) -> Font {
        .system(size: size, weight: .heavy).width(.compressed)
    }

    static func text(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight)
    }
}

struct GymGoSessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GymGoSessionAttributes.self) { context in
            SessionActivityView(context: context)
                .activityBackgroundTint(Look.ground)
                .activitySystemActionForegroundColor(Look.chalk)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    ExpandedLeading(state: state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    HeartRate(bpm: context.isStale ? nil : state.heartRate, size: 17)
                        .frame(maxHeight: .infinity, alignment: .center)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(Look.display(15))
                        .textCase(.uppercase)
                        .foregroundStyle(Look.muted)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ExpandedBottom(state: state, isStale: context.isStale)
                }
            } compactLeading: {
                CompactLeading(state: state, isStale: context.isStale)
            } compactTrailing: {
                CompactTrailing(state: state, isStale: context.isStale)
            } minimal: {
                Minimal(state: state, isStale: context.isStale)
            }
            .keylineTint(Look.hot)
        }
        // The paired watch shows this Live Activity in its Smart Stack whatever
        // we do (watchOS 11 and later). Declaring .small lets it be a quiet
        // rest clock there rather than the compact views squeezed together, so
        // it adds to GymGo's own watch app instead of repeating it.
        .supplementalActivityFamilies([.small])
    }
}

// MARK: - Lock Screen (and the watch's Smart Stack, as .small)

private struct SessionActivityView: View {
    let context: ActivityViewContext<GymGoSessionAttributes>
    @Environment(\.activityFamily) private var family

    var body: some View {
        switch family {
        case .small:
            WatchSmall(state: context.state, title: context.attributes.title, isStale: context.isStale)
        default:
            LockScreen(context: context)
        }
    }
}

private struct LockScreen: View {
    let context: ActivityViewContext<GymGoSessionAttributes>

    var body: some View {
        let state = context.state
        // The system cuts a Lock Screen Live Activity off at 160 points, so
        // the tallest state (a rest) is sized to fit inside it.
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(context.attributes.title)
                    .font(Look.display(17))
                    .textCase(.uppercase)
                    .foregroundStyle(Look.chalk)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if state.pausedAt != nil {
                    Text("Paused")
                        .font(Look.text(12, weight: .semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(Look.hot)
                }
                Elapsed(startedAt: context.attributes.startedAt, pausedAt: state.pausedAt)
                    .font(Look.text(14))
                    .foregroundStyle(Look.muted)
                    .frame(maxWidth: 72, alignment: .trailing)
                HeartRate(bpm: context.isStale ? nil : state.heartRate, size: 14)
            }

            if context.isStale && state.phase != .ended {
                // Nothing heard for a while: a rest on screen would be long
                // over, so only what was in hand stays, and the plain fact.
                VStack(alignment: .leading, spacing: 2) {
                    if let exercise = state.exercise {
                        LiftName(exercise, size: 24)
                    }
                    Text("Out of touch with your watch")
                        .font(Look.text(15, weight: .semibold))
                        .foregroundStyle(Look.muted)
                }
            } else {
                switch state.phase {
                case .resting:
                    RestBlock(state: state)
                case .lifting:
                    VStack(alignment: .leading, spacing: 2) {
                        LiftName(state.exercise ?? "On your watch", size: 30)
                        if let detail = state.detail {
                            Text(detail).font(Look.text(15)).foregroundStyle(Look.muted).lineLimit(1)
                        }
                    }
                case .starting:
                    Text("Starting on your watch")
                        .font(Look.text(16, weight: .semibold))
                        .foregroundStyle(Look.chalk)
                case .onPhone:
                    Text("Logging on your iPhone")
                        .font(Look.text(16, weight: .semibold))
                        .foregroundStyle(Look.chalk)
                case .ended:
                    LiftName("Workout over", size: 30)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
}

/// A lift's name as a poster, shrinking a little before it is cut short.
private struct LiftName: View {
    let name: String
    let size: CGFloat

    init(_ name: String, size: CGFloat) {
        self.name = name
        self.size = size
    }

    var body: some View {
        Text(name)
            .font(Look.display(size))
            .textCase(.uppercase)
            .foregroundStyle(Look.chalk)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

/// Time since the session began, counting up with nothing sent to keep it
/// going, and standing still while the watch is paused.
private struct Elapsed: View {
    let startedAt: Date
    let pausedAt: Date?

    var body: some View {
        // A Live Activity lasts at most twelve hours, so the range never runs out.
        Text(
            timerInterval: startedAt...startedAt.addingTimeInterval(12 * 3600),
            pauseTime: pausedAt.map { max($0, startedAt) },
            countsDown: false
        )
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
    }
}

/// The rest on the Lock Screen: the clock, what is next, and the bar. Only
/// ever shown while the activity is fresh (`LockScreen`).
private struct RestBlock: View {
    let state: LiveSessionContent

    var body: some View {
        if let range = state.restRange(isStale: false) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .lastTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Rest").font(Look.text(12, weight: .semibold)).textCase(.uppercase).foregroundStyle(Look.muted)
                        // Stops at 0:00 and stays there until the watch says the rest is over.
                        Text(timerInterval: range, countsDown: true)
                            .font(Look.display(44))
                            .monospacedDigit()
                            .foregroundStyle(Look.chalk)
                            .frame(minWidth: 96, alignment: .leading)
                    }
                    Spacer(minLength: 8)
                    UpNext(name: state.upNext, detail: state.upNextDetail, alignment: .trailing)
                }
                RestBar(range: range)
            }
        }
    }
}

/// The rest draining, in blue: where you are.
private struct RestBar: View {
    let range: ClosedRange<Date>

    var body: some View {
        ProgressView(timerInterval: range, countsDown: true) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .tint(Look.hot)
    }
}

private struct UpNext: View {
    let name: String?
    let detail: String?
    let alignment: HorizontalAlignment

    var body: some View {
        if let name {
            VStack(alignment: alignment, spacing: 1) {
                Text("Up next").font(Look.text(12, weight: .semibold)).textCase(.uppercase).foregroundStyle(Look.muted)
                LiftName(name, size: 18)
                if let detail {
                    Text(detail).font(Look.text(13)).foregroundStyle(Look.muted).lineLimit(1)
                }
            }
        }
    }
}

/// Up next in the island's narrower bottom: the label and the name on one line.
private struct UpNextLine: View {
    let name: String?
    let detail: String?

    var body: some View {
        if let name {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("Up next").font(Look.text(12, weight: .semibold)).textCase(.uppercase).foregroundStyle(Look.muted)
                    LiftName(name, size: 18)
                }
                if let detail {
                    Text(detail).font(Look.text(13)).foregroundStyle(Look.muted).lineLimit(1)
                }
            }
        }
    }
}

private struct HeartRate: View {
    let bpm: Int?
    let size: CGFloat

    var body: some View {
        if let bpm {
            HStack(spacing: 3) {
                Image(systemName: "heart.fill").font(.system(size: size * 0.8))
                Text("\(bpm)").font(Look.text(size, weight: .semibold)).monospacedDigit()
            }
            .foregroundStyle(Look.chalk)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Heart rate \(bpm)")
        }
    }
}

/// The watch's Smart Stack: the rest clock, or the lift, and nothing else, so
/// it adds to GymGo's own watch app rather than copying it. No rest once the
/// activity is stale: it would be a 0:00 frozen long after.
private struct WatchSmall: View {
    let state: LiveSessionContent
    let title: String
    let isStale: Bool

    var body: some View {
        if let range = state.restRange(isStale: isStale) {
            VStack(alignment: .leading, spacing: 2) {
                Text(timerInterval: range, countsDown: true)
                    .font(Look.display(30))
                    .monospacedDigit()
                    .foregroundStyle(Look.chalk)
                if let next = state.upNext {
                    Text(next).font(Look.text(13)).foregroundStyle(Look.muted).lineLimit(1)
                }
            }
        } else {
            LiftName(state.phase == .lifting ? state.exercise ?? title : title, size: 20)
        }
    }
}

// MARK: - Dynamic Island

private struct ExpandedLeading: View {
    let state: LiveSessionContent
    let isStale: Bool

    var body: some View {
        if let range = state.restRange(isStale: isStale) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Rest").font(Look.text(12, weight: .semibold)).textCase(.uppercase).foregroundStyle(Look.muted)
                Text(timerInterval: range, countsDown: true)
                    .font(Look.display(36))
                    .monospacedDigit()
                    .foregroundStyle(Look.chalk)
                    .frame(minWidth: 72, alignment: .leading)
            }
        } else {
            Image(systemName: "dumbbell.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Look.chalk)
                .frame(maxHeight: .infinity, alignment: .center)
        }
    }
}

private struct ExpandedBottom: View {
    let state: LiveSessionContent
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if isStale && state.phase != .ended {
                if let exercise = state.exercise {
                    LiftName(exercise, size: 20)
                }
                Text("Out of touch with your watch").font(Look.text(14, weight: .semibold)).foregroundStyle(Look.muted)
            } else {
                switch state.phase {
                case .resting:
                    UpNextLine(name: state.upNext, detail: state.upNextDetail)
                    if let range = state.restRange(isStale: isStale) {
                        RestBar(range: range)
                    }
                case .lifting:
                    VStack(alignment: .leading, spacing: 1) {
                        LiftName(state.exercise ?? "On your watch", size: 24)
                        if let detail = state.detail {
                            Text(detail).font(Look.text(14)).foregroundStyle(Look.muted).lineLimit(1)
                        }
                    }
                case .starting:
                    Text("Starting on your watch").font(Look.text(15, weight: .semibold)).foregroundStyle(Look.chalk)
                case .onPhone:
                    Text("Logging on your iPhone").font(Look.text(15, weight: .semibold)).foregroundStyle(Look.chalk)
                case .ended:
                    LiftName("Workout over", size: 24)
                }
                if state.pausedAt != nil {
                    Text("Paused").font(Look.text(12, weight: .semibold)).textCase(.uppercase).foregroundStyle(Look.hot)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The island's small spaces draw a rest only while the activity is fresh,
/// as the Lock Screen does: stale, a ring and a 0:00 would be long over.
private struct CompactLeading: View {
    let state: LiveSessionContent
    let isStale: Bool

    var body: some View {
        if let range = state.restRange(isStale: isStale) {
            RestRing(range: range)
        } else if state.pausedAt != nil {
            Image(systemName: "pause.fill").foregroundStyle(Look.hot)
        } else {
            Image(systemName: "dumbbell.fill").foregroundStyle(Look.chalk)
        }
    }
}

private struct CompactTrailing: View {
    let state: LiveSessionContent
    /// An old heart rate is no heart rate, and an old rest no rest.
    let isStale: Bool

    var body: some View {
        if let range = state.restRange(isStale: isStale) {
            // A timer text takes all the width it is offered; the frame keeps
            // the compact view the width of "0:00".
            Text(timerInterval: range, countsDown: true)
                .font(Look.display(17))
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
                .foregroundStyle(Look.chalk)
                .frame(width: 40, alignment: .trailing)
        } else if !isStale, let bpm = state.heartRate {
            Text("\(bpm)")
                .font(Look.display(17))
                .monospacedDigit()
                .foregroundStyle(Look.chalk)
                .accessibilityLabel("Heart rate \(bpm)")
        }
    }
}

private struct Minimal: View {
    let state: LiveSessionContent
    let isStale: Bool

    var body: some View {
        if let range = state.restRange(isStale: isStale) {
            RestRing(range: range)
        } else {
            Image(systemName: "dumbbell.fill").foregroundStyle(Look.chalk)
        }
    }
}

/// The rest as a ring for the island's small spaces.
private struct RestRing: View {
    let range: ClosedRange<Date>

    var body: some View {
        ProgressView(timerInterval: range, countsDown: true) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.circular)
        .tint(Look.hot)
    }
}
