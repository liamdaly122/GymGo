#if os(watchOS)
import GymGoKit
import SwiftUI

/// No workout running: vertical pages, turned by the Crown. Today first,
/// with START; then the session's exercises; then the week. The phone
/// decides what is next and sends it; the watch only shows it.
struct IdlePages: View {
    let store: WatchSessionStore

    var body: some View {
        NavigationStack {
            TabView {
                TodayPage(store: store)
                    .containerBackground(Theme.ground, for: .tabView)
                ExercisesPage(ready: store.state.home?.ready)
                    .containerBackground(Theme.ground, for: .tabView)
                WeekPage(week: store.state.home?.week ?? [])
                    .containerBackground(Theme.ground, for: .tabView)
            }
            .tabViewStyle(.verticalPage)
        }
    }
}

// MARK: - Today

struct TodayPage: View {
    let store: WatchSessionStore
    @State private var confirmingEarly = false

    var body: some View {
        // Re-read every minute, so the page turns over at midnight.
        TimelineView(.everyMinute) { context in
            let card = store.state.todayCard(now: context.date)
            content(card)
        }
    }

    @ViewBuilder
    private func content(_ card: TodayCard) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if !card.doneToday.isEmpty, card.kind == .ready {
                Text("Done today · \(card.doneToday.joined(separator: ", "))")
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Text(card.heading)
                .font(Theme.text(13, semiBold: true))
                .foregroundStyle(card.kind == .ready && card.startLabel == "Start" ? Theme.hot : Theme.muted)
                .lineLimit(1)
            if let movedFrom = card.movedFrom {
                Text(movedFrom)
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.hot)
                    .lineLimit(1)
            }
            if let title = card.title {
                Text(title)
                    .font(Theme.display(30, extraBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(card.kind == .ready ? Theme.chalk : Theme.muted)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .accessibilityAddTraits(.isHeader)
            }
            if let detail = card.detail {
                Text(detail)
                    .font(Theme.text(13))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            if let message = card.message {
                Text(message)
                    .font(Theme.text(14))
                    .foregroundStyle(Theme.chalk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !card.doneToday.isEmpty, card.kind != .ready {
                Text(card.doneToday.joined(separator: ", "))
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)
            }

            Spacer(minLength: 4)

            // A Health workout already recording is taken over by Start;
            // with nothing to start, it can be ended here.
            if store.workout.isRunning, !card.canStart {
                strayRecording
            } else if card.canStart, let label = card.startLabel, let title = card.title {
                Button {
                    if label == "Start" { store.startToday() } else { confirmingEarly = true }
                } label: {
                    Text(label)
                        .font(Theme.display(22, extraBold: true))
                        .textCase(.uppercase)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .chalkButton()
                .handGestureShortcut(.primaryAction)
                .accessibilityLabel("\(label) \(title)")
                .confirmationDialog("Start \(title) early?", isPresented: $confirmingEarly) {
                    Button("Start early") { store.startToday() }
                    Button("Not yet", role: .cancel) {}
                } message: {
                    Text("It is planned for \(card.heading.replacingOccurrences(of: "Next · ", with: "")).")
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 4)
    }

    /// The phone opened the app for a workout and none followed: Health is
    /// recording with nothing behind it. Say so, and offer to end it.
    private var strayRecording: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Recording a workout in Health")
                .font(Theme.text(12))
                .foregroundStyle(Theme.muted)
            Button {
                store.endStrayRecording()
            } label: {
                Text("End")
                    .font(Theme.display(20))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, minHeight: 40)
            }
            .raisedButton()
            .accessibilityLabel("End the Health workout")
        }
    }
}

// MARK: - The session's exercises

struct ExercisesPage: View {
    let ready: WatchReady?

    var body: some View {
        if let ready {
            List {
                Section {
                    ForEach(Array(ready.exercises.enumerated()), id: \.offset) { index, line in
                        let inSuperset = line.superset != nil
                        let continues = index > 0 && inSuperset && ready.exercises[index - 1].superset == line.superset
                        VStack(alignment: .leading, spacing: 0) {
                            Text(line.name)
                                .font(Theme.display(16))
                                .textCase(.uppercase)
                                .foregroundStyle(Theme.chalk)
                                .lineLimit(2)
                            Text([line.kit, line.work].compactMap { $0 }.joined(separator: " · "))
                                .font(Theme.text(12))
                                .foregroundStyle(Theme.muted)
                                .lineLimit(1)
                            if let badge = line.badge {
                                Text(badge)
                                    .font(Theme.text(11, semiBold: true))
                                    .textCase(.uppercase)
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                        .padding(.leading, continues ? 10 : 0)
                        .overlay(alignment: .leading) {
                            if continues {
                                Rectangle().fill(Theme.muted).frame(width: 2).padding(.vertical, 2)
                            }
                        }
                        .listRowBackground(Color.clear)
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text(ready.name)
                        .font(Theme.text(12, semiBold: true))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.muted)
                }
            }
            .listStyle(.plain)
            .navigationTitle("Exercises")
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("Exercises")
                    .font(Theme.display(22))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.chalk)
                Text("Nothing planned to start here.")
                    .font(Theme.text(14))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: - The week

struct WeekPage: View {
    let week: [WatchWeekDay]

    var body: some View {
        TimelineView(.everyMinute) { context in
            let today = localDay(context.date)
            VStack(alignment: .leading, spacing: 6) {
                Text("This week")
                    .font(Theme.display(20))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.chalk)
                    .accessibilityAddTraits(.isHeader)
                if week.isEmpty {
                    Text("Your week loads from your iPhone.")
                        .font(Theme.text(14))
                        .foregroundStyle(Theme.muted)
                } else {
                    HStack(spacing: 3) {
                        ForEach(week, id: \.date) { day in
                            dayMark(day, isToday: day.date == today)
                        }
                    }
                    .padding(.trailing, 10) // clear of the page dots
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(week.filter { $0.name != nil }, id: \.date) { day in
                            HStack(spacing: 4) {
                                Text(day.weekday)
                                    .font(Theme.text(12, semiBold: true))
                                    .foregroundStyle(day.date == today ? Theme.hot : Theme.muted)
                                    .frame(width: 30, alignment: .leading)
                                Text(day.name ?? "")
                                    .font(Theme.text(13))
                                    .foregroundStyle(day.state == .done ? Theme.muted : Theme.chalk)
                                    .lineLimit(1)
                                if day.state == .done {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(Theme.muted)
                                }
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    /// Done is a chalk check; planned an outline; today a blue ring; a rest day a dot.
    private func dayMark(_ day: WatchWeekDay, isToday: Bool) -> some View {
        VStack(spacing: 2) {
            ZStack {
                switch day.state {
                case .done:
                    Circle().fill(Theme.chalk)
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(Theme.ground)
                case .planned, .today:
                    Circle().strokeBorder(Theme.chalk.opacity(0.7), lineWidth: 1.5)
                case .rest:
                    Circle().fill(Theme.muted).frame(width: 4, height: 4)
                }
                if isToday || day.state == .today {
                    Circle().strokeBorder(Theme.hot, lineWidth: 2)
                }
            }
            .frame(width: 20, height: 20)
            Text(String(day.weekday.prefix(1)))
                .font(Theme.text(10, semiBold: true))
                .foregroundStyle(isToday ? Theme.hot : Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(dayDescription(day, isToday: isToday))
    }

    private func dayDescription(_ day: WatchWeekDay, isToday: Bool) -> String {
        var parts = [day.weekday + (isToday ? ", today" : ""), day.name ?? "rest day"]
        switch day.state {
        case .done: parts.append("done")
        case .planned, .today: parts.append("planned")
        case .rest: break
        }
        return parts.joined(separator: ", ")
    }
}
#endif
