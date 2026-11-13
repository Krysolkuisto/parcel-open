import ParcelKit
import SwiftUI
import WidgetKit

public struct ParcelOpenWidget: Widget {
    public static let kind = "ParcelOpenWidget"

    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: ParcelProvider()) { entry in
            ParcelWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName(tr("widget.name"))
        .description(tr("widget.description"))
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct ParcelEntry: TimelineEntry {
    enum State { case ready, notConfigured, offline }

    let date: Date
    let feed: WidgetFeed?
    let state: State
}

struct ParcelProvider: TimelineProvider {
    func placeholder(in context: Context) -> ParcelEntry {
        ParcelEntry(date: .now, feed: Self.sample, state: .ready)
    }

    func getSnapshot(in context: Context, completion: @escaping (ParcelEntry) -> Void) {
        if context.isPreview {
            completion(ParcelEntry(date: .now, feed: Self.sample, state: .ready))
        } else {
            Task { completion(await Self.load()) }
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ParcelEntry>) -> Void) {
        Task {
            let entry = await Self.load()
            // The app also reloads timelines after each refresh; this is the fallback cadence.
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }

    private static func load() async -> ParcelEntry {
        guard let client = ConfigStore.load()?.client else {
            return ParcelEntry(date: .now, feed: nil, state: .notConfigured)
        }
        do {
            let feed = try await client.widget(limit: 6)
            FeedCache.save(feed)
            return ParcelEntry(date: .now, feed: feed, state: .ready)
        } catch {
            return ParcelEntry(date: .now, feed: FeedCache.load(), state: .offline)
        }
    }

    static let sample = WidgetFeed(
        generatedAt: .now, activeCount: 3, outForDeliveryCount: 1,
        items: [
            WidgetItem(id: "1", title: "1st pack", trackingNumber: "1Z14V4W16890664609", carrierName: "UPS",
                       status: .outForDelivery, statusText: "Out for delivery", eta: .now),
            WidgetItem(id: "2", title: "2nd pack", trackingNumber: "1Z14V4W16890664610", carrierName: "UPS",
                       status: .inTransit, statusText: "Departed facility", eta: .now.addingTimeInterval(86_400)),
            WidgetItem(id: "3", title: "Shoes", trackingNumber: "9400111899223", carrierName: "USPS",
                       status: .pending, statusText: "Information received"),
        ])
}

struct ParcelWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: ParcelEntry

    private var rowLimit: Int {
        switch family {
        case .systemSmall: return 2
        case .systemMedium: return 3
        default: return 6
        }
    }

    var body: some View {
        switch entry.state {
        case .notConfigured:
            message(tr("widget.setup"), symbol: "server.rack")
        case .offline where entry.feed == nil:
            message(tr("widget.offline"), symbol: "wifi.slash")
        default:
            if let feed = entry.feed, !feed.items.isEmpty {
                content(feed)
            } else {
                message(tr("widget.empty"), symbol: "checkmark.circle")
            }
        }
    }

    private func content(_ feed: WidgetFeed) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "shippingbox.fill").foregroundStyle(Color.parcelAccent)
                Text(tr("widget.active", feed.activeCount)).font(.caption.weight(.semibold))
                Spacer()
                if entry.state == .offline {
                    Image(systemName: "wifi.slash").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if family != .systemSmall, feed.outForDeliveryCount > 0 {
                Text(tr("widget.outForDelivery", feed.outForDeliveryCount))
                    .font(.caption)
                    .foregroundStyle(.green)
            }
            ForEach(feed.items.prefix(rowLimit)) { item in
                row(item)
            }
            Spacer(minLength: 0)
        }
    }

    private func row(_ item: WidgetItem) -> some View {
        HStack(spacing: 8) {
            Image(systemName: item.status.symbol)
                .foregroundStyle(item.status.color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 0) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                if family != .systemSmall {
                    Text(item.statusText ?? item.status.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            if family == .systemLarge, let eta = item.eta {
                Spacer()
                Text(ParcelFormat.day(eta)).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func message(_ text: String, symbol: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.title2).foregroundStyle(Color.parcelAccent)
            Text(text).font(.footnote).multilineTextAlignment(.center).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
