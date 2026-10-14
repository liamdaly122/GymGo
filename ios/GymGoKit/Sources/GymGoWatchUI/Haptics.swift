import Foundation
import GymGoKit
#if os(watchOS)
import WatchKit
#endif

/// Plays the contract's haptic sequences (`WatchCue.steps` in GymGoKit, the
/// table in docs/watch-protocol.md) on the wrist.
///
/// There is no stronger tap on the watch: strength comes from the heavier
/// types and from repeats, spaced so none is cut off. A new cue cancels one
/// still playing. Off when the phone's Vibrate switch is off. Wrist-down,
/// taps play only while the HealthKit workout session runs.
@MainActor
public final class Haptics {
    public var enabled = true
    private var playing: Task<Void, Never>?
    /// Each cue as it is asked for, for the tests, where nothing taps.
    var observe: (@MainActor (WatchCue) -> Void)?

    public init() {}

    public func play(_ cue: WatchCue) {
        guard enabled else { return }
        observe?(cue)
        playing?.cancel()
        let steps = cue.steps
        playing = Task { @MainActor in
            for step in steps {
                if step.after > 0 { try? await Task.sleep(for: .milliseconds(step.after)) }
                guard !Task.isCancelled else { return }
                Self.tap(step.kind)
            }
        }
    }

    public func cancel() {
        playing?.cancel()
        playing = nil
    }

    private static func tap(_ kind: HapticKind) {
        #if os(watchOS)
        let type: WKHapticType = switch kind {
        case .notification: .notification
        case .directionUp: .directionUp
        case .directionDown: .directionDown
        case .success: .success
        case .failure: .failure
        case .retry: .retry
        case .start: .start
        case .stop: .stop
        case .click: .click
        }
        WKInterfaceDevice.current().play(type)
        #endif
    }
}
