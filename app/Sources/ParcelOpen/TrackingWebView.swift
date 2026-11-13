import ParcelKit
import SwiftUI
import WebKit

/// The carrier's own tracking page, shown inside the app.
/// It is the user's regular browser engine, so the carrier's page loads exactly as it does in Safari;
/// nothing is scripted or imitated. The page cannot feed the list or the widget, it is only displayed.
struct TrackingWebView {
    let url: URL
    /// Bump to force a reload of the same URL.
    let reloadID: Int

    final class Coordinator {
        var loadedURL: URL?
        var loadedReloadID = -1
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // keeps the carrier's cookie choice between launches
        return WKWebView(frame: .zero, configuration: configuration)
    }

    private func update(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        guard coordinator.loadedURL != url || coordinator.loadedReloadID != reloadID else { return }
        coordinator.loadedURL = url
        coordinator.loadedReloadID = reloadID
        webView.load(URLRequest(url: url))
    }
}

#if os(macOS)
extension TrackingWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView() }
    func updateNSView(_ webView: WKWebView, context: Context) { update(webView, context: context) }
}
#else
extension TrackingWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView() }
    func updateUIView(_ webView: WKWebView, context: Context) { update(webView, context: context) }
}
#endif

/// Section of the detail view for packages no provider can follow automatically.
struct CarrierPageSection: View {
    let url: URL
    @State private var reloadID = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(tr("detail.carrierPage")).font(.headline)
                Spacer()
                Button { reloadID += 1 } label: {
                    Label(tr("detail.reload"), systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderless)
                Link(destination: url) {
                    Label(tr("detail.openTracking"), systemImage: "arrow.up.right.square")
                }
                .buttonStyle(.borderless)
            }
            .labelStyle(.iconOnly)

            TrackingWebView(url: url, reloadID: reloadID)
                .frame(height: 560)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.secondary.opacity(0.25)))
        }
    }
}
