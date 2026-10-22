import Foundation

/// Representação completa e independente de plataforma de um ticket armazenado.
///
/// O app persiste os tickets com SwiftData e converte para este tipo para buscar,
/// analisar, exportar e fazer backup. O formato `Codable` é o mesmo do arquivo de backup.
public struct TicketRecord: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID

    // Arquivos
    /// Nome original do arquivo importado (ou nome gerado para fotos da câmera).
    public var originalFileName: String
    /// Nome do arquivo da imagem original dentro do armazenamento do app.
    public var imageFileName: String
    /// Imagem tratada (recortada/girada/realçada) usada no OCR. Opcional.
    public var processedImageFileName: String?
    /// Hash perceptual da imagem tratada (detecção de duplicidade).
    public var imageHash: UInt64?

    // OCR (preservado sem alterações)
    public var ocrText: String
    public var ocrConfidence: Double
    public var fieldConfidences: [String: Double]
    /// Valores extraídos automaticamente, antes de qualquer correção do usuário.
    public var ocrSnapshot: ParsedTicket?

    // Dados estruturados (podem ser corrigidos pelo usuário; correções vão para `changes`)
    public var recordDate: CalendarDate?
    public var recordTime: ClockTime?
    public var markType: MarkType
    public var company: String
    public var cnpj: String
    public var employeeName: String
    public var employeeID: String
    public var clockID: String
    public var ticketNumber: String
    public var authCode: String
    public var otherFields: [LabeledValue]

    // Organização
    public var importedAt: Date
    public var isConfirmed: Bool
    public var isFlagged: Bool
    public var notes: String
    public var tags: [String]
    /// Associação manual: o ticket pertence à jornada iniciada neste dia (ex.: turno noturno).
    public var journeyDate: CalendarDate?

    public var changes: [ChangeEntry]

    public init(
        id: UUID = UUID(),
        originalFileName: String = "",
        imageFileName: String = "",
        processedImageFileName: String? = nil,
        imageHash: UInt64? = nil,
        ocrText: String = "",
        ocrConfidence: Double = 0,
        fieldConfidences: [String: Double] = [:],
        ocrSnapshot: ParsedTicket? = nil,
        recordDate: CalendarDate? = nil,
        recordTime: ClockTime? = nil,
        markType: MarkType = .indefinido,
        company: String = "",
        cnpj: String = "",
        employeeName: String = "",
        employeeID: String = "",
        clockID: String = "",
        ticketNumber: String = "",
        authCode: String = "",
        otherFields: [LabeledValue] = [],
        importedAt: Date = Date(),
        isConfirmed: Bool = false,
        isFlagged: Bool = false,
        notes: String = "",
        tags: [String] = [],
        journeyDate: CalendarDate? = nil,
        changes: [ChangeEntry] = []
    ) {
        self.id = id
        self.originalFileName = originalFileName
        self.imageFileName = imageFileName
        self.processedImageFileName = processedImageFileName
        self.imageHash = imageHash
        self.ocrText = ocrText
        self.ocrConfidence = ocrConfidence
        self.fieldConfidences = fieldConfidences
        self.ocrSnapshot = ocrSnapshot
        self.recordDate = recordDate
        self.recordTime = recordTime
        self.markType = markType
        self.company = company
        self.cnpj = cnpj
        self.employeeName = employeeName
        self.employeeID = employeeID
        self.clockID = clockID
        self.ticketNumber = ticketNumber
        self.authCode = authCode
        self.otherFields = otherFields
        self.importedAt = importedAt
        self.isConfirmed = isConfirmed
        self.isFlagged = isFlagged
        self.notes = notes
        self.tags = tags
        self.journeyDate = journeyDate
        self.changes = changes
    }

    /// Cria um registro a partir do resultado do OCR (ainda não confirmado).
    public init(parsed: ParsedTicket, id: UUID = UUID(), importedAt: Date = Date()) {
        self.init(
            id: id,
            ocrText: parsed.fullText,
            ocrConfidence: parsed.averageConfidence,
            fieldConfidences: parsed.fieldConfidences,
            ocrSnapshot: parsed,
            recordDate: parsed.date?.value,
            recordTime: parsed.time?.value,
            markType: parsed.markType?.value ?? .indefinido,
            company: parsed.company?.value ?? "",
            cnpj: parsed.cnpj?.value ?? "",
            employeeName: parsed.employeeName?.value ?? "",
            employeeID: parsed.employeeID?.value ?? "",
            clockID: parsed.clockID?.value ?? "",
            ticketNumber: parsed.ticketNumber?.value ?? "",
            authCode: parsed.authCode?.value ?? "",
            otherFields: parsed.otherFields,
            importedAt: importedAt
        )
    }

    /// Faltam data, horário ou tipo de marcação.
    public var isIncomplete: Bool { recordDate == nil || recordTime == nil || markType == .indefinido }

    /// Precisa de atenção do usuário: não confirmado, incompleto ou sinalizado.
    public var needsReview: Bool { !isConfirmed || isIncomplete || isFlagged }

    /// Dia da jornada a que o ticket pertence (associação manual ou data impressa).
    public var workdayDate: CalendarDate? { journeyDate ?? recordDate }

    /// Chave de ordenação: data e horário impressos; sem data, vai para o fim, pela data de inclusão.
    public static func chronological(_ a: TicketRecord, _ b: TicketRecord) -> Bool {
        switch (a.recordDate, b.recordDate) {
        case let (da?, db?) where da != db: return da < db
        case (nil, _?): return false
        case (_?, nil): return true
        default:
            let ta = a.recordTime?.secondsOfDay ?? Int.max
            let tb = b.recordTime?.secondsOfDay ?? Int.max
            if ta != tb { return ta < tb }
            return a.importedAt < b.importedAt
        }
    }
}

// MARK: - Histórico de alterações

/// Alteração de um campo, registrada separadamente do comprovante original.
public struct ChangeEntry: Identifiable, Hashable, Codable, Sendable {
    public var id: UUID
    public var date: Date
    public var field: String
    public var oldValue: String
    public var newValue: String

    public init(id: UUID = UUID(), date: Date = Date(), field: String, oldValue: String, newValue: String) {
        self.id = id
        self.date = date
        self.field = field
        self.oldValue = oldValue
        self.newValue = newValue
    }
}

public enum ChangeTracker {
    /// Lista as diferenças entre duas versões de um ticket nos campos editáveis.
    public static func diff(from old: TicketRecord, to new: TicketRecord, at date: Date = Date()) -> [ChangeEntry] {
        func text(_ value: String) -> String { value.isEmpty ? "(vazio)" : value }
        let pairs: [(String, String, String)] = [
            ("Data do registro", old.recordDate?.brazilian ?? "", new.recordDate?.brazilian ?? ""),
            ("Horário", old.recordTime?.formatted ?? "", new.recordTime?.formatted ?? ""),
            ("Tipo de marcação", old.markType.label, new.markType.label),
            ("Empresa", old.company, new.company),
            ("CNPJ", old.cnpj, new.cnpj),
            ("Funcionário", old.employeeName, new.employeeName),
            ("Matrícula / identificador", old.employeeID, new.employeeID),
            ("Relógio de ponto (REP)", old.clockID, new.clockID),
            ("Nº do ticket / NSR", old.ticketNumber, new.ticketNumber),
            ("Código de autenticação", old.authCode, new.authCode),
            ("Observações", old.notes, new.notes),
            ("Etiquetas", old.tags.joined(separator: ", "), new.tags.joined(separator: ", ")),
            ("Jornada associada", old.journeyDate?.brazilian ?? "", new.journeyDate?.brazilian ?? ""),
            ("Situação da revisão", old.isConfirmed ? "Confirmada" : "Pendente", new.isConfirmed ? "Confirmada" : "Pendente"),
            ("Sinalizado para conferência", old.isFlagged ? "Sim" : "Não", new.isFlagged ? "Sim" : "Não")
        ]
        return pairs.compactMap { field, before, after in
            before == after ? nil : ChangeEntry(date: date, field: field, oldValue: text(before), newValue: text(after))
        }
    }
}
