import Foundation
import Testing
@testable import ParcelKit

private let packageJSON = """
{
  "package": {
    "id": "4397069c", "trackingNumber": "1Z14V4W16890664611", "label": "1st pack", "description": null,
    "carrierCode": "mock", "carrierName": "UPS", "provider": "mock", "status": "out_for_delivery", "statusText": "Out for delivery",
    "eta": "2026-11-14T10:05:47.431Z", "origin": "Corbeil, FR", "destination": "Meyzieu, FR",
    "deliveredAt": null, "archived": false, "lastCheckedAt": "2026-11-13T10:05:47.431Z", "lastError": null,
    "createdAt": "2026-11-13T10:05:47.430Z", "updatedAt": "2026-11-13T10:05:47Z",
    "lastEvent": {"time": "2026-11-13T08:05:47.431Z", "description": "Out for delivery", "location": "Meyzieu, FR", "status": "out_for_delivery"},
    "position": {"lat": 45.7764637, "lon": 5.0044767, "place": "Meyzieu, France"},
    "events": [
      {"time": "2026-11-13T08:05:47.431Z", "description": "Out for delivery", "location": "Meyzieu, FR", "status": "out_for_delivery"},
      {"time": "2026-11-12T08:05:47.431Z", "description": "Departed", "location": null, "status": null}
    ]
  }
}
"""

/// URLProtocol that answers every request with a canned response and records the last request.
final class StubProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var request = self.request
        if request.httpBody == nil, let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            request.httpBody = data
        }
        Self.lastRequest = request
        let (status, data) = Self.handler?(request) ?? (500, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private func stubbedClient() -> APIClient {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [StubProtocol.self]
    return APIClient(baseURL: URL(string: "http://127.0.0.1:8787")!, token: "secret",
                     session: URLSession(configuration: configuration))
}

@Suite(.serialized)
struct ParcelKitTests {
    @Test func decodesPackageWithFractionalAndPlainDates() throws {
        struct Wrapper: Decodable { let package: ParcelPackage }
        let wrapper = try JSONDecoder.parcel.decode(Wrapper.self, from: Data(packageJSON.utf8))
        let package = wrapper.package
        #expect(package.status == .outForDelivery)
        #expect(package.title == "1st pack")
        #expect(package.events?.count == 2)
        #expect(package.events?[1].location == nil)
        #expect(package.eta != nil)
        #expect(package.isDemo)
        #expect(package.position?.place == "Meyzieu, France")
        #expect(package.position?.lat == 45.7764637)
        #expect(package.updatedAt.timeIntervalSince1970 == 1_794_564_347) // no fractional seconds
    }

    @Test func unknownStatusFallsBackToUnknown() throws {
        let status = try JSONDecoder().decode(PackageStatus.self, from: Data("\"teleported\"".utf8))
        #expect(status == .unknown)
        #expect(PackageStatus.delivered.isActive == false)
        #expect(PackageStatus.inTransit.isActive)
    }

    @Test func titleFallsBackToTrackingNumber() {
        let package = ParcelPackage(id: "1", trackingNumber: "ABC123", label: "", status: .pending)
        #expect(package.title == "ABC123")
    }

    @Test func everyStatusHasATranslation() {
        for status in PackageStatus.allCases {
            #expect(status.title != "status.\(status.rawValue)", "missing translation for \(status.rawValue)")
        }
    }

    @Test func serverConfigNormalizesAddress() {
        #expect(ServerConfig(url: "192.168.1.5:8787", token: "t").baseURL?.absoluteString == "http://192.168.1.5:8787")
        #expect(ServerConfig(url: "https://parcel.example.com", token: "t").isValid)
        #expect(!ServerConfig(url: "", token: "t").isValid)
        #expect(!ServerConfig(url: "http://x.test", token: "  ").isValid)
    }

    @Test func addSendsBearerTokenAndBody() async throws {
        StubProtocol.handler = { _ in (201, Data(packageJSON.utf8)) }
        let created = try await stubbedClient().add(NewPackage(trackingNumber: "1Z14", label: "1st pack"))
        let request = try #require(StubProtocol.lastRequest)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/packages")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret")
        let body = try #require(request.httpBody)
        let json = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(json["trackingNumber"] as? String == "1Z14")
        #expect(json["label"] as? String == "1st pack")
        #expect(created.id == "4397069c")
    }

    @Test func serverErrorsCarryTheBackendMessage() async {
        StubProtocol.handler = { _ in (409, Data(#"{"error":{"code":"request_failed","message":"This tracking number is already tracked"}}"#.utf8)) }
        do {
            _ = try await stubbedClient().add(NewPackage(trackingNumber: "1Z14"))
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error == .server(status: 409, message: "This tracking number is already tracked"))
        } catch {
            Issue.record("unexpected error \(error)")
        }
    }

    @Test func deleteAcceptsEmptyBody() async throws {
        StubProtocol.handler = { _ in (204, Data()) }
        try await stubbedClient().delete(id: "abc")
        #expect(StubProtocol.lastRequest?.httpMethod == "DELETE")
        #expect(StubProtocol.lastRequest?.url?.path == "/v1/packages/abc")
    }

    @Test func detectCarrierReturnsTheName() async throws {
        StubProtocol.handler = { _ in (200, Data(#"{"carrier":{"code":"ups","name":"UPS"}}"#.utf8)) }
        let name = try await stubbedClient().detectCarrier(number: "1Z14V4W16890664609")
        #expect(name == "UPS")
        #expect(StubProtocol.lastRequest?.url?.query == "number=1Z14V4W16890664609")

        StubProtocol.handler = { _ in (200, Data(#"{"carrier":null}"#.utf8)) }
        #expect(try await stubbedClient().detectCarrier(number: "ZZZ") == nil)
    }

    @Test func widgetFeedDecodes() async throws {
        let json = #"{"generatedAt":"2026-11-13T10:05:47.448Z","activeCount":1,"outForDeliveryCount":1,"items":[{"id":"a","title":"1st pack","trackingNumber":"X","carrierName":null,"status":"out_for_delivery","statusText":"Out","eta":null}]}"#
        StubProtocol.handler = { _ in (200, Data(json.utf8)) }
        let feed = try await stubbedClient().widget(limit: 3)
        #expect(StubProtocol.lastRequest?.url?.query == "limit=3")
        #expect(feed.items.first?.status == .outForDelivery)
    }
}
