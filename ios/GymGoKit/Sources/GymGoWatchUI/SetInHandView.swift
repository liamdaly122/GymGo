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

    private var ladder: [Double] { hand.lift.ladder.isEmpty ? [0] : hand.lift.ladder }
    private var index: Int { min(max(Int(weightIndex.rounded()), 0), ladder.count - 1) }
    private var weight: Double { ladder[index] }
    private var repCount: Int { min(max(Int(reps.rounded()), 0), 50) }

    // Sized from the screen: 49mm is 205 points wide, 41mm 176.
    private var compact: Bool { Theme.screenWidth < 190 }
    private var hero: CGFloat { (Theme.screenWidth * 0.27).rounded() }
    private var tileHeight: CGFloat { compact ? 58 : 66 }
    private var buttonHeight: CGFloat { compact ? 36 : 42 }
    private var gap: CGFloat { compact ? 4 : 6 }

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
                pickingReps = false
                reps = Double(picked)
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
            .accessibilityAddTraits(.isHeader)
            .accessibilityHint("Shows the lift's notes and today's sets")

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
            } else {
                Text("\(hand.set.label) · \(hand.set.station + 1)/\(max(1, store.session?.snapshot.stations.count ?? 1))")
                    .font(Theme.text(12))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
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
                .frame(maxWidth: .infinity, minHeight: buttonHeight)
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
    /// dialled in for this set before the screen went away.
    private func reset() {
        if let draft = store.draft, draft.setId == hand.set.id {
            weightIndex = draft.weightIndex
            reps = draft.reps
            field = draft.onReps ? .reps : .weight
        } else {
            let target = hand.weight ?? 0
            weightIndex = Double(ladder.lastIndex { $0 <= target + 1e-9 } ?? 0)
            reps = Double(hand.reps ?? 0)
            field = (hand.reps ?? 0) > 0 ? .weight : .reps
        }
        crownFocused = true
    }

    private func keepDraft() {
        store.draft = WatchSessionStore.SetDraft(setId: hand.set.id, weightIndex: weightIndex, reps: reps, onReps: field == .reps)
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

/// The lift's setup note and the sets of it done today.
struct LiftSheet: View {
    let store: WatchSessionStore
    let hand: SetInHand

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
                if let note = hand.lift.setupNote, !note.isEmpty {
                    Text("Setup")
                        .font(Theme.text(11, semiBold: true))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.muted)
                    Text(note)
                        .font(Theme.text(14))
                        .foregroundStyle(Theme.chalk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text("Today")
                    .font(Theme.text(11, semiBold: true))
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.muted)
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
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .containerBackground(Theme.ground, for: .navigation)
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
