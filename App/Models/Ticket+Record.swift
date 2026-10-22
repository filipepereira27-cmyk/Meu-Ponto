import Foundation
import SwiftData
import PontoCore

/// Conversão entre o modelo persistido (SwiftData) e o `TicketRecord` do núcleo,
/// usado em busca, análise, exportação e backup.
extension Ticket {
    convenience init(record: TicketRecord) {
        self.init(id: record.id, importedAt: record.importedAt)
        apply(record)
        originalFileName = record.originalFileName
        imageFileName = record.imageFileName
        processedImageFileName = record.processedImageFileName
        imageHashBits = record.imageHash.map { Int64(bitPattern: $0) }
        ocrText = record.ocrText
        ocrConfidence = record.ocrConfidence
        fieldConfidencesData = try? JSONEncoder().encode(record.fieldConfidences)
        ocrSnapshotData = record.ocrSnapshot.flatMap { try? JSONEncoder().encode($0) }
        otherFieldsData = try? JSONEncoder().encode(record.otherFields)
    }

    /// Insere um novo ticket com seu histórico. O histórico é ligado depois da inserção,
    /// pois relacionamentos de objetos ainda não inseridos são instáveis no iOS 17.0.
    @discardableResult
    static func insert(_ record: TicketRecord, into context: ModelContext) -> Ticket {
        let ticket = Ticket(record: record)
        context.insert(ticket)
        for entry in record.changes {
            ticket.changes.append(TicketChange(id: entry.id, date: entry.date, field: entry.field,
                                               oldValue: entry.oldValue, newValue: entry.newValue))
        }
        return ticket
    }

    var recordDate: CalendarDate? { recordDayKey.flatMap(CalendarDate.init(key:)) }
    var recordTime: ClockTime? { recordTimeText.flatMap(ClockTime.init(string:)) }
    var markType: MarkType { MarkType(rawValue: markTypeRaw) ?? .indefinido }
    var imageHash: UInt64? { imageHashBits.map { UInt64(bitPattern: $0) } }

    var fieldConfidences: [String: Double] {
        fieldConfidencesData.flatMap { try? JSONDecoder().decode([String: Double].self, from: $0) } ?? [:]
    }

    var ocrSnapshot: ParsedTicket? {
        ocrSnapshotData.flatMap { try? JSONDecoder().decode(ParsedTicket.self, from: $0) }
    }

    var otherFields: [LabeledValue] {
        otherFieldsData.flatMap { try? JSONDecoder().decode([LabeledValue].self, from: $0) } ?? []
    }

    /// Converte para o tipo do núcleo. `includeDetails: false` evita decodificar o
    /// instantâneo do OCR e o histórico (mais rápido para listas e buscas).
    func record(includeDetails: Bool = false) -> TicketRecord {
        TicketRecord(
            id: id,
            originalFileName: originalFileName,
            imageFileName: imageFileName,
            processedImageFileName: processedImageFileName,
            imageHash: imageHash,
            ocrText: ocrText,
            ocrConfidence: ocrConfidence,
            fieldConfidences: includeDetails ? fieldConfidences : [:],
            ocrSnapshot: includeDetails ? ocrSnapshot : nil,
            recordDate: recordDate,
            recordTime: recordTime,
            markType: markType,
            company: company,
            cnpj: cnpj,
            employeeName: employeeName,
            employeeID: employeeID,
            clockID: clockID,
            ticketNumber: ticketNumber,
            authCode: authCode,
            otherFields: otherFields,
            importedAt: importedAt,
            isConfirmed: isConfirmed,
            isFlagged: isFlagged,
            notes: notes,
            tags: tags,
            journeyDate: journeyDayKey.flatMap(CalendarDate.init(key:)),
            changes: includeDetails
                ? changes.sorted { $0.date < $1.date }.map {
                    ChangeEntry(id: $0.id, date: $0.date, field: $0.field, oldValue: $0.oldValue, newValue: $0.newValue)
                }
                : []
        )
    }

    /// Aplica os campos editáveis de um registro (não altera imagens nem o texto do OCR).
    func apply(_ record: TicketRecord) {
        recordDayKey = record.recordDate?.key
        recordTimeText = record.recordTime?.formatted
        markTypeRaw = record.markType.rawValue
        company = record.company
        cnpj = record.cnpj
        employeeName = record.employeeName
        employeeID = record.employeeID
        clockID = record.clockID
        ticketNumber = record.ticketNumber
        authCode = record.authCode
        isConfirmed = record.isConfirmed
        isFlagged = record.isFlagged
        notes = record.notes
        tags = record.tags
        journeyDayKey = record.journeyDate?.key
    }

    /// Aplica uma edição do usuário registrando cada campo alterado no histórico.
    func update(to edited: TicketRecord, at date: Date = Date()) {
        let entries = ChangeTracker.diff(from: record(), to: edited, at: date)
        guard !entries.isEmpty else { return }
        apply(edited)
        updatedAt = date
        for entry in entries {
            changes.append(TicketChange(id: entry.id, date: entry.date, field: entry.field,
                                        oldValue: entry.oldValue, newValue: entry.newValue))
        }
    }

    /// Precisa de atenção: revisão pendente, dados incompletos ou sinalizado.
    var needsReview: Bool { !isConfirmed || isFlagged || recordDayKey == nil || recordTimeText == nil || markType == .indefinido }

    /// Texto curto para listas: "22/10/2026 às 08:01".
    var displayDateTime: String {
        switch (recordDate, recordTime) {
        case let (date?, time?): return "\(date.brazilian) às \(time.formatted)"
        case let (date?, nil): return "\(date.brazilian) — horário não informado"
        case let (nil, time?): return "Data não informada — \(time.formatted)"
        default: return "Data e horário não informados"
        }
    }
}
