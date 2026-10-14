#if os(watchOS)
import GymGoKit
import SwiftUI
import WatchKit

enum WorkoutPage: Hashable { case controls, main, metrics, session, music }

/// A workout running: horizontal pages, like Apple's Workout app.
/// Controls ← Main → Metrics → Session → Now Playing. Horizontal paging
/// leaves the Crown on the weight and the reps. Main comes back by itself
/// when the wrist drops, when a rest starts or ends, and when the set in
/// hand changes.
struct WorkoutPages: View {
    let store: WatchSessionStore
    @State private var page = WorkoutPage.main
    @State private var restCollapsed = false
    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        NavigationStack {
            TabView(selection: $page) {
                ControlsPage(store: store)
                    .containerBackground(Theme.ground, for: .tabView)
                    .tag(WorkoutPage.controls)
                MainPage(store: store, restCollapsed: $restCollapsed)
                    .containerBackground(Theme.ground, for: .tabView)
                    .tag(WorkoutPage.main)
                MetricsPage(store: store)
                    .containerBackground(Theme.ground, for: .tabView)
                    .tag(WorkoutPage.metrics)
                SessionListView(store: store)
                    .containerBackground(Theme.ground, for: .tabView)
                    .tag(WorkoutPage.session)
                NowPlayingView()
                    .tag(WorkoutPage.music)
            }
            .tabViewStyle(.page)
        }
        .onChange(of: dimmed) { _, isDimmed in
            if isDimmed {
                page = .main
                restCollapsed = false
            }
        }
        .onChange(of: store.rest?.id) {
            page = .main
            restCollapsed = false
        }
        .onChange(of: store.setInHand?.set.id) {
            page = .main
        }
        .onChange(of: store.state.owner) {
            page = .main
        }
    }
}

// MARK: - Main

struct MainPage: View {
    let store: WatchSessionStore
    @Binding var restCollapsed: Bool

    var body: some View {
        Group {
            if store.state.owner == .phone {
                LoggingOnPhoneView(store: store)
            } else if let rest = store.rest, !restCollapsed {
                RestView(store: store, rest: rest) { restCollapsed = true }
                    .overlay(alignment: .top) {
                        if store.workout.isPaused { PausedLine(store: store) }
                    }
            } else if let hand = store.setInHand {
                SetInHandView(store: store, hand: hand) { restCollapsed = false }
                    .overlay(alignment: .top) {
                        if store.workout.isPaused { PausedLine(store: store) }
                    }
            } else {
                AllLoggedView(store: store)
            }
        }
    }
}

/// While Health is paused, the set screen says so in its top line, the one
/// the clock shares: "PAUSED" in blue (a state) and RESUME in chalk (the
/// thing to press), over the lift's name until the pause ends. The set's
/// label stays under it, and Done stays below and keeps the double tap;
/// logging a set resumes too. Laid over `SetInHandView` and `RestView` (over
/// the rest's "Rest" and heart rate; the countdown stays) from here, one
/// line high, on the ground colour; the whole line is the button.
/// `AllLoggedView` puts it above its heading.
struct PausedLine: View {
    let store: WatchSessionStore

    // As SetInHandView sizes its header: 49mm is 205 points wide, 41mm 176.
    private var compact: Bool { Theme.screenWidth < 190 }
    /// The system clock sits at the top right, in this line.
    private var clockWidth: CGFloat { compact ? 44 : 50 }

    var body: some View {
        Button {
            store.resumeWorkout()
        } label: {
            HStack(spacing: 6) {
                Text("Paused")
                    .font(Theme.text(13, semiBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.hot)
                    .lineLimit(1)
                Text("Resume")
                    .font(Theme.display(14, extraBold: true))
                    .textCase(.uppercase)
                    .lineLimit(1)
                    .foregroundStyle(Theme.ground)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(Theme.chalk))
                Spacer(minLength: 0)
            }
            .padding(.trailing, clockWidth)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .background(Theme.ground)
        .accessibilityLabel("Paused. Resume the workout")
    }
}

/// The heart rate, small, under the clock. It never animates: Always On
/// redraws at most once a second.
struct HeartRateBadge: View {
    let workout: WorkoutController

    var body: some View {
        let rate = workout.heartRate.map { Int($0.rounded()) }
        HStack(spacing: 2) {
            Image(systemName: "heart.fill")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.muted)
            Text(rate.map(String.init) ?? "--")
                .font(Theme.text(14, semiBold: true))
                .monospacedDigit()
                .foregroundStyle(Theme.chalk)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rate.map { "Heart rate \($0) beats per minute" } ?? "Heart rate not read yet")
    }
}

/// Nothing left to log: "All sets logged", or "Nothing left · 2 skipped"
/// when what is left was skipped (`WatchSession.nothingLeftTitle`), and
/// Finish. The last set of a session often has no rest after it, so this is
/// where its "Logged · Undo" shows, in the place of the explanation.
struct AllLoggedView: View {
    let store: WatchSessionStore
    @State private var confirming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if store.workout.isPaused { PausedLine(store: store) }
            Text(store.session?.nothingLeftTitle ?? "All sets logged")
                .font(Theme.display(26, extraBold: true))
                .textCase(.uppercase)
                .foregroundStyle(Theme.chalk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            UndoOr(store: store, height: 40) {
                Text("Finish to save it on your iPhone and in Health.")
                    .font(Theme.text(13))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            Button {
                store.touched()
                confirming = true
            } label: {
                Text("Finish")
                    .font(Theme.display(20, extraBold: true))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .chalkButton()
            .handGestureShortcut(.primaryAction)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .finishConfirmation(store: store, isPresented: $confirming)
    }
}

/// The phone took logging back. The Health workout keeps recording here.
struct LoggingOnPhoneView: View {
    let store: WatchSessionStore

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "iphone")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.hot)
                .accessibilityHidden(true)
            Text("Logging on your iPhone")
                .font(Theme.display(24, extraBold: true))
                .textCase(.uppercase)
                .foregroundStyle(Theme.chalk)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text("Health keeps recording on your watch.")
                .font(Theme.text(12))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button {
                store.reclaim()
            } label: {
                Text("Log here instead")
                    .font(Theme.display(18))
                    .textCase(.uppercase)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .chalkButton()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Controls

struct ControlsPage: View {
    let store: WatchSessionStore
    @State private var confirmingFinish = false
    @State private var confirmingDiscard = false

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                    control("Finish", symbol: "flag.checkered", chalk: true) { confirmingFinish = true }
                        .accessibilityLabel("Finish")
                    // Only a Health recording can pause. Raised, either way:
                    // Finish is this page's one chalk button.
                    if store.workout.isRunning {
                        if store.workout.isPaused {
                            control("Resume", symbol: "play.fill") { store.resumeWorkout() }
                                .accessibilityLabel("Resume the workout")
                        } else {
                            control("Pause", symbol: "pause.fill") { store.pauseWorkout() }
                                .accessibilityLabel("Pause the workout")
                        }
                    }
                    if store.rest != nil {
                        control("Skip rest", symbol: "forward.end.fill") { store.skipRest() }
                            .accessibilityLabel("Skip rest")
                    }
                    if store.session?.canDiscard == true {
                        control("Discard", symbol: "xmark") { confirmingDiscard = true }
                            .accessibilityLabel("Discard workout")
                    }
                    if store.state.owner == .phone {
                        control("Log here", symbol: "applewatch") { store.reclaim() }
                            .accessibilityLabel("Log here instead")
                    }
                }
                status
            }
        }
        .finishConfirmation(store: store, isPresented: $confirmingFinish)
        .confirmationDialog("Discard this workout?", isPresented: $confirmingDiscard) {
            Button("Discard") { store.discard() }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("Nothing is saved, here or on your iPhone.")
        }
    }

    private func control(_ title: String, symbol: String, chalk: Bool = false, action: @escaping () -> Void) -> some View {
        let button = Button {
            store.touched()
            action()
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 20, weight: .bold))
                Text(title)
                    .font(Theme.display(15))
                    .textCase(.uppercase)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 62)
        }
        return Group {
            if chalk { button.chalkButton() } else { button.raisedButton() }
        }
    }

    private var status: some View {
        VStack(alignment: .leading, spacing: 2) {
            let queued = store.state.queuedCount
            if queued > 0 {
                Text("iPhone · \(queued) waiting to send")
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.muted)
            }
            Text(healthLine)
                .font(Theme.text(12))
                .foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var healthLine: String {
        switch store.workout.health {
        case .recording: store.workout.isPaused ? "Health · paused" : "Health · recording"
        case .denied: "Health · off for GymGo"
        case .unavailable: "Health · not available"
        case .off: "Health · not recording"
        }
    }
}

/// "Finish and save? 14 of 18 logged · 2 skipped; sets not logged are
/// dropped." (`WatchSession.finishMessage`, worded and tested in GymGoKit.)
struct FinishConfirmation: ViewModifier {
    let store: WatchSessionStore
    @Binding var isPresented: Bool

    func body(content: Content) -> some View {
        content.confirmationDialog("Finish and save?", isPresented: $isPresented) {
            Button("Finish and save") { store.finish() }
            Button("Keep going", role: .cancel) {}
        } message: {
            Text(store.session?.finishMessage ?? "Every set is logged.")
        }
    }
}

extension View {
    func finishConfirmation(store: WatchSessionStore, isPresented: Binding<Bool>) -> some View {
        modifier(FinishConfirmation(store: store, isPresented: isPresented))
    }
}

// MARK: - Metrics

struct MetricsPage: View {
    let store: WatchSessionStore

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let elapsed = elapsedSeconds(at: context.date)
            let paused = store.workout.isPaused
            let progress: (done: Int, total: Int) = store.session?.progress ?? (0, 0)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(formatElapsed(elapsed, minutesOnly: context.cadence == .minutes))
                        .font(Theme.number(40))
                        .foregroundStyle(paused ? Theme.muted : Theme.chalk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if paused {
                        Text("Paused")
                            .font(Theme.text(12, semiBold: true))
                            .textCase(.uppercase)
                            .foregroundStyle(Theme.hot)
                            .lineLimit(1)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Elapsed \(formatElapsed(elapsed, minutesOnly: true))\(paused ? ", paused" : "")")
                HStack(alignment: .center, spacing: 4) {
                    metric(
                        store.workout.heartRate.map { String(Int($0.rounded())) } ?? "--", unit: "BPM",
                        label: store.workout.heartRate.map { "Heart rate \(Int($0.rounded())) beats per minute" } ?? "Heart rate not read yet"
                    )
                    Spacer(minLength: 4)
                    if store.workout.isRunning { pauseButton(paused: paused) }
                }
                metric(
                    store.workout.activeKcal.map { String(Int($0.rounded())) } ?? "--", unit: "KCAL",
                    label: "Active energy \(store.workout.activeKcal.map { "\(Int($0.rounded())) kilocalories" } ?? "not read yet")"
                )
                metric("\(progress.done) of \(progress.total)", unit: "SETS", label: "Sets \(progress.done) of \(progress.total)")
                if store.workout.health != .recording {
                    Text("Not recording to Health")
                        .font(Theme.text(11))
                        .foregroundStyle(Theme.muted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    /// Health's active time while it records: paused time left out, so the
    /// clock stands still through a pause, as the saved workout's duration
    /// will. Without Health, the wall clock from the session's start.
    private func elapsedSeconds(at now: Date) -> TimeInterval {
        if store.workout.isRunning, let active = store.workout.activeTime { return active.seconds(at: now) }
        return now.timeIntervalSince(startedAt)
    }

    private var startedAt: Date {
        let fromSession = WatchSession.date(store.session?.snapshot.startedAt)
        if fromSession != .distantPast { return fromSession }
        return store.workout.startDate ?? Date()
    }

    /// Pause, raised (there, not the next thing); Resume, chalk (it is).
    /// No double tap: that stays Done's on the set screen.
    @ViewBuilder
    private func pauseButton(paused: Bool) -> some View {
        let button = Button {
            if paused { store.resumeWorkout() } else { store.pauseWorkout() }
        } label: {
            Image(systemName: paused ? "play.fill" : "pause.fill")
                .font(.system(size: 16, weight: .heavy))
                .frame(width: 44, height: 36)
        }
        .accessibilityLabel(paused ? "Resume the workout" : "Pause the workout")
        if paused { button.chalkButton() } else { button.raisedButton() }
    }

    private func metric(_ value: String, unit: String, label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value)
                .font(Theme.number(30))
                .foregroundStyle(Theme.chalk)
                .monospacedDigit()
            Text(unit)
                .font(Theme.text(12, semiBold: true))
                .foregroundStyle(Theme.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
    }
}
#endif
