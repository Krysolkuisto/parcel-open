import ParcelKit
import SwiftUI

struct PackageRow: View {
    let package: ParcelPackage
    var isSelected = false

    private var primary: Color { isSelected ? .white : .primary }
    private var secondary: Color { isSelected ? .white.opacity(0.85) : .secondary }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: package.status.symbol)
                .font(.title2)
                .foregroundStyle(isSelected ? Color.white : package.status.color)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(package.title)
                    .font(.headline)
                    .foregroundStyle(primary)
                    .lineLimit(1)
                Text(package.statusText ?? package.status.title)
                    .font(.subheadline)
                    .foregroundStyle(secondary)
                    .lineLimit(1)
                if package.status.isActive, let eta = package.eta {
                    Text(tr("list.delivery", ParcelFormat.day(eta)))
                        .font(.subheadline)
                        .foregroundStyle(secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(isSelected ? Color.parcelAccent : Color.clear)
        )
        .contentShape(Rectangle())
    }
}
