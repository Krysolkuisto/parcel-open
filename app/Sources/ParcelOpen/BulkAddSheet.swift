import ParcelKit
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Paste a list of tracking numbers (one per line, optional name after the number) and add them all.
struct BulkAddSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var progress: (done: Int, total: Int)?
    @State private var result: AppModel.BulkResult?

    private var entries: [NewPackage] { BulkEntry.parse(text) }
    private var isRunning: Bool { progress != nil && result == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Button { dismiss() } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
                    .keyboardShortcut(.cancelAction)
                    .accessibilityLabel(tr("action.cancel"))
                Spacer()
                Button(tr("action.paste"), systemImage: "doc.on.clipboard") { paste() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.borderless)
                    .disabled(isRunning)
            }
            .font(.title3)

            Text(tr("bulk.hint")).font(.callout).foregroundStyle(.secondary)

            TextEditor(text: $text)
                .font(.system(.body, design: .monospaced))
                .frame(minHeight: 200)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.secondary.opacity(0.12)))
                .disabled(isRunning || result != nil)

            if let progress, result == nil {
                ProgressView(value: Double(progress.done), total: Double(max(progress.total, 1)))
                Text(tr("bulk.progress", progress.done, progress.total)).font(.footnote).foregroundStyle(.secondary)
            }

            if let result {
                Label(tr("bulk.done", result.added), systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                if !result.failures.isEmpty {
                    Text(tr("bulk.failed", result.failures.count)).font(.callout.weight(.semibold))
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(result.failures.enumerated()), id: \.offset) { _, failure in
                                Text("\(failure.number): \(failure.reason)").font(.footnote).foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 120)
                }
            }

            HStack {
                Spacer()
                if result != nil {
                    Button(tr("bulk.close")) { dismiss() }
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut(.defaultAction)
                } else {
                    Button(tr("bulk.add", entries.count)) { Task { await run() } }
                        .buttonStyle(.borderedProminent)
                        .disabled(entries.isEmpty || isRunning)
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(16)
        #if os(macOS)
        .frame(width: 520)
        #endif
    }

    private func run() async {
        let batch = entries
        progress = (0, batch.count)
        result = await model.addMany(batch) { done, total in progress = (done, total) }
    }

    private func paste() {
        #if os(macOS)
        let pasted = NSPasteboard.general.string(forType: .string)
        #else
        let pasted = UIPasteboard.general.string
        #endif
        if let pasted { text = text.isEmpty ? pasted : text + "\n" + pasted }
    }
}
