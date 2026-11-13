import Foundation

public enum APIError: LocalizedError, Equatable {
    case notConfigured
    case invalidResponse
    case server(status: Int, message: String)
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured: return tr("error.notConfigured")
        case .invalidResponse: return tr("error.invalidResponse")
        case .server(_, let message): return message
        case .transport(let message): return message
        }
    }

    public var isUnauthorized: Bool {
        if case .server(let status, _) = self { return status == 401 }
        return false
    }
}

public struct NewPackage: Encodable, Sendable {
    public var trackingNumber: String
    public var label: String?
    public var carrierCode: String?

    public init(trackingNumber: String, label: String? = nil, carrierCode: String? = nil) {
        self.trackingNumber = trackingNumber
        self.label = label
        self.carrierCode = carrierCode
    }
}

public struct PackagePatch: Encodable, Sendable {
    public var label: String?
    public var archived: Bool?

    public init(label: String? = nil, archived: Bool? = nil) {
        self.label = label
        self.archived = archived
    }
}

/// Talks to the Parcel Open backend (see `backend/` in this repository).
public struct APIClient: Sendable {
    public let baseURL: URL
    public let token: String
    private let session: URLSession

    public init(baseURL: URL, token: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    // MARK: Endpoints

    public func packages(includeArchived: Bool = false) async throws -> [ParcelPackage] {
        let items = includeArchived ? [URLQueryItem(name: "archived", value: "true")] : []
        let response: PackagesResponse = try await send("GET", "v1/packages", query: items)
        return response.packages
    }

    public func package(id: String) async throws -> ParcelPackage {
        let response: PackageResponse = try await send("GET", "v1/packages/\(id)")
        return response.package
    }

    public func add(_ package: NewPackage) async throws -> ParcelPackage {
        let response: PackageResponse = try await send("POST", "v1/packages", body: package)
        return response.package
    }

    public func update(id: String, _ patch: PackagePatch) async throws -> ParcelPackage {
        let response: PackageResponse = try await send("PATCH", "v1/packages/\(id)", body: patch)
        return response.package
    }

    public func delete(id: String) async throws {
        let _: Empty = try await send("DELETE", "v1/packages/\(id)")
    }

    public func refresh(id: String) async throws -> ParcelPackage {
        let response: PackageResponse = try await send("POST", "v1/packages/\(id)/refresh")
        return response.package
    }

    /// Asks the backend to re-query every active package at its provider.
    public func refreshAll() async throws {
        let _: Empty = try await send("POST", "v1/refresh")
    }

    /// Carrier guessed from the shape of a tracking number (e.g. "UPS"), or nil when unsure.
    public func detectCarrier(number: String) async throws -> String? {
        let response: CarrierResponse = try await send(
            "GET", "v1/carriers/detect", query: [URLQueryItem(name: "number", value: number)])
        return response.carrier?.name
    }

    public func widget(limit: Int = 5) async throws -> WidgetFeed {
        try await send("GET", "v1/widget", query: [URLQueryItem(name: "limit", value: String(limit))])
    }

    // MARK: Transport

    private struct PackagesResponse: Decodable { let packages: [ParcelPackage] }
    private struct PackageResponse: Decodable { let package: ParcelPackage }
    private struct CarrierResponse: Decodable {
        struct Carrier: Decodable { let name: String }
        let carrier: Carrier?
    }
    private struct ErrorResponse: Decodable {
        struct Detail: Decodable { let message: String }
        let error: Detail
    }
    /// Accepts any JSON object or an empty body (204).
    private struct Empty: Decodable {
        init() {}
        init(from decoder: Decoder) throws {}
    }

    private func send<T: Decodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil
    ) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url, timeoutInterval: 30)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }

        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error.message
            throw APIError.server(status: http.statusCode, message: message ?? "HTTP \(http.statusCode)")
        }
        if data.isEmpty, T.self == Empty.self { return Empty() as! T }
        do {
            return try JSONDecoder.parcel.decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
