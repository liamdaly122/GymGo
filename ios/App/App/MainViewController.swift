import Capacitor
import UIKit

/// The web view's controller, with the app's own plugins registered. With
/// Capacitor 8's scene template this is how a local plugin is added; the
/// storyboard route in older guides no longer applies.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(WatchBridgePlugin())
    }
}
