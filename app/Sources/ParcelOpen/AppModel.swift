import Foundation
import Observation
import ParcelKit
#if canImport(WidgetKit)
import WidgetKit
#endif

@MainActor
@Observable
final class AppModel {
    var config: ServerConfig? = ConfigStore.load()
    var packages: [ParcelPackage] = []
    /// Full details (with events) of packages the user opened.
    var details: [String: ParcelPackage] = [:]
    var selection: String?
    var isRefreshing = false
    var errorMessage: String?
    var showAdd = false
    var showSettings = false
    var searchText = ""

    private var client: APIClient? { config?.client }

    var needsSetup: Bool { config == nil }

    var visiblePackages: [ParcelPackage] {
        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return packages }
        return packages.filter {
            $0.title.localizedCaseInsensitiveContains(query)
                || $0.trackingNumber.localizedCaseInsensitiveContains(query)
                || ($0.carrierName ?? "").localizedCaseInsensitiveContains(query)
        }
    }

    var activePackages: [ParcelPackage] { visiblePackages.filter { $0.status.isActive } }
    var deliveredPackages: [ParcelPackage] { visiblePackages.filter { !$0.status.isActive } }

    func package(id: String?) -> ParcelPackage? {
        guard let id else { return nil }
        return details[id] ?? packages.first { $0.id == id }
    }

    // MARK: Settings

    func saveConfig(_ newConfig: ServerConfig) {
        ConfigStore.save(newConfig)
        config = newConfig
        Task { await refresh(remote: false) }
    }

    // MARK: Loading

    /// Reloads the list. With `remote`, the backend first re-queries the carriers.
    func refresh(remote: Bool = true) async {
        guard let client else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            if remote { try await client.refreshAll() }
            packages = try await client.packages()
            if let selection, packages.contains(where: { $0.id == selection }) {
                await loadDetail(id: selection)
            } else if selection == nil {
                selection = packages.first?.id
            }
            await publishWidgetFeed(client)
        } catch {
            report(error)
        }
    }

    func loadDetail(id: String) async {
        guard let client else { return }
        do { details[id] = try await client.package(id: id) } catch { report(error) }
    }

    // MARK: Changes

    /// Returns an error message on failure so the form can stay open.
    func add(trackingNumber: String, label: String) async -> String? {
        guard let client else { return APIError.notConfigured.errorDescription }
        do {
            let created = try await client.add(NewPackage(trackingNumber: trackingNumber, label: label.isEmpty ? nil : label))
            packages = try await client.packages()
            selection = created.id
            await loadDetail(id: created.id)
            await publishWidgetFeed(client)
            return nil
        } catch {
            return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    func rename(_ package: ParcelPackage, to label: String) async {
        await mutate { client in
            _ = try await client.update(id: package.id, PackagePatch(label: label))
        }
    }

    func setArchived(_ package: ParcelPackage, _ archived: Bool) async {
        await mutate { client in
            _ = try await client.update(id: package.id, PackagePatch(archived: archived))
        }
    }

    func delete(_ package: ParcelPackage) async {
        await mutate { client in try await client.delete(id: package.id) }
        details[package.id] = nil
    }

    func refreshOne(_ package: ParcelPackage) async {
        guard let client else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            details[package.id] = try await client.refresh(id: package.id)
            packages = try await client.packages()
            await publishWidgetFeed(client)
        } catch {
            report(error)
        }
    }

    private func mutate(_ operation: (APIClient) async throws -> Void) async {
        guard let client else { return }
        do {
            try await operation(client)
            packages = try await client.packages()
            if let selection {
                if packages.contains(where: { $0.id == selection }) {
                    await loadDetail(id: selection)
                } else {
                    self.selection = packages.first?.id
                }
            }
            await publishWidgetFeed(client)
        } catch {
            report(error)
        }
    }

    // MARK: Widget

    private func publishWidgetFeed(_ client: APIClient) async {
        guard let feed = try? await client.widget(limit: 6) else { return }
        FeedCache.save(feed)
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    private func report(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
