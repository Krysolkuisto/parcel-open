import ParcelKit
import SwiftUI

struct PackageRow: View {
    let package: ParcelPackage

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: package.status.symbol)
                .font(.title2)
                .foregroundStyle(package.status.color)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(package.title)
                    .font(.headline)
                    .lineLimit(1)
                Text(package.statusText ?? package.status.title)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if package.status.isActive, let eta = package.eta {
                    Text(tr("list.delivery", ParcelFormat.day(eta)))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
