import Foundation

/// Filtros e busca textual sobre o arquivo de tickets.
///
/// A busca textual procura em todos os campos, no texto integral do OCR, nas observações,
/// etiquetas e em representações alternativas da data e do horário ("22/10", "outubro",
/// "8h01"), para que o usuário encontre o ticket mesmo sem saber o nome do arquivo.
public struct TicketFilter: Hashable, Codable, Sendable {
    public var text: String = ""
    public var dateFrom: CalendarDate?
    public var dateTo: CalendarDate?
    public var month: YearMonth?
    public var company: String = ""
    public var employee: String = ""
    public var markTypes: Set<MarkType> = []
    /// Faixa de horário (minutos desde a meia-noite), inclusiva.
    public var timeFrom: Int?
    public var timeTo: Int?
    public var tags: Set<String> = []
    public var onlyIncomplete = false
    public var onlyFlagged = false
    public var onlyPendingReview = false

    public init() {}

    public var isEmpty: Bool { self == TicketFilter() }

    /// Quantidade de filtros ativos (sem contar o texto), para exibir no botão de filtros.
    public var activeFilterCount: Int {
        var count = 0
        if dateFrom != nil || dateTo != nil { count += 1 }
        if month != nil { count += 1 }
        if !company.isEmpty { count += 1 }
        if !employee.isEmpty { count += 1 }
        if !markTypes.isEmpty { count += 1 }
        if timeFrom != nil || timeTo != nil { count += 1 }
        if !tags.isEmpty { count += 1 }
        if onlyIncomplete { count += 1 }
        if onlyFlagged { count += 1 }
        if onlyPendingReview { count += 1 }
        return count
    }

    public func matches(_ record: TicketRecord) -> Bool {
        if dateFrom != nil || dateTo != nil || month != nil {
            guard let date = record.recordDate else { return false }
            if let dateFrom, date < dateFrom { return false }
            if let dateTo, date > dateTo { return false }
            if let month, !month.contains(date) { return false }
        }
        if timeFrom != nil || timeTo != nil {
            guard let minutes = record.recordTime?.minutesOfDay else { return false }
            if let timeFrom, minutes < timeFrom { return false }
            if let timeTo, minutes > timeTo { return false }
        }
        if !markTypes.isEmpty, !markTypes.contains(record.markType) { return false }
        if !company.isEmpty {
            let haystack = TextNormalizer.fold(record.company + " " + record.cnpj)
            if !haystack.contains(TextNormalizer.fold(company)) { return false }
        }
        if !employee.isEmpty {
            let haystack = TextNormalizer.fold(record.employeeName + " " + record.employeeID)
            if !haystack.contains(TextNormalizer.fold(employee)) { return false }
        }
        if !tags.isEmpty, tags.isDisjoint(with: record.tags) { return false }
        if onlyIncomplete, !record.isIncomplete { return false }
        if onlyFlagged, !record.isFlagged { return false }
        if onlyPendingReview, record.isConfirmed { return false }
        if !text.trimmingCharacters(in: .whitespaces).isEmpty {
            let haystack = Self.searchableText(for: record)
            for token in Self.queryTokens(text) where !haystack.contains(token) { return false }
        }
        return true
    }

    /// Aplica o filtro e ordena cronologicamente pela data/horário impressos.
    public func apply(to records: [TicketRecord]) -> [TicketRecord] {
        records.filter(matches).sorted(by: TicketRecord.chronological)
    }

    // MARK: - Busca textual

    /// Termos da consulta, já normalizados. Horários como "8:01" ou "8h01" viram "08:01".
    static func queryTokens(_ query: String) -> [String] {
        TextNormalizer.searchTokens(query).map { token in
            if let match = Regex.firstMatch(#"^([0-9]{1,2})[:H]([0-9]{2})$"#, in: token),
               let hour = Int(match[1] ?? ""), let minute = Int(match[2] ?? ""),
               let time = ClockTime(hour: hour, minute: minute) {
                return time.formatted
            }
            if let match = Regex.firstMatch(#"^([0-9]{1,2})[/.\-]([0-9]{1,2})(?:[/.\-]([0-9]{2,4}))?$"#, in: token),
               let day = Int(match[1] ?? ""), let month = Int(match[2] ?? "") {
                var normalized = String(format: "%02d/%02d", day, month)
                if let rawYear = match[3], var year = Int(rawYear) {
                    if rawYear.count == 2 { year += 2000 }
                    normalized += String(format: "/%04d", year)
                }
                return normalized
            }
            return token
        }
    }

    /// Texto pesquisável (normalizado) de um ticket.
    public static func searchableText(for record: TicketRecord) -> String {
        var parts: [String] = [
            record.ocrText, record.company, record.cnpj, DocumentValidators.compactCNPJ(record.cnpj),
            record.employeeName, record.employeeID, record.clockID, record.ticketNumber, record.authCode,
            record.notes, record.originalFileName, record.markType.label, record.tags.joined(separator: " ")
        ]
        parts += record.otherFields.flatMap { [$0.label, $0.value] }
        if let date = record.recordDate {
            parts += [
                date.brazilian, String(format: "%02d/%02d", date.day, date.month), date.key,
                PortugueseCalendar.monthNames[date.month - 1], String(date.year),
                PortugueseCalendar.weekdayNames[date.weekday - 1]
            ]
        }
        if let time = record.recordTime {
            parts += [String(format: "%02d:%02d", time.hour, time.minute), time.formatted,
                      String(format: "%dh%02d", time.hour, time.minute)]
        }
        return TextNormalizer.fold(parts.joined(separator: " "))
    }
}
