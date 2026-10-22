import Foundation
import Observation
import PontoCore

/// Estado editável de um ticket na tela de revisão/edição.
@Observable
final class TicketDraft: Identifiable {
    let id = UUID()
    /// Registro de partida (OCR para novos tickets; dados salvos para edição).
    let base: TicketRecord
    let warnings: [String]
    let fieldConfidences: [String: Double]
    var imageHash: UInt64?

    var hasDate: Bool
    var date: Date
    var hasTime: Bool
    var time: Date
    /// Horário original (para manter os segundos impressos se hora e minuto não mudarem).
    private let originalTime: ClockTime?

    var markType: MarkType
    var company: String
    var cnpj: String
    var employeeName: String
    var employeeID: String
    var clockID: String
    var ticketNumber: String
    var authCode: String
    var notes: String
    var tags: [String]
    var isFlagged: Bool

    /// Campos críticos que o usuário conferiu explicitamente (ou editou).
    var confirmedFields: Set<TicketField>

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    init(record: TicketRecord, warnings: [String] = []) {
        base = record
        self.warnings = warnings
        fieldConfidences = record.fieldConfidences
        imageHash = record.imageHash
        hasDate = record.recordDate != nil
        date = (record.recordDate ?? CalendarDate(date: Date())).date()
        hasTime = record.recordTime != nil
        time = CalendarDate(date: Date()).date(at: record.recordTime ?? ClockTime(hour: 8, minute: 0))
        originalTime = record.recordTime
        markType = record.markType
        company = record.company
        cnpj = record.cnpj
        employeeName = record.employeeName
        employeeID = record.employeeID
        clockID = record.clockID
        ticketNumber = record.ticketNumber
        authCode = record.authCode
        notes = record.notes
        tags = record.tags
        isFlagged = record.isFlagged
        // Ticket já confirmado: nada pendente. Novo ticket: só os campos de alta confiança contam como conferidos.
        if record.isConfirmed {
            confirmedFields = Set(TicketField.allCases.filter(\.isCritical))
        } else {
            confirmedFields = Set(TicketField.allCases.filter { field in
                field.isCritical && (record.fieldConfidences[field.rawValue] ?? 0) >= ParsedTicket.confirmationThreshold
                    && !(field == .markType && record.markType == .indefinido)
            })
        }
    }

    convenience init(parsed: ParsedTicket) {
        self.init(record: TicketRecord(parsed: parsed), warnings: parsed.warnings)
    }

    func confidence(of field: TicketField) -> Double? {
        fieldConfidences[field.rawValue]
    }

    /// O campo crítico ainda precisa ser conferido pelo usuário.
    func needsConfirmation(_ field: TicketField) -> Bool {
        field.isCritical && !confirmedFields.contains(field)
    }

    func confirm(_ field: TicketField) {
        confirmedFields.insert(field)
    }

    var recordDate: CalendarDate? { hasDate ? CalendarDate(date: date) : nil }

    var recordTime: ClockTime? {
        guard hasTime else { return nil }
        let components = Self.calendar.dateComponents([.hour, .minute], from: time)
        let hour = components.hour ?? 0, minute = components.minute ?? 0
        let second = (originalTime?.hour == hour && originalTime?.minute == minute) ? originalTime?.second : nil
        return ClockTime(hour: hour, minute: minute, second: second)
    }

    /// Pendências que impedem marcar a revisão como confirmada.
    var confirmationBlockers: [String] {
        var result: [String] = []
        if !hasDate { result.append("Informe a data do registro.") }
        if !hasTime { result.append("Informe o horário.") }
        if markType == .indefinido { result.append("Escolha o tipo de marcação.") }
        let pending = TicketField.allCases.filter(needsConfirmation)
        if !pending.isEmpty {
            result.append("Confira: " + pending.map(\.label).joined(separator: ", ") + ".")
        }
        return result
    }

    var canConfirm: Bool { confirmationBlockers.isEmpty }

    func makeRecord(confirmed: Bool) -> TicketRecord {
        var record = base
        record.recordDate = recordDate
        record.recordTime = recordTime
        record.markType = markType
        record.company = company.trimmingCharacters(in: .whitespacesAndNewlines)
        record.cnpj = cnpj.trimmingCharacters(in: .whitespacesAndNewlines)
        record.employeeName = employeeName.trimmingCharacters(in: .whitespacesAndNewlines)
        record.employeeID = employeeID.trimmingCharacters(in: .whitespacesAndNewlines)
        record.clockID = clockID.trimmingCharacters(in: .whitespacesAndNewlines)
        record.ticketNumber = ticketNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        record.authCode = authCode.trimmingCharacters(in: .whitespacesAndNewlines)
        record.notes = notes
        record.tags = tags
        record.isFlagged = isFlagged
        record.isConfirmed = confirmed && canConfirm
        record.imageHash = imageHash
        return record
    }
}
