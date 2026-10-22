import SwiftUI
import SwiftData
import PontoCore

struct HomeView: View {
    @Environment(AppNavigation.self) private var navigation
    @Environment(AppSettings.self) private var settings
    @Query(sort: \Ticket.importedAt, order: .reverse) private var tickets: [Ticket]

    @State private var captureRequest: CaptureSource?
    @State private var searchText = ""
    @State private var duplicateCount = 0

    private var pendingCount: Int { tickets.filter { !$0.isConfirmed }.count }
    private var incompleteCount: Int {
        tickets.filter { $0.recordDayKey == nil || $0.recordTimeText == nil || $0.markType == .indefinido }.count
    }
    private var flaggedCount: Int { tickets.filter(\.isFlagged).count }

    private var recentDays: [CalendarDate] {
        Array(Set(tickets.compactMap(\.recordDate))).sorted(by: >).prefix(7).map { $0 }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    searchField
                    summaryRow
                    alerts
                    recentTickets
                    recentDaysSection
                }
                .padding()
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Meu Ponto Digital")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        navigation.selectedTab = .calendar
                    } label: {
                        Label("Calendário", systemImage: "calendar")
                    }
                }
            }
            // Ações principais fixas na parte de baixo: alcançáveis com o polegar.
            .safeAreaInset(edge: .bottom) { captureButtons }
            .navigationDestination(for: UUID.self) { TicketDetailLoader(id: $0) }
            .navigationDestination(for: CalendarDate.self) { DayDetailView(day: $0) }
            .ticketCapture(request: $captureRequest)
            .task(id: tickets.count) {
                duplicateCount = DuplicateDetector.allMatches(in: tickets.map { $0.record() }).count
            }
        }
    }

    private var captureButtons: some View {
        VStack(spacing: 10) {
            Button {
                captureRequest = .camera
            } label: {
                Label("Fotografar ticket", systemImage: "camera.fill")
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 34)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            HStack(spacing: 10) {
                Button {
                    captureRequest = .library
                } label: {
                    Label("Importar foto", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
                Button {
                    captureRequest = .files
                } label: {
                    Label("Arquivos", systemImage: "folder")
                        .frame(maxWidth: .infinity, minHeight: 28)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private var searchField: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Buscar por data, horário ou texto", text: $searchText)
                .submitLabel(.search)
                .onSubmit {
                    let text = searchText
                    searchText = ""
                    navigation.search(text)
                }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var summaryRow: some View {
        HStack(spacing: 12) {
            StatTile(value: "\(tickets.count)", title: tickets.count == 1 ? "ticket arquivado" : "tickets arquivados",
                     systemImage: "doc.text.fill", tint: .accentColor)
            StatTile(value: "\(pendingCount)", title: "para revisar", systemImage: "exclamationmark.circle.fill",
                     tint: pendingCount > 0 ? .orange : .green)
        }
    }

    @ViewBuilder
    private var alerts: some View {
        let showBackup = !tickets.isEmpty && settings.backupIsOverdue()
        if pendingCount + incompleteCount + flaggedCount + duplicateCount > 0 || showBackup {
            CardSection(title: "Precisa da sua atenção", systemImage: "bell.badge") {
                if pendingCount > 0 {
                    alertButton("\(pendingCount) ticket(s) com revisão pendente", systemImage: "checkmark.seal") {
                        var filter = TicketFilter()
                        filter.onlyPendingReview = true
                        navigation.showArchive(with: filter)
                    }
                }
                if incompleteCount > 0 {
                    alertButton("\(incompleteCount) com data, horário ou tipo ausente", systemImage: "questionmark.square.dashed") {
                        var filter = TicketFilter()
                        filter.onlyIncomplete = true
                        navigation.showArchive(with: filter)
                    }
                }
                if flaggedCount > 0 {
                    alertButton("\(flaggedCount) sinalizado(s) para conferência", systemImage: "flag") {
                        var filter = TicketFilter()
                        filter.onlyFlagged = true
                        navigation.showArchive(with: filter)
                    }
                }
                if duplicateCount > 0 {
                    NavigationLink {
                        DuplicatesView()
                    } label: {
                        HStack {
                            Label("\(duplicateCount) possível(is) duplicidade(s)", systemImage: "doc.on.doc")
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.vertical, 4)
                    Text("Abra os tickets marcados para decidir. Nada é apagado automaticamente.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if showBackup {
                    alertButton(settings.lastBackupDate == nil ? "Você ainda não fez backup" : "Último backup há mais de \(settings.backupReminderDays) dias",
                                systemImage: "externaldrive.badge.exclamationmark") {
                        navigation.selectedTab = .settings
                    }
                }
            }
        }
    }

    private func alertButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Label(title, systemImage: systemImage)
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var recentTickets: some View {
        CardSection(title: "Adicionados recentemente", systemImage: "clock.arrow.circlepath") {
            if tickets.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Nenhum ticket ainda.")
                        .font(.body.weight(.medium))
                    Text("Toque em “Fotografar ticket” e enquadre o comprovante inteiro, com boa luz. O texto é reconhecido no próprio iPhone.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(tickets.prefix(5)) { ticket in
                    NavigationLink(value: ticket.id) {
                        TicketRow(ticket: ticket)
                    }
                    .buttonStyle(.plain)
                    if ticket.id != tickets.prefix(5).last?.id { Divider() }
                }
                Button("Ver todos") { navigation.showArchive(with: TicketFilter()) }
                    .font(.callout.weight(.semibold))
            }
        }
    }

    @ViewBuilder
    private var recentDaysSection: some View {
        if !recentDays.isEmpty {
            CardSection(title: "Últimos dias com tickets", systemImage: "calendar") {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(recentDays, id: \.self) { day in
                            NavigationLink(value: day) {
                                VStack(spacing: 2) {
                                    Text(PortugueseCalendar.weekdayShort[day.weekday - 1]).font(.caption)
                                    Text("\(day.day)").font(.title2.bold())
                                    Text(PortugueseCalendar.monthAbbreviations[day.month - 1].capitalized).font(.caption)
                                    Text("\(tickets.filter { $0.recordDayKey == day.key }.count)")
                                        .font(.caption2.weight(.semibold))
                                        .padding(.horizontal, 6)
                                        .background(Color.accentColor.opacity(0.2), in: Capsule())
                                }
                                .frame(width: 64, height: 96)
                                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(day.brazilian), \(tickets.filter { $0.recordDayKey == day.key }.count) tickets")
                        }
                    }
                }
            }
        }
    }
}

struct StatTile: View {
    let value: String
    let title: String
    let systemImage: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage).foregroundStyle(tint)
            Text(value).font(.largeTitle.bold().monospacedDigit())
            Text(title).font(.footnote).foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

/// Carrega um ticket pelo ID (usado na navegação por valor).
struct TicketDetailLoader: View {
    @Query private var tickets: [Ticket]

    init(id: UUID) {
        _tickets = Query(filter: #Predicate<Ticket> { $0.id == id })
    }

    var body: some View {
        if let ticket = tickets.first {
            TicketDetailView(ticket: ticket)
        } else {
            ContentUnavailableView("Ticket não encontrado", systemImage: "doc.questionmark",
                                   description: Text("Ele pode ter sido excluído."))
        }
    }
}
