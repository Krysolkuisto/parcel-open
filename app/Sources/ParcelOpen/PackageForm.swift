import ParcelKit
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// "Add package" and "Edit package" sheet: Reference, Carrier, Description.
struct PackageForm: View {
    enum Mode {
        case add
        case edit(ParcelPackage)
    }

    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let mode: Mode

    @State private var reference = ""
    @State private var description = ""
    @State private var errorMessage: String?
    @State private var isBusy = false
    @FocusState private var focus: Field?

    private enum Field { case reference, description }

    private var editing: ParcelPackage? {
        if case .edit(let package) = mode { return package }
        return nil
    }

    private var canSubmit: Bool {
        !isBusy && (editing != nil || !reference.trimmingCharacters(in: .whitespaces).isEmpty)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            row(tr("form.reference")) {
                if let editing {
                    Text(editing.trackingNumber)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(.secondary)
                } else {
                    TextField("", text: $reference, prompt: Text(tr("form.required")))
                        .focused($focus, equals: .reference)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
                        .onSubmit { focus = .description }
                    Button(tr("action.paste"), systemImage: "doc.on.clipboard") { pasteReference() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                }
            }
            Divider()
            row(tr("form.carrier")) {
                Text(tr("form.carrierAuto")).foregroundStyle(.secondary)
            }
            Divider()
            row(tr("form.description")) {
                TextField("", text: $description, prompt: Text(tr("form.optional")))
                    .focused($focus, equals: .description)
                    .onSubmit { Task { await submit() } }
            }
            if let errorMessage {
                Divider()
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .font(.footnote)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            #if os(iOS)
            Spacer(minLength: 0)
            #endif
        }
        #if os(macOS)
        .frame(width: 460)
        #else
        .presentationDetents([.medium])
        #endif
        .onAppear {
            if let editing { description = editing.label ?? "" }
            focus = editing == nil ? .reference : .description
        }
    }

    private var header: some View {
        HStack {
            Button { dismiss() } label: { Image(systemName: "xmark") }
                .buttonStyle(.borderless)
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel(tr("action.cancel"))
            Spacer()
            if isBusy { ProgressView().controlSize(.small) }
            Button { Task { await submit() } } label: { Image(systemName: "checkmark") }
                .buttonStyle(.borderless)
                .disabled(!canSubmit)
                .keyboardShortcut(.defaultAction)
                .accessibilityLabel(tr("action.save"))
        }
        .font(.title3)
        .padding(16)
    }

    private func row<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            Text(title).font(.headline).frame(width: 120, alignment: .leading)
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private func pasteReference() {
        #if os(macOS)
        let text = NSPasteboard.general.string(forType: .string)
        #else
        let text = UIPasteboard.general.string
        #endif
        if let text { reference = text.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    private func submit() async {
        guard canSubmit else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }

        let label = description.trimmingCharacters(in: .whitespaces)
        if let editing {
            await model.rename(editing, to: label)
            dismiss()
        } else if let failure = await model.add(trackingNumber: reference, label: label) {
            errorMessage = failure
        } else {
            dismiss()
        }
    }
}
