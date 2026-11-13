import Foundation

enum L10n {
    /// Resources bundle. A packaged `.app` carries it in Contents/Resources; `swift run` and Xcode use `Bundle.module`.
    static let bundle: Bundle = {
        if let url = Bundle.main.resourceURL?.appendingPathComponent("ParcelOpen_ParcelKit.bundle"),
           let bundle = Bundle(url: url) {
            return bundle
        }
        return Bundle.module
    }()
}

/// Localized string for `key` (see `Resources/*.lproj/Localizable.strings`), optionally formatted.
public func tr(_ key: String, _ arguments: CVarArg...) -> String {
    let format = NSLocalizedString(key, bundle: L10n.bundle, comment: "")
    return arguments.isEmpty ? format : String(format: format, locale: .current, arguments: arguments)
}
