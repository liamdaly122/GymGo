import Foundation
import GymGoKit
import RelevanceKit
import SwiftUI
import WidgetKit

// The watch face's complications and the Smart Stack's card.
//
// The extension only reads: the watch app writes `glance.json` to the App
// Group after every save that changes it, and `WatchGlance.moments(from:)`
// (GymGoKit) works out what each moment shows, with the Today page's own
// rule. This file draws it, and holds no rule of its own. It links GymGoKit
// and nothing else, so system fonts: the app's bundled faces live in
// GymGoWatchUI, and a face draws inline and corner labels in its own font
// anyway.

@main
struct GymGoComplications: WidgetBundle {
    var body: some Widget {
        NextSessionWidget()
    }
}

// MARK: - The widget

struct NextSessionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: glanceWidgetKind, provider: GlanceProvider()) { entry in
            GlanceView(moment: entry.moment)
                .containerBackground(for: .widget) { Palette.ground }
        }
        .configurationDisplayName("GymGo")
        .description("Your next session, this week, and the rest on your wrist.")
        // Rectangular and circular on faces and in the Smart Stack; corner
        // and inline on faces only.
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryCorner, .accessoryInline])
    }
}

// MARK: - The timeline

struct GlanceEntry: TimelineEntry {
    let date: Date
    let moment: GlanceMoment

    init(_ moment: GlanceMoment) {
        date = moment.date
        self.moment = moment
    }
}

struct GlanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry {
        GlanceEntry(Sample.ready().moment(at: Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (GlanceEntry) -> Void) {
        let glance = context.isPreview ? Sample.ready() : Self.current()
        completion(GlanceEntry(glance.moment(at: Date())))
    }

    /// Now, the end of a rest under way, and each midnight for a week. The
    /// app asks for a reload whenever what it wrote changes; past the last
    /// midnight WidgetKit asks again, and the same file gives the next week.
    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<GlanceEntry>) -> Void) {
        let moments = Self.current().moments(from: Date())
        completion(Timeline(entries: moments.map(GlanceEntry.init), policy: .atEnd))
    }

    /// Smart Stack: each training day still to come, in its waking hours.
    /// `.scheduled`, because the day has a session to start. On the watch
    /// these contexts are what the stack reads; per-entry scores are not.
    func relevance() async -> WidgetRelevance<Void> {
        let windows = Self.current().relevantWindows(from: Date())
        return WidgetRelevance(windows.map { WidgetRelevanceAttribute(context: .date(interval: $0, kind: .scheduled)) })
    }

    /// What the app last wrote; with no App Group, or nothing written yet,
    /// the card that says to open GymGo on the iPhone.
    private static func current() -> WatchGlance {
        WatchGlance.read(from: WatchGlance.defaultURL()) ?? .empty
    }
}

// MARK: - The look

/// Theme.swift's colours (GymGoWatchUI, which the extension does not link).
/// Chalk is the action, blue is where you are: on a face, blue marks today
/// and what is done.
enum Palette {
    static let ground = Color(red: 12 / 255, green: 12 / 255, blue: 11 / 255)
    static let chalk = Color(red: 243 / 255, green: 241 / 255, blue: 234 / 255)
    static let hot = Color(red: 91 / 255, green: 132 / 255, blue: 255 / 255)
}

struct GlanceView: View {
    let moment: GlanceMoment
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular: CircularGlance(moment: moment)
        case .accessoryCorner: CornerGlance(moment: moment)
        case .accessoryInline: InlineGlance(moment: moment)
        default: RectangularGlance(moment: moment)
        }
    }
}

/// GymGo blue in full colour; the face's own tint where the face tints.
private struct Highlight: ViewModifier {
    @Environment(\.widgetRenderingMode) private var mode

    func body(content: Content) -> some View {
        if mode == .fullColor {
            content.foregroundStyle(Palette.hot)
        } else {
            content.widgetAccentable()
        }
    }
}

/// A gauge's or a progress ring's fill in GymGo blue, its digits left chalk;
/// the face's own tint where the face tints.
private struct RingTint: ViewModifier {
    @Environment(\.widgetRenderingMode) private var mode

    func body(content: Content) -> some View {
        if mode == .fullColor {
            content.tint(Palette.hot)
        } else {
            content.widgetAccentable()
        }
    }
}

extension View {
    fileprivate func highlighted() -> some View { modifier(Highlight()) }
    fileprivate func ringTinted() -> some View { modifier(RingTint()) }
}

// MARK: Rectangular: the Today page in three lines, or the set and the rest

struct RectangularGlance: View {
    let moment: GlanceMoment

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            switch moment.phase {
            case .resting(_, let rest):
                HStack(spacing: 4) {
                    Text("Rest").textCase(.uppercase).highlighted()
                    Text(timerInterval: rest.startedAt...rest.endsAt, countsDown: true)
                        .monospacedDigit()
                }
                .font(.system(.headline, design: .rounded))
                Text(rest.upNext).font(.headline).lineLimit(1)
                Text(rest.upNextDetail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            case .session(let session):
                HStack(spacing: 4) {
                    Text(session.loggingOnPhone ? "On iPhone" : "Session").textCase(.uppercase).highlighted()
                    Text(session.startedAt, style: .timer).monospacedDigit()
                }
                .font(.caption2.weight(.semibold))
                Text(session.station ?? session.title).font(.headline).lineLimit(1)
                Text(session.setLabel.map { "\($0) · \(session.setsDone) of \(session.setsTotal) sets" }
                     ?? "\(session.setsDone) of \(session.setsTotal) sets")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            case .today:
                Text(moment.card.heading)
                    .font(.caption2.weight(.semibold)).textCase(.uppercase).highlighted().lineLimit(1)
                if let title = moment.card.title {
                    Text(title).font(.headline).lineLimit(1)
                    if !moment.week.isEmpty {
                        WeekStrip(marks: moment.week)
                    } else if let detail = moment.card.detail {
                        Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                } else {
                    // Nothing to name: the card's line gets the room, not the week.
                    Text(moment.card.kind == .noPhone ? moment.shortLine : moment.card.message ?? "")
                        .font(.caption)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Done a filled dot, planned an outline, a rest day a speck; today ringed.
struct WeekStrip: View {
    let marks: [WeekMark]

    var body: some View {
        HStack(spacing: 3) {
            ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in
                ZStack {
                    switch mark.state {
                    case .done: Circle().highlighted()
                    case .planned, .today: Circle().strokeBorder(lineWidth: 1.5)
                    case .rest: Circle().frame(width: 3, height: 3).opacity(0.6)
                    }
                    if mark.isToday {
                        Circle().strokeBorder(lineWidth: 1.5).padding(-2.5).highlighted()
                    }
                }
                .frame(width: 9, height: 9)
                .frame(maxWidth: .infinity)
                .accessibilityLabel(mark.spoken)
            }
        }
        .padding(.top, 2)
    }
}

// MARK: Circular: the week's ring, the sets, or the rest's ring

struct CircularGlance: View {
    let moment: GlanceMoment

    var body: some View {
        switch moment.phase {
        case .resting(_, let rest):
            ProgressView(timerInterval: rest.startedAt...rest.endsAt, countsDown: true) {
                Text("Rest")
            } currentValueLabel: {
                Text(timerInterval: rest.startedAt...rest.endsAt, countsDown: true)
                    .monospacedDigit()
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
            }
            .progressViewStyle(.circular)
            .ringTinted()
        case .session(let session):
            Gauge(value: Double(session.setsDone), in: 0...Double(max(1, session.setsTotal))) {
                Text("Sets")
            } currentValueLabel: {
                Text("\(session.setsDone)")
            }
            .gaugeStyle(.accessoryCircularCapacity)
            .ringTinted()
        case .today:
            ZStack {
                AccessoryWidgetBackground()
                WeekRing(planned: moment.planned, done: moment.done).highlighted()
                centre
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(spoken))
        }
    }

    @ViewBuilder private var centre: some View {
        switch moment.card.kind {
        case .ready:
            if let day = moment.dueLater {
                Text(day)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .textCase(.uppercase)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .padding(.horizontal, 6)
            } else {
                Text("GO").font(.system(size: 20, weight: .heavy, design: .rounded))
            }
        case .started, .waitingForPhone:
            // Done on the wrist today; on a later day, nothing to start yet.
            Image(systemName: moment.doneHereToday ? "checkmark" : "dumbbell.fill")
                .font(.system(size: moment.doneHereToday ? 18 : 15, weight: .bold))
        case .blockDone:
            Image(systemName: "flag.checkered").font(.system(size: 16, weight: .semibold))
        case .runningOnPhone:
            Image(systemName: "iphone").font(.system(size: 16, weight: .semibold))
        default:
            Image(systemName: "dumbbell.fill").font(.system(size: 15, weight: .semibold))
        }
    }

    private var spoken: String {
        var parts = [moment.card.heading]
        if let title = moment.card.title { parts.append(title) }
        if moment.planned > 0 { parts.append("\(moment.done) of \(moment.planned) this week") }
        return parts.joined(separator: ", ")
    }
}

/// One arc per training day this week, done ones solid.
struct WeekRing: View {
    let planned: Int
    let done: Int

    var body: some View {
        let count = max(planned, 1)
        let gap = planned > 1 ? 0.03 : 0
        ZStack {
            ForEach(0..<count, id: \.self) { index in
                let from = Double(index) / Double(count) + gap / 2
                let to = Double(index + 1) / Double(count) - gap / 2
                Circle()
                    .trim(from: from, to: to)
                    .stroke(style: StrokeStyle(lineWidth: 3, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
                    .opacity(index < done ? 1 : 0.3)
            }
        }
        .padding(2)
    }
}

// MARK: Corner and inline

struct CornerGlance: View {
    let moment: GlanceMoment

    var body: some View {
        switch moment.phase {
        case .resting(_, let rest):
            Text(timerInterval: rest.startedAt...rest.endsAt, countsDown: true)
                .monospacedDigit()
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .widgetLabel {
                    ProgressView(timerInterval: rest.startedAt...rest.endsAt, countsDown: true)
                        .ringTinted()
                }
        case .session(let session):
            Text("\(session.setsDone)")
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .widgetLabel {
                    Gauge(value: Double(session.setsDone), in: 0...Double(max(1, session.setsTotal))) {
                        Text("Sets")
                    }
                    .ringTinted()
                }
        case .today:
            Image(systemName: moment.doneHereToday ? "checkmark" : "dumbbell.fill")
                .font(.system(size: 18, weight: .semibold))
                .highlighted()
                .widgetLabel { Text(moment.shortLine).textCase(.uppercase) }
        }
    }
}

struct InlineGlance: View {
    let moment: GlanceMoment

    var body: some View {
        switch moment.phase {
        case .resting(_, let rest):
            Label {
                Text("Rest \(Text(timerInterval: rest.startedAt...rest.endsAt, countsDown: true))")
            } icon: {
                Image(systemName: "timer")
            }
        case .session(let session):
            Label("\(session.setsDone) of \(session.setsTotal) sets", systemImage: "dumbbell.fill")
        case .today:
            Label(moment.shortLine, systemImage: moment.doneHereToday ? "checkmark" : "dumbbell.fill")
        }
    }
}

// MARK: - Placeholder and the gallery

enum Sample {
    /// Push A due today, week 3 of 5: what the face editor's gallery shows.
    static func ready(now: Date = Date()) -> WatchGlance {
        WatchGlance(
            today: TodayInputs(
                phoneToday: localDay(now),
                state: .ready,
                doneToday: [],
                ready: .init(
                    name: "Push A", date: localDay(now), weekLabel: "Week 3 of 5", minutes: 55, exercises: 6,
                    movedFrom: nil, used: false, discarded: false
                ),
                week: [],
                liveOnPhone: false, liveDiscardedHere: false, liveEnded: false
            ),
            session: nil,
            doneHereDay: nil
        )
    }
}
