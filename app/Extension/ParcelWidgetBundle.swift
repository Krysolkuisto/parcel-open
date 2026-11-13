import ParcelWidget
import SwiftUI
import WidgetKit

/// Entry point of the widget extension. Only the Xcode project compiles this file
/// (see `project.yml`); the widget itself lives in `Sources/ParcelWidget`.
@main
struct ParcelWidgetBundle: WidgetBundle {
    var body: some Widget {
        ParcelOpenWidget()
    }
}
