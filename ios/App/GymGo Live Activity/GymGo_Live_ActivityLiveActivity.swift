//
//  GymGo_Live_ActivityLiveActivity.swift
//  GymGo Live Activity
//
//  Created by Liam Daly on 14/10/2026.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct GymGo_Live_ActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic stateful properties about your activity go here!
        var emoji: String
    }

    // Fixed non-changing properties about your activity go here!
    var name: String
}

struct GymGo_Live_ActivityLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GymGo_Live_ActivityAttributes.self) { context in
            // Lock screen/banner UI goes here
            VStack {
                Text("Hello \(context.state.emoji)")
            }
            .activityBackgroundTint(Color.cyan)
            .activitySystemActionForegroundColor(Color.black)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI goes here.  Compose the expanded UI through
                // various regions, like leading/trailing/center/bottom
                DynamicIslandExpandedRegion(.leading) {
                    Text("Leading")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Trailing")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Bottom \(context.state.emoji)")
                    // more content
                }
            } compactLeading: {
                Text("L")
            } compactTrailing: {
                Text("T \(context.state.emoji)")
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "http://www.apple.com"))
            .keylineTint(Color.red)
        }
    }
}

extension GymGo_Live_ActivityAttributes {
    fileprivate static var preview: GymGo_Live_ActivityAttributes {
        GymGo_Live_ActivityAttributes(name: "World")
    }
}

extension GymGo_Live_ActivityAttributes.ContentState {
    fileprivate static var smiley: GymGo_Live_ActivityAttributes.ContentState {
        GymGo_Live_ActivityAttributes.ContentState(emoji: "😀")
     }
     
     fileprivate static var starEyes: GymGo_Live_ActivityAttributes.ContentState {
         GymGo_Live_ActivityAttributes.ContentState(emoji: "🤩")
     }
}

#Preview("Notification", as: .content, using: GymGo_Live_ActivityAttributes.preview) {
   GymGo_Live_ActivityLiveActivity()
} contentStates: {
    GymGo_Live_ActivityAttributes.ContentState.smiley
    GymGo_Live_ActivityAttributes.ContentState.starEyes
}
