import CoreLocation
import MapKit
import ParcelKit
import SwiftUI

/// Shows the most recent known place of a package. The backend gives place names, so they are geocoded on device.
struct PackageMap: View {
    let place: String?

    @State private var position = MapCameraPosition.automatic
    @State private var coordinate: CLLocationCoordinate2D?

    var body: some View {
        Group {
            if let coordinate, let place {
                Map(position: $position) {
                    Marker(place, coordinate: coordinate).tint(Color.parcelAccent)
                }
                .frame(height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
        }
        .task(id: place) {
            coordinate = nil
            guard let place, let found = await Geocoder.shared.coordinate(for: place) else { return }
            coordinate = found
            position = .region(MKCoordinateRegion(
                center: found, span: MKCoordinateSpan(latitudeDelta: 4, longitudeDelta: 4)))
        }
    }
}

/// Small cache so reopening a package does not hit the geocoder again.
private actor Geocoder {
    static let shared = Geocoder()
    private var cache: [String: CLLocationCoordinate2D] = [:]

    func coordinate(for place: String) async -> CLLocationCoordinate2D? {
        if let cached = cache[place] { return cached }
        let placemarks = try? await CLGeocoder().geocodeAddressString(place)
        guard let location = placemarks?.first?.location else { return nil }
        cache[place] = location.coordinate
        return location.coordinate
    }
}
