import UIKit
import PontoCore

/// Geração de PDF e CSV e impressão. Os arquivos são criados em pasta temporária
/// e só saem do aparelho se o usuário escolher compartilhar.
enum ExportService {
    static let disclaimer = "Dados extraídos por reconhecimento automático (OCR) podem conter erros. O comprovante original é a referência. Este relatório não substitui o sistema oficial de ponto da empresa."

    private static let pageRect = CGRect(x: 0, y: 0, width: 595, height: 842) // A4 em pontos

    static func temporaryURL(_ name: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)
        return url
    }

    static var generatedAt: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pt_BR")
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: Date())
    }

    // MARK: CSV

    static func ticketsCSV(_ records: [TicketRecord], name: String = "tickets.csv") throws -> URL {
        let url = temporaryURL(name)
        try Data(CSVExporter.tickets(records).utf8).write(to: url)
        return url
    }

    static func workdaysCSV(_ days: [WorkdaySummary], month: YearMonth) throws -> URL {
        let url = temporaryURL("jornada-\(String(format: "%04d-%02d", month.year, month.month)).csv")
        try Data(CSVExporter.workdays(days).utf8).write(to: url)
        return url
    }

    // MARK: PDF de um ticket

    static func ticketPDF(_ record: TicketRecord) throws -> URL {
        let fileDate = record.recordDate?.key ?? "sem-data"
        let url = temporaryURL("ticket-\(fileDate)-\(record.id.uuidString.prefix(8)).pdf")
        let renderer = UIGraphicsPDFRenderer(bounds: pageRect, format: pdfFormat(title: "Comprovante de ponto"))
        try renderer.writePDF(to: url) { context in
            var writer = PDFWriter(context: context)
            writer.title("Comprovante de registro de ponto")
            writer.text("Gerado em \(generatedAt) pelo Meu Ponto Digital", style: .caption)
            writer.space(8)

            if let image = ImageStore.shared.image(for: record.imageFileName) {
                writer.image(image, maxHeight: 430)
            }
            writer.space(6)
            writer.heading("Dados do registro")
            writer.field("Data", record.recordDate?.brazilian ?? "Não informada")
            writer.field("Horário", record.recordTime?.formatted ?? "Não informado")
            writer.field("Tipo de marcação", record.markType.label)
            writer.field("Empresa", record.company)
            writer.field("CNPJ", record.cnpj)
            writer.field("Funcionário", record.employeeName)
            writer.field("Matrícula / identificador", record.employeeID)
            writer.field("Relógio (REP)", record.clockID)
            writer.field("NSR / nº do ticket", record.ticketNumber)
            writer.field("Código de autenticação", record.authCode)
            writer.field("Revisão", record.isConfirmed ? "Confirmada pelo usuário" : "Pendente de conferência")
            writer.field("Incluído no app em", DateFormatter.localizedString(from: record.importedAt, dateStyle: .short, timeStyle: .short))
            if !record.tags.isEmpty { writer.field("Etiquetas", record.tags.joined(separator: ", ")) }
            if !record.notes.isEmpty { writer.field("Observações", record.notes) }

            writer.heading("Texto reconhecido (OCR)")
            writer.text(record.ocrText.isEmpty ? "(nenhum texto reconhecido)" : record.ocrText, style: .mono)

            if !record.changes.isEmpty {
                writer.heading("Histórico de alterações")
                for change in record.changes {
                    let when = DateFormatter.localizedString(from: change.date, dateStyle: .short, timeStyle: .short)
                    writer.text("\(when) — \(change.field): \(change.oldValue) → \(change.newValue)", style: .body)
                }
            }
            writer.space(10)
            writer.text(disclaimer, style: .caption)
        }
        return url
    }

    // MARK: PDF do relatório mensal

    static func monthReportPDF(_ summary: MonthSummary, schedule: WorkSchedule) throws -> URL {
        let url = temporaryURL("relatorio-jornada-\(String(format: "%04d-%02d", summary.month.year, summary.month.month)).pdf")
        let renderer = UIGraphicsPDFRenderer(bounds: pageRect, format: pdfFormat(title: "Relatório de jornada"))
        try renderer.writePDF(to: url) { context in
            var writer = PDFWriter(context: context)
            writer.title("Relatório de jornada — \(summary.month.longName)")
            writer.text("Gerado em \(generatedAt) pelo Meu Ponto Digital", style: .caption)
            writer.space(6)
            writer.text("Comparação com a jornada configurada no app. Valores marcados como estimativa dependem de conferência. Este relatório não afirma a existência de horas extras, atrasos, faltas ou infrações.", style: .body)

            writer.heading("Resumo")
            writer.field("Dias com tickets", "\(summary.days.count)")
            writer.field("Dias sem pendências", "\(summary.days.count - summary.daysWithIssues)")
            writer.field("Tempo calculado (dias sem pendências)", DurationFormatter.string(minutes: summary.workedMinutesConfirmedDays))
            writer.field("Jornada configurada nesses dias", DurationFormatter.string(minutes: summary.expectedMinutesConfirmedDays))
            writer.field("Diferença indicativa", DurationFormatter.string(minutes: summary.balanceMinutesConfirmedDays, showSign: true))
            writer.field("Dias com pendências", "\(summary.daysWithIssues)")
            if !summary.expectedDaysWithoutTickets.isEmpty {
                writer.field("Dias previstos sem ticket", summary.expectedDaysWithoutTickets.map { String(format: "%02d", $0.day) }.joined(separator: ", "))
            }

            writer.heading("Dias")
            for day in summary.days {
                let weekday = PortugueseCalendar.weekdayShort[day.date.weekday - 1]
                let worked = day.workedMinutes.map { DurationFormatter.string(minutes: $0) } ?? "não calculado"
                let balance = day.balanceMinutes.map { " (\(DurationFormatter.string(minutes: $0, showSign: true)))" } ?? ""
                writer.text("\(day.date.brazilian) \(weekday) — \(worked)\(balance)\(day.isEstimate ? " — estimativa" : "")", style: .bodyBold)
                writer.text(day.marks.map { "\($0.time.formatted) \($0.type.label)" }.joined(separator: "  ·  "), style: .body)
                for issue in day.issues { writer.text("⚠︎ \(issue.message)", style: .caption) }
                writer.space(4)
            }
            writer.space(10)
            writer.field("Jornada configurada", scheduleDescription(schedule))
            writer.text(disclaimer, style: .caption)
        }
        return url
    }

    static func scheduleDescription(_ schedule: WorkSchedule) -> String {
        let days = (0..<7).compactMap { index -> String? in
            let minutes = schedule.expectedMinutesByWeekday[index]
            return minutes > 0 ? "\(PortugueseCalendar.weekdayShort[index]) \(DurationFormatter.string(minutes: minutes))" : nil
        }
        return days.joined(separator: ", ") + "; intervalo de referência \(DurationFormatter.string(minutes: schedule.minimumBreakMinutes))"
    }

    // MARK: Impressão

    static func printDocument(url: URL, jobName: String) {
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = jobName
        controller.printInfo = info
        controller.printingItem = url
        controller.present(animated: true)
    }

    private static func pdfFormat(title: String) -> UIGraphicsPDFRendererFormat {
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextCreator as String: "Meu Ponto Digital",
            kCGPDFContextTitle as String: title
        ]
        return format
    }
}

/// Escrita sequencial de PDF com quebra de página automática.
private struct PDFWriter {
    enum Style {
        case title, heading, body, bodyBold, caption, mono

        var font: UIFont {
            switch self {
            case .title: return .systemFont(ofSize: 18, weight: .bold)
            case .heading: return .systemFont(ofSize: 13, weight: .semibold)
            case .body: return .systemFont(ofSize: 10)
            case .bodyBold: return .systemFont(ofSize: 10, weight: .semibold)
            case .caption: return .systemFont(ofSize: 8)
            case .mono: return .monospacedSystemFont(ofSize: 8.5, weight: .regular)
            }
        }

        var color: UIColor { self == .caption ? .darkGray : .black }
    }

    let context: UIGraphicsPDFRendererContext
    let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
    let margin: CGFloat = 40
    var y: CGFloat

    init(context: UIGraphicsPDFRendererContext) {
        self.context = context
        self.y = 40
        context.beginPage()
    }

    private var width: CGFloat { bounds.width - margin * 2 }

    private mutating func ensureSpace(_ height: CGFloat) {
        if y + height > bounds.height - margin {
            context.beginPage()
            y = margin
        }
    }

    mutating func space(_ value: CGFloat) { y += value }

    mutating func title(_ text: String) { self.text(text, style: .title); space(2) }

    mutating func heading(_ text: String) {
        space(8)
        self.text(text, style: .heading)
        space(2)
    }

    mutating func text(_ text: String, style: Style) {
        let attributes: [NSAttributedString.Key: Any] = [.font: style.font, .foregroundColor: style.color]
        // Quebra textos longos linha a linha para permitir paginação.
        for paragraph in text.components(separatedBy: "\n") {
            let string = NSAttributedString(string: paragraph.isEmpty ? " " : paragraph, attributes: attributes)
            let height = ceil(string.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude),
                                                  options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil).height)
            ensureSpace(height)
            string.draw(with: CGRect(x: margin, y: y, width: width, height: height),
                        options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
            y += height + 2
        }
    }

    mutating func field(_ label: String, _ value: String) {
        text("\(label): \(value.isEmpty ? "—" : value)", style: .body)
    }

    mutating func image(_ image: UIImage, maxHeight: CGFloat) {
        let ratio = min(width / image.size.width, maxHeight / image.size.height, 1)
        let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
        ensureSpace(size.height)
        image.draw(in: CGRect(x: margin + (width - size.width) / 2, y: y, width: size.width, height: size.height))
        y += size.height + 4
    }
}
