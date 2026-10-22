import SwiftUI
import SwiftData
import PontoCore

/// Módulo opcional de análise da jornada (resumo mensal e relatórios).
struct AnalysisView: View {
    @Environment(AppSettings.self) private var settings
    @Query private var tickets: [Ticket]
    @State private var month = YearMonth(CalendarDate(date: Date()))
    @State private var shareItem: ShareItem?
    @State private var errorMessage: String?

    var body: some View {
        let analyzer = WorkdayAnalyzer(schedule: settings.schedule)
        let summary = analyzer.summarize(month: month, records: tickets.map { $0.record() }, until: CalendarDate(date: Date()))

        NavigationStack {
            List {
                Section {
                    HStack {
                        Button { month = month.adding(months: -1) } label: { Image(systemName: "chevron.left") }
                            .accessibilityLabel("Mês anterior")
                        Spacer()
                        Text(month.longName.capitalizedFirst).font(.headline)
                        Spacer()
                        Button { month = month.adding(months: 1) } label: { Image(systemName: "chevron.right") }
                            .accessibilityLabel("Próximo mês")
                    }
                    .buttonStyle(.borderless)
                }

                Section {
                    NoticeView(text: "Esta análise compara os tickets com a jornada que você configurou. Não afirma horas extras, atrasos, faltas ou infrações e não substitui o sistema oficial de ponto. Quando faltam informações, os valores são estimativas.",
                               systemImage: "info.circle.fill", tint: .blue)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)

                Section("Resumo do mês") {
                    LabeledContent("Dias com tickets", value: "\(summary.days.count)")
                    LabeledContent("Dias sem pendências", value: "\(summary.days.count - summary.daysWithIssues)")
                    LabeledContent("Tempo calculado*", value: DurationFormatter.string(minutes: summary.workedMinutesConfirmedDays))
                    LabeledContent("Jornada configurada*", value: DurationFormatter.string(minutes: summary.expectedMinutesConfirmedDays))
                    LabeledContent("Diferença indicativa*", value: DurationFormatter.string(minutes: summary.balanceMinutesConfirmedDays, showSign: true))
                    if summary.daysWithIssues > 0 {
                        Label("\(summary.daysWithIssues) dia(s) com pendências (marcação ausente ou tipo não confirmado)", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                    }
                    if !summary.expectedDaysWithoutTickets.isEmpty {
                        Label("Dias previstos sem ticket: " + summary.expectedDaysWithoutTickets.map { String(format: "%02d", $0.day) }.joined(separator: ", "),
                              systemImage: "calendar.badge.exclamationmark")
                            .foregroundStyle(.secondary)
                    }
                    Text("* Somente dias sem pendências entram nestes totais.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Dias") {
                    if summary.days.isEmpty {
                        Text("Nenhum ticket com data neste mês.").foregroundStyle(.secondary)
                    }
                    ForEach(summary.days) { day in
                        NavigationLink(value: day.date) {
                            DaySummaryRow(day: day)
                        }
                    }
                }

                Section("Relatórios") {
                    Button {
                        export { try ExportService.monthReportPDF(summary, schedule: settings.schedule) }
                    } label: {
                        Label("Exportar relatório em PDF", systemImage: "doc.richtext")
                    }
                    Button {
                        export { try ExportService.workdaysCSV(summary.days, month: month) }
                    } label: {
                        Label("Exportar jornada em CSV", systemImage: "tablecells")
                    }
                    Button {
                        let records = tickets.map { $0.record() }.filter { $0.recordDate.map(month.contains) ?? false }
                        export { try ExportService.ticketsCSV(records, name: "tickets-\(String(format: "%04d-%02d", month.year, month.month)).csv") }
                    } label: {
                        Label("Exportar tickets do mês em CSV", systemImage: "list.bullet.rectangle")
                    }
                    NavigationLink {
                        ScheduleSettingsView()
                    } label: {
                        Label("Configurar jornada de referência", systemImage: "slider.horizontal.3")
                    }
                }
            }
            .navigationTitle("Jornada")
            .navigationDestination(for: CalendarDate.self) { DayDetailView(day: $0) }
            .navigationDestination(for: UUID.self) { TicketDetailLoader(id: $0) }
            .sheet(item: $shareItem) { item in
                ActivityView(items: [item.url]).presentationDetents([.medium, .large])
            }
            .alert("Atenção", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private func export(_ make: () throws -> URL) {
        do {
            shareItem = ShareItem(url: try make())
        } catch {
            errorMessage = "Não foi possível gerar o arquivo. (\(error.localizedDescription))"
        }
    }
}

private struct DaySummaryRow: View {
    let day: WorkdaySummary

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("\(day.date.brazilian) · \(PortugueseCalendar.weekdayShort[day.date.weekday - 1])")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                if let worked = day.workedMinutes {
                    Text(DurationFormatter.string(minutes: worked)).font(.subheadline.monospacedDigit())
                }
                if day.isEstimate {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Estimativa, há pendências")
                }
            }
            Text(day.marks.map { $0.time.formatted }.joined(separator: " · "))
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            if let balance = day.balanceMinutes, !day.isEstimate {
                Text("Diferença indicativa: \(DurationFormatter.string(minutes: balance, showSign: true))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
