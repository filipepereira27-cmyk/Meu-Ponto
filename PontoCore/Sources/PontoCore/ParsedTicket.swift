import Foundation

/// Linha de texto reconhecida pelo OCR, com confiança entre 0 e 1.
public struct OCRLine: Hashable, Codable, Sendable {
    public var text: String
    public var confidence: Double

    public init(text: String, confidence: Double) {
        self.text = text
        self.confidence = min(max(confidence, 0), 1)
    }
}

/// Valor extraído automaticamente, com a confiança estimada e a linha de origem.
public struct ExtractedValue<Value: Hashable & Codable & Sendable>: Hashable, Codable, Sendable {
    public var value: Value
    /// 0...1 — combina a confiança do OCR com a certeza da interpretação.
    public var confidence: Double
    /// Linha do comprovante de onde o valor foi lido (para conferência).
    public var sourceText: String
    /// Observação sobre a extração (ex.: "dígitos corrigidos", "PIS inválido").
    public var note: String?

    public init(value: Value, confidence: Double, sourceText: String, note: String? = nil) {
        self.value = value
        self.confidence = min(max(confidence, 0), 1)
        self.sourceText = sourceText
        self.note = note
    }
}

/// Par rótulo/valor encontrado no comprovante e não mapeado para um campo conhecido.
public struct LabeledValue: Hashable, Codable, Sendable {
    public var label: String
    public var value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// Campos que podem ser extraídos de um comprovante.
public enum TicketField: String, CaseIterable, Codable, Sendable {
    case employeeName, employeeID, company, cnpj, date, time, markType, clockID, ticketNumber, authCode

    public var label: String {
        switch self {
        case .employeeName: return "Funcionário"
        case .employeeID: return "Matrícula / identificador"
        case .company: return "Empresa"
        case .cnpj: return "CNPJ"
        case .date: return "Data do registro"
        case .time: return "Horário"
        case .markType: return "Tipo de marcação"
        case .clockID: return "Relógio de ponto (REP)"
        case .ticketNumber: return "Nº do ticket / NSR"
        case .authCode: return "Código de autenticação"
        }
    }

    /// Campos essenciais: se houver dúvida, o usuário precisa confirmar.
    public var isCritical: Bool { self == .date || self == .time || self == .markType }
}

/// Resultado da interpretação do texto de um comprovante.
public struct ParsedTicket: Hashable, Codable, Sendable {
    /// Abaixo deste valor o campo é destacado para confirmação.
    public static let confirmationThreshold = 0.85

    public var employeeName: ExtractedValue<String>?
    public var employeeID: ExtractedValue<String>?
    public var company: ExtractedValue<String>?
    public var cnpj: ExtractedValue<String>?
    public var date: ExtractedValue<CalendarDate>?
    public var time: ExtractedValue<ClockTime>?
    public var markType: ExtractedValue<MarkType>?
    public var clockID: ExtractedValue<String>?
    public var ticketNumber: ExtractedValue<String>?
    public var authCode: ExtractedValue<String>?
    public var otherFields: [LabeledValue] = []
    /// Texto integral reconhecido, linha a linha.
    public var fullText: String = ""
    /// Média da confiança das linhas reconhecidas.
    public var averageConfidence: Double = 0
    /// Avisos para o usuário (ex.: várias datas encontradas).
    public var warnings: [String] = []

    public init() {}

    public func confidence(of field: TicketField) -> Double? {
        switch field {
        case .employeeName: return employeeName?.confidence
        case .employeeID: return employeeID?.confidence
        case .company: return company?.confidence
        case .cnpj: return cnpj?.confidence
        case .date: return date?.confidence
        case .time: return time?.confidence
        case .markType: return markType?.value == .indefinido ? 0 : markType?.confidence
        case .clockID: return clockID?.confidence
        case .ticketNumber: return ticketNumber?.confidence
        case .authCode: return authCode?.confidence
        }
    }

    /// Verdadeiro quando o campo está ausente ou com confiança baixa.
    public func needsConfirmation(_ field: TicketField) -> Bool {
        guard let confidence = confidence(of: field) else { return field.isCritical }
        return confidence < Self.confirmationThreshold
    }

    /// Campos críticos (data, horário, tipo) que exigem confirmação explícita.
    public var criticalFieldsNeedingConfirmation: [TicketField] {
        TicketField.allCases.filter { $0.isCritical && needsConfirmation($0) }
    }

    /// Mapa campo -> confiança, para armazenamento.
    public var fieldConfidences: [String: Double] {
        var result: [String: Double] = [:]
        for field in TicketField.allCases {
            if let value = confidence(of: field) { result[field.rawValue] = value }
        }
        return result
    }
}
