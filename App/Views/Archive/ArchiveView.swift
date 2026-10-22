import SwiftUI
import SwiftData
import PontoCore

/// Arquivo pesquisável: linha do tempo por mês, ordenada pela data/horário impressos.
struct ArchiveView: View {
    @Environment(AppNavigation.self) private var navigation
    @Query private var tickets: [Ticket]
    @State private var cache = SearchCache()
    @State private var showFilters = false
    @State private var newestFirst = true
    @State private var captureRequest: CaptureSource?

    private struct MonthGroup: Identifiable {
        let id: String
        let title: String
        let tickets: [Ticket]
    }

    var body: some View {
        @Bindable var navigation = navigation
        let results = cache.results(for: tickets, filter: navigation.archiveFilter)
        let groups = groupByMonth(newestFirst ? Array(results.reversed()) : results)

        NavigationStack(path: $navigation.archivePath) {
            List {
                if !navigation.archiveFilter.isEmpty {
                    Section {
                        HStack {
                            Text("\(results.count) de \(tickets.count) ticket(s)")
                                .font(.subheadline)
                            Spacer()
                            Button("Limpar filtros") { navigation.archiveFilter = TicketFilter() }
                                .font(.subheadline)
                        }
                    }
                }
                ForEach(groups) { group in
                    Section(group.title) {
                        ForEach(group.tickets) { ticket in
                            NavigationLink(value: ticket.id) {
                                TicketRow(ticket: ticket)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Arquivo")
            .searchable(text: $navigation.archiveFilter.text, prompt: "Data, horário, empresa ou texto")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Ordem", selection: $newestFirst) {
                            Text("Mais recentes primeiro").tag(true)
                            Text("Mais antigos primeiro").tag(false)
                        }
                        NavigationLink {
                            DuplicatesView()
                        } label: {
                            Label("Possíveis duplicidades", systemImage: "doc.on.doc")
                        }
                    } label: {
                        Label("Opções", systemImage: "arrow.up.arrow.down.circle")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showFilters = true
                    } label: {
                        let count = navigation.archiveFilter.activeFilterCount
                        Label(count > 0 ? "Filtros (\(count))" : "Filtros",
                              systemImage: count > 0 ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                }
            }
            .overlay {
                if tickets.isEmpty {
                    ContentUnavailableView {
                        Label("Arquivo vazio", systemImage: "tray")
                    } description: {
                        Text("Os tickets que você fotografar ou importar aparecem aqui, em ordem de data e horário.")
                    } actions: {
                        Button("Fotografar ticket") { captureRequest = .camera }
                            .buttonStyle(.borderedProminent)
                        Button("Importar foto") { captureRequest = .library }
                    }
                } else if results.isEmpty {
                    ContentUnavailableView {
                        Label("Nada encontrado", systemImage: "magnifyingglass")
                    } description: {
                        Text("Tente outra palavra, uma data como 22/10 ou um horário como 8:01. Você também pode limpar os filtros.")
                    } actions: {
                        Button("Limpar busca e filtros") { navigation.archiveFilter = TicketFilter() }
                    }
                }
            }
            .sheet(isPresented: $showFilters) {
                FilterSheet(filter: navigation.archiveFilter, availableTags: Array(Set(tickets.flatMap(\.tags))).sorted()) { newFilter in
                    navigation.archiveFilter = newFilter
                }
            }
            .navigationDestination(for: UUID.self) { TicketDetailLoader(id: $0) }
            .ticketCapture(request: $captureRequest)
        }
    }

    private func groupByMonth(_ tickets: [Ticket]) -> [MonthGroup] {
        var groups: [MonthGroup] = []
        for ticket in tickets {
            let key = ticket.recordDate.map { String(format: "%04d-%02d", $0.year, $0.month) } ?? "sem-data"
            if groups.last?.id == key {
                groups[groups.count - 1] = MonthGroup(id: key, title: groups[groups.count - 1].title,
                                                      tickets: groups[groups.count - 1].tickets + [ticket])
            } else {
                let title = ticket.recordDate.map { YearMonth($0).longName.capitalizedFirst } ?? "Sem data identificada"
                groups.append(MonthGroup(id: key, title: title, tickets: [ticket]))
            }
        }
        return groups
    }
}

/// Guarda o texto pesquisável de cada ticket entre buscas (recalcula só o que mudou).
final class SearchCache {
    private var entries: [UUID: (updatedAt: Date, record: TicketRecord, text: String)] = [:]

    func results(for tickets: [Ticket], filter: TicketFilter) -> [Ticket] {
        var byID: [UUID: Ticket] = [:]
        var matched: [TicketRecord] = []
        for ticket in tickets {
            let entry: (updatedAt: Date, record: TicketRecord, text: String)
            if let cached = entries[ticket.id], cached.updatedAt == ticket.updatedAt {
                entry = cached
            } else {
                let record = ticket.record()
                entry = (ticket.updatedAt, record, TicketFilter.searchableText(for: record))
                entries[ticket.id] = entry
            }
            if filter.matches(entry.record, searchableText: entry.text) {
                matched.append(entry.record)
                byID[ticket.id] = ticket
            }
        }
        return matched.sorted(by: TicketRecord.chronological).compactMap { byID[$0.id] }
    }
}

/// Filtros avançados. Edita uma cópia e só aplica ao tocar em "Aplicar".
struct FilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var filter: TicketFilter
    let availableTags: [String]
    var onApply: (TicketFilter) -> Void

    @State private var usePeriod = false
    @State private var periodStart = Date()
    @State private var periodEnd = Date()
    @State private var useMonth = false
    @State private var month = YearMonth(CalendarDate(date: Date()))
    @State private var useTime = false
    @State private var timeStart = CalendarDate(date: Date()).date(at: ClockTime(hour: 6, minute: 0))
    @State private var timeEnd = CalendarDate(date: Date()).date(at: ClockTime(hour: 9, minute: 0))

    init(filter: TicketFilter, availableTags: [String], onApply: @escaping (TicketFilter) -> Void) {
        _filter = State(initialValue: filter)
        self.availableTags = availableTags
        self.onApply = onApply
        _usePeriod = State(initialValue: filter.dateFrom != nil || filter.dateTo != nil)
        _periodStart = State(initialValue: (filter.dateFrom ?? CalendarDate(date: Date()).adding(days: -30)).date())
        _periodEnd = State(initialValue: (filter.dateTo ?? CalendarDate(date: Date())).date())
        _useMonth = State(initialValue: filter.month != nil)
        _month = State(initialValue: filter.month ?? YearMonth(CalendarDate(date: Date())))
        _useTime = State(initialValue: filter.timeFrom != nil || filter.timeTo != nil)
        if let from = filter.timeFrom, let time = ClockTime(secondsOfDay: from * 60) {
            _timeStart = State(initialValue: CalendarDate(date: Date()).date(at: time))
        }
        if let to = filter.timeTo, let time = ClockTime(secondsOfDay: to * 60) {
            _timeEnd = State(initialValue: CalendarDate(date: Date()).date(at: time))
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Data do registro") {
                    Toggle("Período entre duas datas", isOn: $usePeriod)
                    if usePeriod {
                        DatePicker("De", selection: $periodStart, displayedComponents: .date)
                        DatePicker("Até", selection: $periodEnd, in: periodStart..., displayedComponents: .date)
                    }
                    Toggle("Mês e ano", isOn: $useMonth)
                    if useMonth {
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
                }

                Section("Horário registrado") {
                    Toggle("Faixa de horário", isOn: $useTime)
                    if useTime {
                        DatePicker("Das", selection: $timeStart, displayedComponents: .hourAndMinute)
                        DatePicker("Até", selection: $timeEnd, displayedComponents: .hourAndMinute)
                    }
                }

                Section("Tipo de marcação") {
                    ForEach(MarkType.allCases) { type in
                        Toggle(isOn: Binding(
                            get: { filter.markTypes.contains(type) },
                            set: { isOn in
                                if isOn { filter.markTypes.insert(type) } else { filter.markTypes.remove(type) }
                            }
                        )) {
                            Label(type.label, systemImage: type.symbol)
                        }
                    }
                }

                Section("Empresa e funcionário") {
                    TextField("Empresa ou CNPJ", text: $filter.company)
                    TextField("Funcionário ou matrícula", text: $filter.employee)
                }

                if !availableTags.isEmpty {
                    Section("Etiquetas") {
                        ForEach(availableTags, id: \.self) { tag in
                            Toggle(tag, isOn: Binding(
                                get: { filter.tags.contains(tag) },
                                set: { isOn in
                                    if isOn { filter.tags.insert(tag) } else { filter.tags.remove(tag) }
                                }
                            ))
                        }
                    }
                }

                Section("Situação") {
                    Toggle("Somente com informações incompletas", isOn: $filter.onlyIncomplete)
                    Toggle("Somente sinalizados para conferência", isOn: $filter.onlyFlagged)
                    Toggle("Somente com revisão pendente", isOn: $filter.onlyPendingReview)
                }

                Section {
                    Button("Limpar todos os filtros", role: .destructive) {
                        let text = filter.text
                        filter = TicketFilter()
                        filter.text = text
                        usePeriod = false
                        useMonth = false
                        useTime = false
                    }
                }
            }
            .navigationTitle("Filtros")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Aplicar") {
                        onApply(composedFilter())
                        dismiss()
                    }
                }
            }
        }
    }

    private func composedFilter() -> TicketFilter {
        var result = filter
        result.dateFrom = usePeriod ? CalendarDate(date: periodStart) : nil
        result.dateTo = usePeriod ? CalendarDate(date: periodEnd) : nil
        result.month = useMonth ? month : nil
        if useTime {
            let calendar = Calendar.current
            result.timeFrom = calendar.component(.hour, from: timeStart) * 60 + calendar.component(.minute, from: timeStart)
            result.timeTo = calendar.component(.hour, from: timeEnd) * 60 + calendar.component(.minute, from: timeEnd)
        } else {
            result.timeFrom = nil
            result.timeTo = nil
        }
        return result
    }
}

/// Pares de tickets possivelmente duplicados. O usuário decide o que fazer com cada um.
struct DuplicatesView: View {
    @Query private var tickets: [Ticket]

    var body: some View {
        let byID = Dictionary(uniqueKeysWithValues: tickets.map { ($0.id, $0) })
        let matches = DuplicateDetector.allMatches(in: tickets.map { $0.record() })
        List {
            Section {
                Text("Estes tickets têm dados ou imagens muito parecidos. Abra cada um para comparar. Se um deles for uma foto repetida, você pode excluí-lo na tela do ticket. Nada é excluído automaticamente.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(matches.enumerated()), id: \.offset) { _, match in
                Section {
                    ForEach([match.first, match.second], id: \.self) { id in
                        if let ticket = byID[id] {
                            NavigationLink(value: ticket.id) {
                                TicketRow(ticket: ticket)
                            }
                        }
                    }
                } header: {
                    Text(match.reasons.map(\.rawValue).joined(separator: " · "))
                } footer: {
                    if match.isStrong { Text("Indício forte de que é o mesmo comprovante.") }
                }
            }
        }
        .navigationTitle("Possíveis duplicidades")
        .overlay {
            if matches.isEmpty {
                ContentUnavailableView("Nenhuma duplicidade encontrada", systemImage: "checkmark.circle")
            }
        }
    }
}
