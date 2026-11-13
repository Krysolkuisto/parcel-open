import ParcelKit
import SwiftUI

@main
struct ParcelOpenApp: App {
    @State private var model = AppModel()

    init() {
        #if os(macOS)
        // Lets `swift run` (no .app bundle) show a window and come to the front.
        DispatchQueue.main.async {
            NSApplication.shared.setActivationPolicy(.regular)
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .tint(.parcelAccent)
                #if os(macOS)
                .frame(minWidth: 760, minHeight: 520)
                #endif
        }
        #if os(macOS)
        .defaultSize(width: 980, height: 680)
        .commands {
            CommandGroup(after: .newItem) {
                Button(tr("action.add")) { model.showAdd = true }
                    .keyboardShortcut("n")
                Button(tr("action.addMany")) { model.showBulkAdd = true }
                    .keyboardShortcut("n", modifiers: [.command, .shift])
                Button(tr("action.refresh")) { Task { await model.refresh() } }
                    .keyboardShortcut("r")
            }
        }
        #endif

        #if os(macOS)
        Settings {
            ServerSettingsView(onClose: nil)
                .environment(model)
                .frame(width: 460)
        }
        #endif
    }
}
