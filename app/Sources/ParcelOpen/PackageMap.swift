import MapKit
import ParcelKit
import SwiftUI

/// Shows the most recent known place of a package. Coordinates come from the backend, which geocodes
/// the place names found in tracking events (the system geocoder proved unreliable for carrier facility names).
struct PackageMap: View {
    let position: PackagePosition?

    @State private var camera = MapCameraPosition.automatic

    var body: some View {
        if let position {
            let coordinate = CLLocationCoordinate2D(latitude: position.lat, longitude: position.lon)
            Map(position: $camera) {
                Marker(position.place, systemImage: "shippingbox.fill", coordinate: coordinate)
                    .tint(Color.parcelAccent)
            }
            .frame(height: 240)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .onAppear { center(on: coordinate) }
            .onChange(of: position) { _, new in
                center(on: CLLocationCoordinate2D(latitude: new.lat, longitude: new.lon))
            }
        }
    }

    private func center(on coordinate: CLLocationCoordinate2D) {
        camera = .region(MKCoordinateRegion(
            center: coordinate, span: MKCoordinateSpan(latitudeDelta: 3, longitudeDelta: 3)))
    }
}
