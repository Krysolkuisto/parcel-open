import ParcelKit
import SwiftUI

/// Server address and API token. Shown at first launch, from the Settings window (macOS) and from the toolbar (iOS).
struct ServerSettingsView: View {
    @Environment(AppModel.self) private var model

    /// Called after saving or cancelling when shown as a sheet.
    let onClose: (() -> Void)?

    @State private var url = ""
    @State private var token = ""
    @State private var testResult: TestResult?
    @State private var isTesting = false

    private enum TestResult {
        case success
        case failure(String)
    }

    private var draft: ServerConfig { ServerConfig(url: url, token: token) }

    var body: some View {
        Form {
            Section {
                TextField(tr("settings.url"), text: $url, prompt: Text("http://127.0.0.1:8787"))
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                SecureField(tr("settings.token"), text: $token)
                    .autocorrectionDisabled()
            } footer: {
                Text(tr("settings.hint"))
            }

            Section {
                Button(tr("settings.test")) { Task { await test() } }
                    .disabled(!draft.isValid || isTesting)
                switch testResult {
                case .success:
                    Label(tr("settings.connected"), systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                case .failure(let message):
                    Label(message, systemImage: "xmark.octagon.fill").foregroundStyle(.red)
                case nil:
                    EmptyView()
                }
            }

            Section {
                HStack {
                    if let onClose {
                        Button(tr("action.cancel"), role: .cancel) { onClose() }
                    }
                    Spacer()
                    Button(tr("action.save")) {
                        model.saveConfig(draft)
                        onClose?()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!draft.isValid)
                    .keyboardShortcut(.defaultAction)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(tr("settings.title"))
        .onAppear {
            url = model.config?.url ?? "http://127.0.0.1:8787"
            token = model.config?.token ?? ""
        }
        #if os(macOS)
        .frame(minWidth: 440)
        #endif
    }

    private func test() async {
        guard let client = draft.client else {
            testResult = .failure(tr("settings.invalid"))
            return
        }
        isTesting = true
        defer { isTesting = false }
        do {
            _ = try await client.widget(limit: 1)
            testResult = .success
        } catch {
            testResult = .failure((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
