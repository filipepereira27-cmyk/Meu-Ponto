import Foundation

/// Exportação CSV compatível com Excel/Numbers em português
/// (separador `;`, UTF-8 com BOM, aspas quando necessário).
public enum CSVExporter {
    public static let separator = ";"

    static func escape(_ value: String) -> String {
        let needsQuotes = value.contains(separator) || value.contains("\"") || value.contains("\n") || value.contains("\r")
        let escaped = value.replacingOccurrences(of: "\"", with: "\"\"")
        return needsQuotes ? "\"\(escaped)\"" : escaped
    }

    static func document(header: [String], rows: [[String]]) -> String {
        let lines = [header] + rows
        return "\u{FEFF}" + lines.map { $0.map(escape).joined(separator: separator) }.joined(separator: "\r\n") + "\r\n"
    }

    /// Um ticket por linha.
    public static func tickets(_ records: [TicketRecord], timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pt_BR")
        formatter.timeZone = timeZone
        formatter.dateFormat = "dd/MM/yyyy HH:mm:ss"
        let header = ["ID", "Data do registro", "Horário", "Tipo de marcação", "Empresa", "CNPJ", "Funcionário",
                      "Matrícula/identificador", "Relógio (REP)", "NSR/Nº ticket", "Código de autenticação",
                      "Revisão", "Sinalizado", "Etiquetas", "Observações", "Confiança OCR (%)",
                      "Incluído em", "Arquivo original"]
        let rows = records.sorted(by: TicketRecord.chronological).map { r in
            [r.id.uuidString, r.recordDate?.brazilian ?? "", r.recordTime?.formatted ?? "", r.markType.label,
             r.company, r.cnpj, r.employeeName, r.employeeID, r.clockID, r.ticketNumber, r.authCode,
             r.isConfirmed ? "Confirmada" : "Pendente", r.isFlagged ? "Sim" : "Não",
             r.tags.joined(separator: ", "), r.notes, String(Int((r.ocrConfidence * 100).rounded())),
             formatter.string(from: r.importedAt), r.originalFileName]
        }
        return document(header: header, rows: rows)
    }

    /// Um dia de jornada por linha (relatório de análise).
    public static func workdays(_ days: [WorkdaySummary]) -> String {
        let header = ["Data", "Dia da semana", "Marcações", "Tempo trabalhado", "Intervalos", "Jornada configurada",
                      "Diferença (indicativa)", "Situação", "Pendências"]
        let rows = days.map { day -> [String] in
            [day.date.brazilian,
             PortugueseCalendar.weekdayNames[day.date.weekday - 1],
             day.marks.map { "\($0.time.formatted) \($0.type.label)" }.joined(separator: " | "),
             day.workedMinutes.map { DurationFormatter.string(minutes: $0) } ?? "Não calculado",
             DurationFormatter.string(minutes: day.totalBreakMinutes),
             DurationFormatter.string(minutes: day.expectedMinutes),
             day.balanceMinutes.map { DurationFormatter.string(minutes: $0, showSign: true) } ?? "",
             day.isEstimate ? "Estimativa" : "Calculado",
             day.issues.map(\.message).joined(separator: " / ")]
        }
        return document(header: header, rows: rows)
    }
}
