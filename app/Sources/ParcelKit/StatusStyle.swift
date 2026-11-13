import SwiftUI

extension Color {
    /// The copper accent used across the app and widget.
    public static let parcelAccent = Color(red: 0.71, green: 0.41, blue: 0.29)
}

extension PackageStatus {
    public var title: String { tr("status.\(rawValue)") }

    /// SF Symbol shown in the list and the widget.
    public var symbol: String {
        switch self {
        case .unknown: return "questionmark"
        case .pending: return "doc.text"
        case .inTransit: return "box.truck.fill"
        case .outForDelivery: return "box.truck.badge.clock.fill"
        case .availableForPickup: return "building.2.fill"
        case .failedAttempt: return "exclamationmark.arrow.triangle.2.circlepath"
        case .exception: return "exclamationmark.triangle.fill"
        case .delivered: return "checkmark.circle.fill"
        case .expired: return "clock.badge.xmark.fill"
        }
    }

    public var color: Color {
        switch self {
        case .unknown: return .blue
        case .pending: return .gray
        case .inTransit: return .parcelAccent
        case .outForDelivery: return .green
        case .availableForPickup: return .purple
        case .failedAttempt, .exception: return .yellow
        case .delivered: return .green
        case .expired: return .gray
        }
    }
}

public enum ParcelFormat {
    /// "Today, 1:55 PM" / "Aujourd'hui, 13:55" — relative day plus time.
    public static func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.doesRelativeDateFormatting = true
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// "Today", "Tomorrow", or a short date.
    public static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.doesRelativeDateFormatting = true
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}
