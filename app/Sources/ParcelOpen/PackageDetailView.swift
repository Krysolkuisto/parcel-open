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
                if package.isDemo {
                    Label(tr("demo.notice"), systemImage: "exclamationmark.triangle.fill")
                        .font(.callout)
                        .foregroundStyle(.orange)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.orange.opacity(0.12)))
                }
                if package.isManual {
                    Label(tr("manual.notice", package.setupHint ?? "SHIP24_API_KEY"), systemImage: "info.circle.fill")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.secondary.opacity(0.12)))
                }
                if package.isManual, let link = package.trackingLink {
                    // No provider can read this carrier: show its own page here instead of sending the user away.
                    CarrierPageSection(url: link)
                } else {
                    statusBanner
                    timeline
                    trackingLinkButton
                    PackageMap(position: package.position)
                }
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
                Text(package.status.title).font(.headline)
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
    private var trackingLinkButton: some View {
        if let link = package.trackingLink {
            Link(destination: link) {
                Label(tr("detail.openTracking"), systemImage: "arrow.up.right.square")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(package.isManual ? .large : .small)
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
