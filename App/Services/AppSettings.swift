import Foundation
import Observation
import PontoCore

/// Preferências do usuário, guardadas em `UserDefaults` (não contêm dados dos tickets).
@Observable
final class AppSettings {
    private let defaults: UserDefaults

    var lockEnabled: Bool {
        didSet { defaults.set(lockEnabled, forKey: Keys.lockEnabled) }
    }

    var schedule: WorkSchedule {
        didSet { defaults.set(try? JSONEncoder().encode(schedule), forKey: Keys.schedule) }
    }

    var lastBackupDate: Date? {
        didSet { defaults.set(lastBackupDate, forKey: Keys.lastBackupDate) }
    }

    /// Dias sem backup antes de exibir um lembrete na tela inicial.
    var backupReminderDays: Int {
        didSet { defaults.set(backupReminderDays, forKey: Keys.backupReminderDays) }
    }

    var hasCompletedOnboarding: Bool {
        didSet { defaults.set(hasCompletedOnboarding, forKey: Keys.onboarding) }
    }

    /// Ativa o módulo opcional de análise de jornada.
    var analysisEnabled: Bool {
        didSet { defaults.set(analysisEnabled, forKey: Keys.analysisEnabled) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        lockEnabled = defaults.bool(forKey: Keys.lockEnabled)
        schedule = defaults.data(forKey: Keys.schedule).flatMap { try? JSONDecoder().decode(WorkSchedule.self, from: $0) } ?? .standard
        lastBackupDate = defaults.object(forKey: Keys.lastBackupDate) as? Date
        backupReminderDays = defaults.object(forKey: Keys.backupReminderDays) as? Int ?? 7
        hasCompletedOnboarding = defaults.bool(forKey: Keys.onboarding)
        analysisEnabled = defaults.object(forKey: Keys.analysisEnabled) as? Bool ?? true
    }

    /// Verdadeiro quando existem tickets e o último backup é antigo (ou nunca foi feito).
    func backupIsOverdue(now: Date = Date()) -> Bool {
        guard let lastBackupDate else { return true }
        return now.timeIntervalSince(lastBackupDate) > Double(backupReminderDays) * 86_400
    }

    /// Configurações incluídas no backup.
    var exportable: [String: String] {
        var result: [String: String] = [:]
        if let data = try? JSONEncoder().encode(schedule) { result["schedule"] = String(decoding: data, as: UTF8.self) }
        result["analysisEnabled"] = analysisEnabled ? "1" : "0"
        return result
    }

    func importSettings(_ values: [String: String]) {
        if let json = values["schedule"], let schedule = try? JSONDecoder().decode(WorkSchedule.self, from: Data(json.utf8)) {
            self.schedule = schedule
        }
        if let analysis = values["analysisEnabled"] { analysisEnabled = analysis == "1" }
    }

    private enum Keys {
        static let lockEnabled = "lockEnabled"
        static let schedule = "workSchedule"
        static let lastBackupDate = "lastBackupDate"
        static let backupReminderDays = "backupReminderDays"
        static let onboarding = "hasCompletedOnboarding"
        static let analysisEnabled = "analysisEnabled"
    }
}

/// Navegação compartilhada entre as abas (ex.: busca iniciada na tela inicial).
@Observable
final class AppNavigation {
    enum Tab: Hashable {
        case home, archive, calendar, analysis, settings
    }

    var selectedTab: Tab = .home
    var archiveFilter = TicketFilter()
    var archivePath: [UUID] = []

    func search(_ text: String) {
        var filter = TicketFilter()
        filter.text = text
        archiveFilter = filter
        archivePath = []
        selectedTab = .archive
    }

    func showArchive(with filter: TicketFilter) {
        archiveFilter = filter
        archivePath = []
        selectedTab = .archive
    }
}
