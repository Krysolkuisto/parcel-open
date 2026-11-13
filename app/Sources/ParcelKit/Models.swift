import Foundation

/// Normalized shipment status, identical to the backend's `PackageStatus`.
public enum PackageStatus: String, Codable, CaseIterable, Sendable {
    case unknown
    case pending
    case inTransit = "in_transit"
    case outForDelivery = "out_for_delivery"
    case availableForPickup = "available_for_pickup"
    case failedAttempt = "failed_attempt"
    case exception
    case delivered
    case expired

    /// Unknown values sent by a newer backend decode as `.unknown` instead of failing the whole list.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = PackageStatus(rawValue: raw) ?? .unknown
    }

    /// Still in progress (not delivered or expired).
    public var isActive: Bool { self != .delivered && self != .expired }
}

public struct TrackingEvent: Codable, Hashable, Identifiable, Sendable {
    public let time: Date
    public let description: String
    public let location: String?
    public let status: PackageStatus?

    public var id: String { "\(time.timeIntervalSince1970)|\(description)" }

    public init(time: Date, description: String, location: String? = nil, status: PackageStatus? = nil) {
        self.time = time
        self.description = description
        self.location = location
        self.status = status
    }
}

/// Where a package last was, geocoded by the backend.
public struct PackagePosition: Codable, Hashable, Sendable {
    public let lat: Double
    public let lon: Double
    public let place: String

    public init(lat: Double, lon: Double, place: String) {
        self.lat = lat
        self.lon = lon
        self.place = place
    }
}

public struct ParcelPackage: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let trackingNumber: String
    public var label: String?
    public var description: String?
    public let carrierCode: String?
    public let carrierName: String?
    /// Tracking provider behind the data. "mock" is fake demo data (no API key configured on the server).
    public let provider: String?
    /// Public page where the parcel can be followed by hand (carrier website, or 17TRACK).
    public let trackingUrl: String?
    public let status: PackageStatus
    public let statusText: String?
    public let eta: Date?
    public let origin: String?
    public let destination: String?
    public let deliveredAt: Date?
    public var archived: Bool
    public let lastCheckedAt: Date?
    public let lastError: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let lastEvent: TrackingEvent?
    /// Only present when fetching a single package.
    public let events: [TrackingEvent]?
    /// Only present when fetching a single package, and only if the place could be located.
    public let position: PackagePosition?

    /// True when the server has no real tracking provider: everything shown is made up.
    public var isDemo: Bool { provider == "mock" }

    /// True when no configured provider can follow this parcel automatically.
    public var isManual: Bool { provider == "manual" }

    public var trackingLink: URL? { trackingUrl.flatMap(URL.init(string:)) }

    /// Name shown in lists: the user's description, or the tracking number.
    public var title: String { (label?.isEmpty == false ? label : nil) ?? trackingNumber }

    public init(
        id: String, trackingNumber: String, label: String? = nil, description: String? = nil,
        carrierCode: String? = nil, carrierName: String? = nil, provider: String? = nil, trackingUrl: String? = nil, status: PackageStatus,
        statusText: String? = nil, eta: Date? = nil, origin: String? = nil, destination: String? = nil,
        deliveredAt: Date? = nil, archived: Bool = false, lastCheckedAt: Date? = nil, lastError: String? = nil,
        createdAt: Date = Date(), updatedAt: Date = Date(), lastEvent: TrackingEvent? = nil,
        events: [TrackingEvent]? = nil, position: PackagePosition? = nil
    ) {
        self.id = id; self.trackingNumber = trackingNumber; self.label = label; self.description = description
        self.carrierCode = carrierCode; self.carrierName = carrierName; self.provider = provider; self.trackingUrl = trackingUrl; self.status = status
        self.statusText = statusText; self.eta = eta; self.origin = origin; self.destination = destination
        self.deliveredAt = deliveredAt; self.archived = archived; self.lastCheckedAt = lastCheckedAt
        self.lastError = lastError; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.lastEvent = lastEvent; self.events = events; self.position = position
    }
}

public struct WidgetItem: Codable, Hashable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let trackingNumber: String
    public let carrierName: String?
    public let status: PackageStatus
    public let statusText: String?
    public let eta: Date?

    public init(id: String, title: String, trackingNumber: String, carrierName: String? = nil,
                status: PackageStatus, statusText: String? = nil, eta: Date? = nil) {
        self.id = id; self.title = title; self.trackingNumber = trackingNumber
        self.carrierName = carrierName; self.status = status; self.statusText = statusText; self.eta = eta
    }
}

/// Response of `GET /v1/widget`.
public struct WidgetFeed: Codable, Hashable, Sendable {
    public let generatedAt: Date
    public let activeCount: Int
    public let outForDeliveryCount: Int
    public let items: [WidgetItem]

    public init(generatedAt: Date, activeCount: Int, outForDeliveryCount: Int, items: [WidgetItem]) {
        self.generatedAt = generatedAt
        self.activeCount = activeCount
        self.outForDeliveryCount = outForDeliveryCount
        self.items = items
    }
}

// MARK: - JSON coding

extension JSONDecoder {
    /// Decoder for the backend: ISO-8601 dates with or without fractional seconds.
    public static var parcel: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return date }
            if let date = try? Date.ISO8601FormatStyle().parse(string) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Invalid ISO-8601 date: \(string)"))
        }
        return decoder
    }
}
