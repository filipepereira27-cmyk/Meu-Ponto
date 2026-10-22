import SwiftUI
import SwiftData
import PontoCore

/// Calendário mensal: cada dia mostra quantos tickets foram registrados nele.
struct CalendarScreen: View {
    @Query private var tickets: [Ticket]
    @State private var month = YearMonth(CalendarDate(date: Date()))

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)

    var body: some View {
        let byDay = Dictionary(grouping: tickets.filter { $0.recordDayKey != nil }, by: { $0.recordDayKey! })
        let today = CalendarDate(date: Date())
        let daysWithTickets = month.days.filter { byDay[$0.key] != nil }
        let undated = tickets.filter { $0.recordDayKey == nil }.count

        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    header(today: today)

                    LazyVGrid(columns: columns, spacing: 6) {
                        ForEach(PortugueseCalendar.weekdayShort, id: \.self) { name in
                            Text(name)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                        ForEach(0..<(month.firstDay.weekday - 1), id: \.self) { _ in
                            Color.clear.frame(height: 52)
                        }
                        ForEach(month.days, id: \.self) { day in
                            let dayTickets = byDay[day.key] ?? []
                            let pending = dayTickets.filter(\.needsReview).count
                            NavigationLink(value: day) {
                                DayCell(day: day, count: dayTickets.count, pending: pending, isToday: day == today)
                            }
                            .buttonStyle(.plain)
                            .disabled(dayTickets.isEmpty)
                            .accessibilityLabel(accessibilityText(day: day, count: dayTickets.count, pending: pending))
                        }
                    }
                    .padding()
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
                    .gesture(
                        DragGesture(minimumDistance: 40).onEnded { value in
                            if value.translation.width < -40 { month = month.adding(months: 1) }
                            if value.translation.width > 40 { month = month.adding(months: -1) }
                        }
                    )

                    legend

                    if !daysWithTickets.isEmpty {
                        CardSection(title: "Dias com tickets em \(month.longName)", systemImage: "list.bullet") {
                            ForEach(daysWithTickets, id: \.self) { day in
                                let dayTickets = (byDay[day.key] ?? []).sorted { ($0.recordTimeText ?? "") < ($1.recordTimeText ?? "") }
                                NavigationLink(value: day) {
                                    HStack(alignment: .top) {
                                        VStack(alignment: .leading) {
                                            Text(day.brazilian).font(.subheadline.weight(.semibold))
                                            Text(PortugueseCalendar.weekdayNames[day.weekday - 1]).font(.caption).foregroundStyle(.secondary)
                                        }
                                        .frame(width: 110, alignment: .leading)
                                        Text(dayTickets.map { $0.recordTimeText.map { String($0.prefix(5)) } ?? "--:--" }.joined(separator: "  "))
                                            .font(.subheadline.monospacedDigit())
                                        Spacer()
                                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                Divider()
                            }
                        }
                    }

                    if undated > 0 {
                        NoticeView(text: "\(undated) ticket(s) sem data identificada não aparecem no calendário. Encontre-os no Arquivo com o filtro “informações incompletas”.",
                                   systemImage: "calendar.badge.exclamationmark")
                    }
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Calendário")
            .navigationDestination(for: CalendarDate.self) { DayDetailView(day: $0) }
            .navigationDestination(for: UUID.self) { TicketDetailLoader(id: $0) }
        }
    }

    private func header(today: CalendarDate) -> some View {
        HStack {
            Button { month = month.adding(months: -1) } label: {
                Image(systemName: "chevron.left").font(.title3.weight(.semibold)).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Mês anterior")
            Spacer()
            VStack {
                Text(month.longName.capitalizedFirst).font(.title2.bold())
                if month != YearMonth(today) {
                    Button("Ir para hoje") { month = YearMonth(today) }.font(.caption)
                }
            }
            Spacer()
            Button { month = month.adding(months: 1) } label: {
                Image(systemName: "chevron.right").font(.title3.weight(.semibold)).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Próximo mês")
        }
    }

    private var legend: some View {
        HStack(spacing: 16) {
            Label("Com tickets", systemImage: "circle.fill").foregroundStyle(Color.accentColor)
            Label("Precisa de revisão", systemImage: "exclamationmark.circle.fill").foregroundStyle(.orange)
        }
        .font(.caption)
    }

    private func accessibilityText(day: CalendarDate, count: Int, pending: Int) -> String {
        var text = "\(day.day) de \(PortugueseCalendar.monthNames[day.month - 1])"
        if count == 0 { return text + ", sem tickets" }
        text += ", \(count) ticket\(count == 1 ? "" : "s")"
        if pending > 0 { text += ", \(pending) para revisar" }
        return text
    }
}

private struct DayCell: View {
    let day: CalendarDate
    let count: Int
    let pending: Int
    let isToday: Bool

    var body: some View {
        VStack(spacing: 4) {
            Text("\(day.day)")
                .font(.body.weight(isToday ? .bold : .regular).monospacedDigit())
                .foregroundStyle(isToday ? Color.accentColor : .primary)
            if count > 0 {
                HStack(spacing: 2) {
                    Text("\(count)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Color.accentColor, in: Capsule())
                    if pending > 0 {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
            } else {
                Text(" ").font(.caption2)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 52)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(count > 0 ? Color.accentColor.opacity(0.10) : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(isToday ? Color.accentColor : Color.clear, lineWidth: 1.5)
        )
    }
}

/// Todos os comprovantes de um dia, com o resumo da jornada.
struct DayDetailView: View {
    let day: CalendarDate
    @Environment(\.modelContext) private var context
    @Environment(AppSettings.self) private var settings
    @Query private var tickets: [Ticket]

    init(day: CalendarDate) {
        self.day = day
        let key: String? = day.key
        _tickets = Query(filter: #Predicate<Ticket> { $0.recordDayKey == key || $0.journeyDayKey == key })
    }

    /// Tickets que compõem a jornada deste dia (data impressa ou associação manual).
    private var journeyTickets: [Ticket] {
        tickets.filter { ($0.journeyDayKey ?? $0.recordDayKey) == day.key }
            .sorted { TicketRecord.chronological($0.record(), $1.record()) }
    }

    /// Tickets impressos neste dia, mas associados à jornada de outro dia.
    private var movedAway: [Ticket] {
        tickets.filter { $0.recordDayKey == day.key && $0.journeyDayKey != nil && $0.journeyDayKey != day.key }
    }

    var body: some View {
        List {
            Section {
                ForEach(journeyTickets) { ticket in
                    NavigationLink(value: ticket.id) {
                        VStack(alignment: .leading, spacing: 4) {
                            TicketRow(ticket: ticket)
                            if ticket.recordDayKey != day.key, let printed = ticket.recordDate {
                                Label("Registrado em \(printed.brazilian), associado a esta jornada", systemImage: "link")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .contextMenu { associationMenu(for: ticket) }
                    .swipeActions(edge: .leading) {
                        if ticket.journeyDayKey == nil, ticket.recordDayKey == day.key {
                            Button {
                                associate(ticket, to: day.adding(days: -1))
                            } label: {
                                Label("Jornada anterior", systemImage: "arrow.uturn.left")
                            }
                            .tint(.indigo)
                        }
                    }
                }
            } header: {
                Text("Marcações (\(journeyTickets.count))")
            } footer: {
                Text("Turno que atravessa a meia-noite? Toque e segure um ticket para associá-lo à jornada do dia anterior.")
            }

            if !movedAway.isEmpty {
                Section("Associados a outra jornada") {
                    ForEach(movedAway) { ticket in
                        NavigationLink(value: ticket.id) { TicketRow(ticket: ticket) }
                            .contextMenu { associationMenu(for: ticket) }
                    }
                }
            }

            if settings.analysisEnabled {
                let summary = WorkdayAnalyzer(schedule: settings.schedule)
                    .summarize(day: day, records: journeyTickets.map { $0.record() })
                WorkdaySummarySection(summary: summary)
            }
        }
        .navigationTitle(day.brazilian)
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func associationMenu(for ticket: Ticket) -> some View {
        if let printed = ticket.recordDate {
            if ticket.journeyDayKey == nil || ticket.journeyDayKey == printed.key {
                Button {
                    associate(ticket, to: printed.adding(days: -1))
                } label: {
                    Label("Pertence à jornada de \(printed.adding(days: -1).brazilian)", systemImage: "arrow.uturn.left")
                }
            } else {
                Button {
                    associate(ticket, to: nil)
                } label: {
                    Label("Desfazer associação de jornada", systemImage: "link.badge.plus")
                }
            }
        }
    }

    private func associate(_ ticket: Ticket, to journey: CalendarDate?) {
        var edited = ticket.record()
        edited.journeyDate = journey
        ticket.update(to: edited)
        try? context.save()
    }
}

/// Resumo de um dia: marcações, tempos entre elas e comparação com a jornada configurada.
struct WorkdaySummarySection: View {
    let summary: WorkdaySummary

    var body: some View {
        Section {
            ForEach(Array(summary.marks.enumerated()), id: \.offset) { index, mark in
                HStack {
                    Text(mark.time.formatted).font(.body.monospacedDigit().weight(.semibold))
                    if mark.date != summary.date {
                        Text("(\(String(format: "%02d/%02d", mark.date.day, mark.date.month)))").font(.caption).foregroundStyle(.secondary)
                    }
                    MarkTypeBadge(type: mark.type)
                    Spacer()
                    if index < summary.gapsBetweenMarks.count {
                        Text("+\(DurationFormatter.string(minutes: summary.gapsBetweenMarks[index]))")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                            .accessibilityLabel("\(DurationFormatter.string(minutes: summary.gapsBetweenMarks[index])) até a próxima marcação")
                    }
                }
            }
            if let worked = summary.workedMinutes {
                LabeledContent("Tempo trabalhado\(summary.isEstimate ? " (estimativa)" : "")",
                               value: DurationFormatter.string(minutes: worked))
            } else if !summary.marks.isEmpty {
                LabeledContent("Tempo trabalhado", value: "Não calculado")
            }
            if !summary.breaks.isEmpty {
                LabeledContent("Intervalos", value: summary.breaks.map { DurationFormatter.string(minutes: $0) }.joined(separator: " + "))
            }
            LabeledContent("Jornada configurada", value: DurationFormatter.string(minutes: summary.expectedMinutes))
            if let balance = summary.balanceMinutes {
                LabeledContent("Diferença indicativa", value: DurationFormatter.string(minutes: balance, showSign: true))
            }
            ForEach(summary.issues, id: \.self) { issue in
                Label(issue.message, systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        } header: {
            Text("Resumo da jornada")
        } footer: {
            Text("Comparação com a jornada que você configurou. Não indica horas extras, atrasos ou faltas: isso depende das regras da empresa, de acordos e de ajustes no sistema oficial.")
        }
    }
}
