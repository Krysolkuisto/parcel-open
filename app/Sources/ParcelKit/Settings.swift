import Foundation

/// Where settings live. The app and its widget share one store through an App Group
/// (compile with the `APP_GROUP` flag, as the Xcode project does). Without it, e.g. `swift run`
/// on a Mac, plain per-app defaults are used and there is no widget anyway.
public enum SharedStore {
    public static let appGroup = "group.com.krysolkuisto.parcelopen"

    public static var defaults: UserDefaults {
        #if APP_GROUP
        return UserDefaults(suiteName: appGroup) ?? .standard
        #else
        return .standard
        #endif
    }
}

/// Server address and API token entered by the user.
///
/// The token is kept in the shared defaults (inside the app's sandbox / App Group container) rather than
/// the Keychain so the widget can fetch data on its own.
public struct ServerConfig: Codable, Equatable, Sendable {
    public var url: String
    public var token: String

    public init(url: String, token: String) {
        self.url = url
        self.token = token
    }

    public var baseURL: URL? {
        var text = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "http://" + text }
        guard let url = URL(string: text), url.host != nil else { return nil }
        return url
    }

    public var isValid: Bool {
        baseURL != nil && !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var client: APIClient? {
        guard isValid, let baseURL else { return nil }
        return APIClient(baseURL: baseURL, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

public enum ConfigStore {
    private static let key = "serverConfig"

    public static func load() -> ServerConfig? {
        guard let data = SharedStore.defaults.data(forKey: key),
              let config = try? JSONDecoder().decode(ServerConfig.self, from: data),
              config.isValid else { return nil }
        return config
    }

    public static func save(_ config: ServerConfig) {
        if let data = try? JSONEncoder().encode(config) {
            SharedStore.defaults.set(data, forKey: key)
        }
    }

    public static func clear() {
        SharedStore.defaults.removeObject(forKey: key)
    }
}

/// Last widget feed, so the widget can show something when the server is unreachable.
public enum FeedCache {
    private static let key = "widgetFeed"

    public static func load() -> WidgetFeed? {
        guard let data = SharedStore.defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder.parcel.decode(WidgetFeed.self, from: data)
    }

    public static func save(_ feed: WidgetFeed) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(feed) {
            SharedStore.defaults.set(data, forKey: key)
        }
    }
}
