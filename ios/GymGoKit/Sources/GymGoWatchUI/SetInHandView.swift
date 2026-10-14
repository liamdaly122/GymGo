#if os(watchOS)
import GymGoKit
import SwiftUI
import WatchKit

enum SetField { case weight, reps }

/// The set in hand: the lift, which set it is, and two tiles, the weight and
/// the reps, poster-sized. Tap a tile to select it; the Crown and the big
/// −/+ buttons (hold to repeat) move the selected one: the weight through
/// the weights the gym can actually load, the reps one at a time. Done is
/// always there and logs exactly what is on screen; with no reps yet it
/// reads "Done · 102.5 × ?" and asks for them with a grid that logs on tap.
struct SetInHandView: View {
    let store: WatchSessionStore
    let hand: SetInHand
    let expandRest: () -> Void

    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var weightIndex = 0.0
    @State private var reps = 0.0
    @State private var field = SetField.weight
    @State private var pickingReps = false
    @State private var showingLift = false
    @FocusState private var crownFocused: Bool

    // The dial is GymGoKit's (`SetDial`), the one rule for the numbers on
    // screen, which the Action button's Done and the state report read too.
    private var dial: SetDial { hand.dial }
    private var ladder: [Double] { dial.ladder }
    private var index: Int { min(max(Int(weightIndex.rounded()), 0), ladder.count - 1) }
    private var weight: Double { dial.weight(at: weightIndex) }
    private var repCount: Int { dial.reps(reps) }

    // Sized from the screen: 49mm is 205 points wide, 41mm 176.
    private var compact: Bool { Theme.screenWidth < 190 }
    private var hero: CGFloat { (Theme.screenWidth * 0.27).rounded() }
    private var tileHeight: CGFloat { compact ? 62 : 72 }
    private var buttonHeight: CGFloat { compact ? 36 : 42 }
    private var doneHeight: CGFloat { compact ? 40 : 46 }
    private var gap: CGFloat { compact ? 4 : 6 }
    /// The system clock sits at the top right, in the name's row.
    private var clockWidth: CGFloat { compact ? 44 : 50 }

    private var weightText: String {
        weight == 0 && hand.lift.unit == "kg added" ? "BW" : formatWeight(weight)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: gap) {
            header
            HStack(spacing: gap) {
                tile(.weight, value: weightText, label: hand.lift.unit)
                tile(.reps, value: repCount > 0 ? "\(repCount)" : "–", label: "reps")
                    .frame(width: (Theme.screenWidth * 0.34).rounded())
            }
            if !dimmed {
                HStack(spacing: gap) {
                    stepper(-1)
                    stepper(1)
                }
                doneButton
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .focusable()
        .focusEffectDisabled()
        .focused($crownFocused)
        .digitalCrownRotation(
            field == .weight ? $weightIndex : $reps,
            from: 0,
            through: field == .weight ? Double(ladder.count - 1) : 50,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .digitalCrownAccessory {
            Text(field == .weight ? "KG" : "REPS")
                .font(Theme.text(11, semiBold: true))
                .foregroundStyle(Theme.hot)
        }
        .sheet(isPresented: $pickingReps) {
            RepsGrid(title: "\(formatWeight(weight)) \(hand.lift.unit) ×") { picked in
                // Logged as picked: changing `reps` here would leave this
                // set's numbers behind as the next set's draft.
                pickingReps = false
                log(reps: picked)
            }
        }
        .sheet(isPresented: $showingLift) {
            LiftSheet(store: store, hand: hand)
        }
        .onAppear(perform: reset)
        .onChange(of: hand.set.id) { reset() }
        .onChange(of: weightIndex) { keepDraft() }
        .onChange(of: reps) { keepDraft() }
        .onChange(of: field) { keepDraft() }
        .onChange(of: dimmed) { _, isDimmed in
            if isDimmed {
                pickingReps = false
                showingLift = false
            } else {
                crownFocused = true
            }
        }
    }

    // MARK: - Parts

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                store.touched()
                showingLift = true
            } label: {
                Text(hand.lift.name)
                    .font(Theme.display(compact ? 17 : 19))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.chalk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .padding(.trailing, clockWidth)
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint("Shows the plan, last time, today's sets, and skipping")

            HStack(spacing: 4) {
                if let rest = store.rest {
                    Button(action: expandRest) {
                        HStack(spacing: 4) {
                            Text("Rest")
                            countdown(to: rest.endsAt).monospacedDigit()
                        }
                        .font(Theme.text(12, semiBold: true))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.hot)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Resting, show the rest")
                } else if let record = store.state.lastRecord {
                    // The set just done was a record and no rest followed (the
                    // first half of a superset): said here, in blue, until
                    // the rest that ends the round, which leads with it.
                    Text("New record · \(recordLine(record))")
                        .font(Theme.text(12, semiBold: true))
                        .foregroundStyle(Theme.hot)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .accessibilityLabel("New record. \(recordLine(record))")
                } else {
                    // "Set 1 of 4 · Go up" while the numbers are the plan's
                    // suggestion, "Set 2 of 4 · Lighter" after a step-down,
                    // else "Set 2 of 4 · 2/6".
                    Text(hand.headerLine(stations: store.session?.snapshot.stations.count ?? 1))
                        .font(Theme.text(12))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 2)
                HeartRateBadge(workout: store.workout)
            }
        }
    }

    private func tile(_ which: SetField, value: String, label: String) -> some View {
        let selected = field == which && !dimmed
        return VStack(alignment: .leading, spacing: 0) {
            Text(label.uppercased())
                .font(Theme.text(11, semiBold: true))
                .foregroundStyle(selected ? Theme.hot : Theme.muted)
                .lineLimit(1)
            Text(value)
                .font(Theme.number(hero))
                .foregroundStyle(selected ? Theme.hot : Theme.chalk)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(height: hero * 0.86)
        }
        .opacity(dimmed ? 0.6 : 1)
        .padding(.horizontal, 6)
        .frame(maxWidth: .infinity, minHeight: tileHeight, maxHeight: tileHeight, alignment: .leading)
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(selected ? Theme.hot : Theme.raised, lineWidth: selected ? 2 : 1)
        }
        .contentShape(.rect)
        .onTapGesture {
            store.touched()
            field = which
            crownFocused = true
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(which == .weight ? "Weight" : "Repetitions")
        .accessibilityValue(which == .weight ? "\(value) \(hand.lift.unit)" : (repCount > 0 ? value : "not set"))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAdjustableAction { direction in
            field = which
            step(direction == .increment ? 1 : -1)
        }
    }

    private func stepper(_ by: Int) -> some View {
        Button {
            step(by)
        } label: {
            Image(systemName: by < 0 ? "minus" : "plus")
                .font(.system(size: 20, weight: .heavy))
                .frame(maxWidth: .infinity, minHeight: buttonHeight)
        }
        .raisedButton()
        .buttonRepeatBehavior(.enabled)
        .accessibilityLabel("\(by < 0 ? "Decrease" : "Increase") \(field == .weight ? "weight" : "reps")")
    }

    private var doneButton: some View {
        Button {
            store.touched()
            if repCount > 0 { log(reps: repCount) } else { pickingReps = true }
        } label: {
            Text("Done · \(weight > 0 ? formatWeight(weight) : "BW") × \(repCount > 0 ? "\(repCount)" : "?")")
                .font(Theme.display(compact ? 16 : 18, extraBold: true))
                .textCase(.uppercase)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: doneHeight)
        }
        .chalkButton()
        .handGestureShortcut(.primaryAction)
        .accessibilityLabel(repCount > 0
            ? "Mark \(hand.set.label) done, \(formatWeight(weight))kg × \(repCount)"
            : "Mark \(hand.set.label) done, \(formatWeight(weight))kg, choose the reps")
    }

    // MARK: - Actions

    private func step(_ by: Int) {
        store.touched()
        switch field {
        case .weight: weightIndex = Double(min(max(index + by, 0), ladder.count - 1))
        case .reps: reps = Double(min(max(repCount + by, 0), 50))
        }
    }

    private func log(reps count: Int) {
        store.draft = nil
        store.done(weight: weight, reps: count)
    }

    /// The numbers the session list and the watch's rules chose, or what was
    /// dialled in for this set before the screen went away
    /// (`SetInHand.dialled`, the rule the Action button's Done reads too).
    private func reset() {
        let dialled = hand.dialled(store.draft)
        weightIndex = dialled.weightIndex
        reps = dialled.reps
        field = dialled.onReps ? .reps : .weight
        crownFocused = true
    }

    private func keepDraft() {
        store.draft = SetDraft(setId: hand.set.id, weightIndex: weightIndex, reps: reps, onReps: field == .reps)
    }
}

/// "102.5 kg ×", then 1 to 30: tap one and the set is logged.
struct RepsGrid: View {
    let title: String
    let pick: (Int) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(Theme.display(18, extraBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.chalk)
                    .accessibilityAddTraits(.isHeader)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                    ForEach(1...30, id: \.self) { count in
                        Button {
                            pick(count)
                        } label: {
                            Text("\(count)")
                                .font(Theme.number(24))
                                .frame(maxWidth: .infinity, minHeight: 40)
                        }
                        .raisedButton()
                        .accessibilityLabel("\(count) reps, log the set")
                    }
                }
            }
        }
        .containerBackground(Theme.ground, for: .navigation)
    }
}

/// The lift: why the numbers are what they are, how it went last time, its
/// setup note and the sets of it done today; and the way out of the set in
/// hand, Skip this set or Done with this lift.
struct LiftSheet: View {
    let store: WatchSessionStore
    let hand: SetInHand
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let done = doneToday
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                Text(hand.lift.name)
                    .font(Theme.display(20, extraBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.chalk)
                    .accessibilityAddTraits(.isHeader)
                Text(hand.station.outline)
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.muted)

                if hand.stepDownReason != nil || hand.lift.plan != nil {
                    heading("Plan")
                    if let reason = hand.stepDownReason {
                        why("Lighter", reason)
                    }
                    if let plan = hand.lift.plan {
                        why(plan.verb, plan.reason)
                    }
                }
                if let last = hand.lift.lastTime {
                    heading(last.heading(today: localDay(Date())))
                    Text(last.setsLine)
                        .font(Theme.number(20))
                        .foregroundStyle(Theme.chalk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let note = hand.lift.setupNote, !note.isEmpty {
                    heading("Setup")
                    Text(note)
                        .font(Theme.text(14))
                        .foregroundStyle(Theme.chalk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                heading("Today")
                if done.isEmpty {
                    Text("Nothing logged yet")
                        .font(Theme.text(13))
                        .foregroundStyle(Theme.muted)
                } else {
                    ForEach(Array(done.enumerated()), id: \.offset) { _, set in
                        Text(formatLogged(set.weight, set.reps))
                            .font(Theme.number(20))
                            .foregroundStyle(Theme.chalk)
                    }
                }

                // Raised, not chalk: Done is still the thing to press next.
                action("Skip this set", hint: "Moves on without logging \(hand.set.label)") {
                    store.skipSetInHand()
                }
                .padding(.top, 4)
                action("Done with this lift", hint: "Moves on, skipping the sets of it still to do") {
                    store.doneWithLift()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .containerBackground(Theme.ground, for: .navigation)
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(Theme.text(11, semiBold: true))
            .textCase(.uppercase)
            .foregroundStyle(Theme.muted)
            .padding(.top, 2)
            .accessibilityAddTraits(.isHeader)
    }

    /// A verb and what it means: "Go up", then the engine's reason.
    private func why(_ verb: String, _ reason: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verb)
                .font(Theme.text(14, semiBold: true))
                .foregroundStyle(Theme.chalk)
            Text(reason)
                .font(Theme.text(13))
                .foregroundStyle(Theme.chalk)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private func action(_ title: String, hint: String, _ perform: @escaping () -> Void) -> some View {
        Button {
            perform()
            dismiss()
        } label: {
            Text(title)
                .font(Theme.display(16))
                .textCase(.uppercase)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity, minHeight: 40)
        }
        .raisedButton()
        .accessibilityHint(hint)
    }

    private var doneToday: [(weight: Double, reps: Int)] {
        guard let session = store.session else { return [] }
        let phone = hand.lift.doneToday.map { (weight: $0.weight, reps: $0.reps, at: WatchSession.date($0.completedAt)) }
        let phoneIds = Set(hand.lift.doneToday.map(\.setId))
        let wrist = session.logged.values
            .filter { session.loggedHere[$0.setId] == hand.set.exerciseId && !phoneIds.contains($0.setId) }
            .map { (weight: $0.weight, reps: $0.reps, at: $0.completedAt) }
        return (phone + wrist).sorted { $0.at < $1.at }.map { ($0.weight, $0.reps) }
    }
}
#endif
