import CoreText
import SwiftUI
#if os(watchOS)
import WatchKit
#endif

/// The app's look, on the wrist: near-black ground, chalk numbers, one blue
/// highlight. The same two colours with the same two jobs as on the phone
/// (CLAUDE.md, "Design"): chalk is the action, blue is where you are and what
/// improved. Blue on a button, or chalk on a state, blurs the only signal.
public enum Theme {
    public static let ground = Color(red: 12 / 255, green: 12 / 255, blue: 11 / 255)
    public static let chalk = Color(red: 243 / 255, green: 241 / 255, blue: 234 / 255)
    public static let hot = Color(red: 91 / 255, green: 132 / 255, blue: 255 / 255)
    public static let muted = Color(red: 243 / 255, green: 241 / 255, blue: 234 / 255).opacity(0.55)
    public static let raised = Color(red: 32 / 255, green: 32 / 255, blue: 30 / 255)

    /// Big Shoulders Display, for numbers, names and buttons.
    public static func display(_ size: CGFloat, extraBold: Bool = false) -> Font {
        registerFonts()
        return .custom(extraBold ? "BigShouldersDisplayThin-ExtraBold" : "BigShouldersDisplayThin-Bold", size: size)
    }

    /// Barlow, for everything you read.
    public static func text(_ size: CGFloat, semiBold: Bool = false) -> Font {
        registerFonts()
        return .custom(semiBold ? "Barlow-SemiBold" : "Barlow-Medium", size: size)
    }

    /// The big digits: Big Shoulders Display at a fixed size, so a large text
    /// setting cannot push a weight out of its tile. Labels still scale.
    public static func number(_ size: CGFloat) -> Font {
        registerFonts()
        return .custom("BigShouldersDisplayThin-ExtraBold", fixedSize: size)
    }

    /// The screen's width in points: 205 on a 49mm Ultra, 176 on a 41mm.
    @MainActor
    public static var screenWidth: CGFloat {
        #if os(watchOS)
        WKInterfaceDevice.current().screenBounds.width
        #else
        205
        #endif
    }

    private static let registered: Bool = {
        for name in ["BigShouldersDisplay-Bold", "BigShouldersDisplay-ExtraBold", "Barlow-Medium", "Barlow-SemiBold"] {
            guard let url = Bundle.module.url(forResource: name, withExtension: "ttf") else { continue }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        return true
    }()

    /// Registers the bundled fonts once, the first time one is asked for.
    public static func registerFonts() { _ = registered }
}

// `formatWeight` and `formatLogged` are in GymGoKit (Stations.swift): Up next
// and the state report word numbers there, the same way the screens do.

/// "1:02:15" or "42:07"; "1:02" when only minutes may show (Always On).
func formatElapsed(_ seconds: TimeInterval, minutesOnly: Bool = false) -> String {
    let total = max(0, Int(seconds))
    let hours = total / 3600, minutes = (total % 3600) / 60, secs = total % 60
    if minutesOnly { return hours > 0 ? String(format: "%d:%02d", hours, minutes) : "\(minutes) min" }
    return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
}
