import ParcelKit
import SwiftUI

struct PackageDetailView: View {
    @Environment(AppModel.self) private var model
    let package: ParcelPackage

    @State private var showAllEvents = false
    @State private var showEdit = false
    @State private var confirmDelete = false

    private let collapsedCount = 3

    private var events: [TrackingEvent] {
        package.events ?? package.lastEvent.map { [$0] } ?? []
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                statusBanner
                timeline
                PackageMap(place: events.first?.location ?? package.destination)
            }
            .padding(24)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(package.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task(id: package.id) { await model.loadDetail(id: package.id) }
        .toolbar { toolbar }
        .sheet(isPresented: $showEdit) { PackageForm(mode: .edit(package)) }
        .confirmationDialog(tr("action.deleteConfirm"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(tr("action.delete"), role: .destructive) { Task { await model.delete(package) } }
        } message: {
            Text(tr("action.deleteMessage"))
        }
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(package.title)
                .font(.largeTitle.bold())
            HStack {
                Text(package.trackingNumber)
                    .font(.system(.title3, design: .monospaced))
                    .foregroundStyle(Color.parcelAccent)
                    .textSelection(.enabled)
                Spacer()
                if let carrier = package.carrierName {
                    Text(carrier).foregroundStyle(.secondary)
                }
            }
            Divider()
        }
    }

    @ViewBuilder
    private var statusBanner: some View {
        HStack(spacing: 10) {
            Image(systemName: package.status.symbol)
                .foregroundStyle(package.status.color)
            VStack(alignment: .leading, spacing: 2) {
                Text(package.statusText ?? package.status.title).font(.headline)
                if package.status.isActive, let eta = package.eta {
                    Text("\(tr("detail.eta")): \(ParcelFormat.day(eta))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let route = routeText {
                    Text(route).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        if let error = package.lastError {
            Label(tr("detail.lastError", error), systemImage: "wifi.exclamationmark")
                .font(.footnote)
                .foregroundStyle(.orange)
        }
    }

    private var routeText: String? {
        switch (package.origin, package.destination) {
        case let (origin?, destination?): return "\(origin) → \(destination)"
        case let (origin?, nil): return origin
        case let (nil, destination?): return destination
        default: return nil
        }
    }

    @ViewBuilder
    private var timeline: some View {
        if events.isEmpty {
            Text(tr("detail.noEvents")).foregroundStyle(.secondary)
        } else {
            let shown = showAllEvents ? events : Array(events.prefix(collapsedCount))
            VStack(alignment: .leading, spacing: 0) {
                ForEach(shown) { event in
                    EventRow(event: event)
                    Divider()
                }
            }
            if events.count > collapsedCount {
                Button(showAllEvents ? tr("detail.lessHistory") : tr("detail.fullHistory")) {
                    withAnimation { showAllEvents.toggle() }
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup {
            Button { showEdit = true } label: { Label(tr("action.edit"), systemImage: "pencil") }
            Button { confirmDelete = true } label: { Label(tr("action.delete"), systemImage: "trash") }
            Button { Task { await model.setArchived(package, !package.archived) } } label: {
                Label(package.archived ? tr("action.unarchive") : tr("action.archive"),
                      systemImage: package.archived ? "arrow.uturn.backward" : "checkmark")
            }
            Button { Task { await model.refreshOne(package) } } label: {
                Label(tr("action.refresh"), systemImage: "arrow.clockwise")
            }
            .disabled(model.isRefreshing)
            ShareLink(item: package.trackingNumber) { Label(tr("action.share"), systemImage: "square.and.arrow.up") }
        }
    }
}

private struct EventRow: View {
    let event: TrackingEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(ParcelFormat.dateTime(event.time))
                .font(.subheadline.weight(.medium))
            if let location = event.location {
                Text(location).foregroundStyle(.secondary)
            }
            Text(event.description).font(.headline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 12)
    }
}
