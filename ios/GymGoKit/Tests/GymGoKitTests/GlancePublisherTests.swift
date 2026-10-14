import Foundation
import Testing
@testable import GymGoKit
@testable import GymGoWatchUI

// The publisher writes the glance and reloads the complications, on the Mac
// with a temporary file: no group container, no WidgetKit.

private func temporaryGlance() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("glance-\(UUID().uuidString).json")
}

@MainActor
private final class Reloads {
    var count = 0
    var relevance = 0
    func publisher(_ url: URL?) -> GlancePublisher {
        GlancePublisher(url: url) { relevanceChanged in
            self.count += 1
            if relevanceChanged { self.relevance += 1 }
        }
    }
}

@MainActor
@Test func theComplicationsReloadOnlyWhenWhatTheyShowChanges() throws {
    let url = temporaryGlance()
    defer { try? FileManager.default.removeItem(at: url) }
    let reloads = Reloads()
    let publisher = reloads.publisher(url)
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))

    publisher.publish(state, now: minute(6), timeZone: london)
    publisher.publish(state, now: minute(7), timeZone: london)
    #expect(reloads.count == 1)
    #expect(WatchGlance.read(from: url) == publisher.last)
    // A newer context that changes nothing on the face.
    state.apply(try context(sentAt: minute(9), ready: readyObject()))
    publisher.publish(state, now: minute(9), timeZone: london)
    #expect(reloads.count == 1)

    _ = state.start(try #require(state.home?.ready), at: minute(10), eventId: "start")
    publisher.publish(state, now: minute(10), timeZone: london)
    #expect(reloads.count == 2)
    // Today stays relevant while its session runs, and stops once it is done.
    #expect(reloads.relevance == 1)
    _ = state.logSet(weight: 100, reps: 5, at: minute(12))
    let rest = try #require(state.rest)
    publisher.publish(state, now: minute(12), timeZone: london)
    #expect(reloads.count == 3)

    // The rest runs out: written, so the next glance starts from it, but no reload.
    let ranOut = state.restRanOut(id: rest.id)
    #expect(ranOut)
    publisher.publish(state, now: rest.endsAt, timeZone: london)
    #expect(reloads.count == 3)
    #expect(WatchGlance.read(from: url)?.session?.rest == nil)

    _ = state.finish(at: minute(40))
    publisher.publish(state, now: minute(40), timeZone: london)
    #expect(reloads.count == 4 && reloads.relevance == 2)
}

@MainActor
@Test func aTimeZoneChangeAlwaysReloadsAndWorksOutRelevanceAgain() throws {
    let url = temporaryGlance()
    defer { try? FileManager.default.removeItem(at: url) }
    let reloads = Reloads()
    let publisher = reloads.publisher(url)
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    publisher.publish(state, now: minute(6), timeZone: london)
    #expect(reloads.count == 1)

    publisher.timeZoneChanged(state, now: minute(7), timeZone: TimeZone(identifier: "America/New_York")!)
    #expect(reloads.count == 2 && reloads.relevance == 2)
}

@MainActor
@Test func aLaunchAfterTheZoneChangedWhileTheAppWasClosedReloads() throws {
    let url = temporaryGlance()
    defer { try? FileManager.default.removeItem(at: url) }
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let london = Reloads()
    london.publisher(url).publish(state, now: minute(6), timeZone: TimeZone(identifier: "Europe/London")!)
    #expect(london.count == 1)

    // Flown to New York with the app closed: the system's notification went
    // to nobody. The launch's publish finds the same state in another zone.
    let newYork = Reloads()
    let publisher = newYork.publisher(url)
    publisher.publish(state, now: minute(60 * 9), timeZone: TimeZone(identifier: "America/New_York")!)
    #expect(newYork.count == 1 && newYork.relevance == 1)
    #expect(WatchGlance.read(from: url)?.zone == "America/New_York")
    // Once is enough: the next save in the same zone changes nothing.
    publisher.publish(state, now: minute(60 * 9 + 1), timeZone: TimeZone(identifier: "America/New_York")!)
    #expect(newYork.count == 1)
}

@MainActor
@Test func withNoAppGroupNothingIsWrittenOrReloaded() throws {
    let reloads = Reloads()
    let publisher = reloads.publisher(nil)
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    publisher.publish(state)
    publisher.timeZoneChanged(state)
    #expect(reloads.count == 0 && publisher.last == nil)
}

@MainActor
@Test func aGlanceThatCannotBeWrittenIsTriedAgainOnTheNextSave() throws {
    // A folder where the file should be: the write fails.
    let url = temporaryGlance()
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: url) }
    let reloads = Reloads()
    let publisher = reloads.publisher(url)
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    publisher.publish(state, now: minute(6), timeZone: london)
    #expect(reloads.count == 0 && publisher.last == nil)

    try FileManager.default.removeItem(at: url)
    publisher.publish(state, now: minute(7), timeZone: london)
    #expect(reloads.count == 1 && WatchGlance.read(from: url) != nil)
}

@MainActor
@Test func aPublisherStartsFromTheFileAlreadyThere() throws {
    let url = temporaryGlance()
    defer { try? FileManager.default.removeItem(at: url) }
    var state = WatchAppState()
    state.apply(try context(ready: readyObject()))
    let first = Reloads()
    first.publisher(url).publish(state, now: minute(6), timeZone: london)
    #expect(first.count == 1)

    // Relaunched: the same glance is not a change.
    let again = Reloads()
    again.publisher(url).publish(state, now: minute(8), timeZone: london)
    #expect(again.count == 0)
}

// MARK: - The store's hook

@MainActor
@Test func theStorePublishesAfterEverySaveEvenWithNoStateFile() throws {
    let url = temporaryGlance()
    defer { try? FileManager.default.removeItem(at: url) }
    let reloads = Reloads()
    let publisher = reloads.publisher(url)
    let store = WatchSessionStore(workout: WorkoutController(), fileURL: nil, restAlerts: RestAlerts())
    store.onSaved = { publisher.publish($0) }

    let sentAt = Date()
    store.receive(try context(sentAt: sentAt, live: snapshotObject("two straight lifts", workoutId: "w-1", sentAt: iso(sentAt))))
    #expect(reloads.count == 1)
    #expect(WatchGlance.read(from: url)?.session?.setsDone == 0)

    store.done(weight: 100, reps: 5)
    #expect(reloads.count == 2)
    let written = try #require(WatchGlance.read(from: url)?.session)
    #expect(written.setsDone == 1 && written.rest != nil)

    // The heartbeat's report saves, and changes nothing on the face.
    store.reportNow()
    store.reportNow()
    #expect(reloads.count == 2)
}
