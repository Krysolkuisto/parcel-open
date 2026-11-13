import ParcelKit
import SwiftUI

struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        NavigationSplitView {
            PackageList()
                #if os(macOS)
                .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 380)
                #endif
        } detail: {
            if let package = model.package(id: model.selection) {
                PackageDetailView(package: package)
            } else {
                ContentUnavailableView(tr("detail.select"), systemImage: "shippingbox")
            }
        }
        .searchable(text: $model.searchText, prompt: tr("list.search"))
        .sheet(isPresented: $model.showAdd) {
            PackageForm(mode: .add)
        }
        .sheet(isPresented: $model.showSettings) {
            ServerSettingsView(onClose: { model.showSettings = false })
        }
        .alert(tr("error.title"), isPresented: Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )) {
            Button(tr("action.ok"), role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
        .task {
            if model.needsSetup { model.showSettings = true }
            await model.refresh()
            // Keep the list fresh while the app is open.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(300))
                await model.refresh()
            }
        }
    }
}

struct PackageList: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        List(selection: $model.selection) {
            if !model.activePackages.isEmpty {
                Section {
                    ForEach(model.activePackages) { PackageRow(package: $0).tag($0.id) }
                }
            }
            if !model.deliveredPackages.isEmpty {
                Section(tr("list.section.delivered")) {
                    ForEach(model.deliveredPackages) { PackageRow(package: $0).tag($0.id) }
                }
            }
        }
        .overlay {
            if model.packages.isEmpty && !model.isRefreshing {
                ContentUnavailableView(
                    tr("list.empty.title"), systemImage: "shippingbox",
                    description: Text(tr("list.empty.message")))
            }
        }
        .refreshable { await model.refresh() }
        .toolbar {
            ToolbarItemGroup {
                Button { Task { await model.refresh() } } label: {
                    Label(tr("action.refresh"), systemImage: "arrow.clockwise")
                }
                .disabled(model.isRefreshing)
                Button { model.showAdd = true } label: {
                    Label(tr("action.add"), systemImage: "plus")
                }
                #if os(iOS)
                Button { model.showSettings = true } label: {
                    Label(tr("settings.title"), systemImage: "server.rack")
                }
                #endif
            }
        }
    }
}
