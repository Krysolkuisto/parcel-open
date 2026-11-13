import Foundation

/// Parses a pasted list: one package per line, the tracking number first, then an optional name.
/// Separators between the number and the name can be spaces, tabs, commas or semicolons.
public enum BulkEntry {
    public static func parse(_ text: String) -> [NewPackage] {
        var seen = Set<String>()
        var entries: [NewPackage] = []
        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            let separators = CharacterSet.whitespaces.union(CharacterSet(charactersIn: ",;"))
            guard let range = trimmed.rangeOfCharacter(from: separators) else {
                append(trimmed, label: nil, to: &entries, seen: &seen)
                continue
            }
            let number = String(trimmed[..<range.lowerBound])
            let label = trimmed[range.upperBound...]
                .trimmingCharacters(in: separators)
            append(number, label: label.isEmpty ? nil : label, to: &entries, seen: &seen)
        }
        return entries
    }

    private static func append(_ number: String, label: String?, to entries: inout [NewPackage], seen: inout Set<String>) {
        let key = number.uppercased()
        guard !key.isEmpty, seen.insert(key).inserted else { return }
        entries.append(NewPackage(trackingNumber: number, label: label))
    }
}
