import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import PontoCore

/// Backup, restauração e exportação dos dados.
struct BackupView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.modelContext) private var context
    @Query private var tickets: [Ticket]

    @State private var exportURL: ExportTarget?
    @State private var shareItem: ShareItem?
    @State private var isWorking = false
    @State private var showRestorePicker = false
    @State private var restoreCandidate: RestoreCandidate?
    @State private var message: String?

    private struct ExportTarget: Identifiable {
        let id = UUID()
        let url: URL
        let isBackup: Bool
    }

    private struct RestoreCandidate: Identifiable {
        let id = UUID()
        let url: URL
        let manifest: BackupManifest
    }

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: statusIcon)
                        .font(.title)
                        .foregroundStyle(statusColor)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(statusTitle).font(.headline)
                        Text(statusDetail).font(.callout).foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            } header: {
                Text("Situação do backup")
            }

            Section {
                Button {
                    run { ExportTarget(url: try BackupService.createBackup(context: context, settings: settings), isBackup: true) }
                } label: {
                    Label("Fazer backup agora", systemImage: "externaldrive.badge.plus")
                }
                .disabled(tickets.isEmpty || isWorking)
                Picker("Lembrar de fazer backup a cada", selection: $settings.backupReminderDays) {
                    Text("7 dias").tag(7)
                    Text("15 dias").tag(15)
                    Text("30 dias").tag(30)
                }
            } header: {
                Text("Backup completo")
            } footer: {
                Text("Gera um arquivo .mpdbackup com todos os tickets, imagens originais e histórico. Você escolhe onde salvar: iCloud Drive, “No meu iPhone”, Google Drive, pen drive etc. Guarde-o em local seguro: o arquivo não tem senha.")
            }

            Section {
                Button {
                    showRestorePicker = true
                } label: {
                    Label("Restaurar de um backup", systemImage: "arrow.counterclockwise.circle")
                }
                .disabled(isWorking)
            } footer: {
                Text("A restauração só adiciona tickets que ainda não existem no app. Nenhum ticket existente é apagado ou substituído.")
            }

            Section {
                Button {
                    run {
                        ExportTarget(url: try ExportService.ticketsCSV(tickets.map { $0.record() }, name: "MeuPontoDigital-tickets.csv"), isBackup: false)
                    }
                } label: {
                    Label("Exportar planilha (CSV)", systemImage: "tablecells")
                }
                Button {
                    run { ExportTarget(url: try BackupService.createOpenExport(context: context), isBackup: false) }
                } label: {
                    Label("Exportar tudo em pasta (fotos + planilha + dados)", systemImage: "folder")
                }
            } header: {
                Text("Exportação")
            } footer: {
                Text("A pasta exportada pode ser aberta em qualquer computador, sem o app. Use-a para guardar uma cópia ou exercer seu direito de portabilidade (LGPD).")
            }

            Section {
                Label("Se o backup do iPhone (iCloud ou computador) estiver ativado nos Ajustes do iPhone, os dados do app também são incluídos nele. Esse backup restaura o iPhone inteiro; o backup do app permite guardar e restaurar só os comprovantes.", systemImage: "info.circle")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Backup e exportação")
        .overlay {
            if isWorking {
                ProgressView("Preparando arquivo…")
                    .padding()
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .sheet(item: $exportURL) { target in
            DocumentExportPicker(url: target.url) { saved in
                if saved, target.isBackup {
                    settings.lastBackupDate = Date()
                    message = "Backup salvo com sucesso."
                }
                exportURL = nil
            }
            .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showRestorePicker, allowedContentTypes: [.data, .item]) { result in
            switch result {
            case .success(let url):
                do {
                    restoreCandidate = RestoreCandidate(url: url, manifest: try BackupService.preview(url: url))
                } catch {
                    message = error.localizedDescription
                }
            case .failure:
                message = "Não foi possível abrir o arquivo."
            }
        }
        .confirmationDialog("Restaurar backup?", isPresented: Binding(get: { restoreCandidate != nil }, set: { if !$0 { restoreCandidate = nil } }),
                            titleVisibility: .visible, presenting: restoreCandidate) { candidate in
            Button("Restaurar \(candidate.manifest.tickets.count) ticket(s)") { restore(candidate) }
            Button("Cancelar", role: .cancel) {}
        } message: { candidate in
            Text("Backup criado em \(candidate.manifest.createdAt.shortDateTime) com \(candidate.manifest.tickets.count) ticket(s). Tickets que já existem no app serão mantidos como estão.")
        }
        .alert("Backup", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message ?? "")
        }
    }

    private var statusIcon: String {
        if tickets.isEmpty { return "tray" }
        return settings.backupIsOverdue() ? "exclamationmark.triangle.fill" : "checkmark.shield.fill"
    }

    private var statusColor: Color {
        if tickets.isEmpty { return .secondary }
        return settings.backupIsOverdue() ? .orange : .green
    }

    private var statusTitle: String {
        if tickets.isEmpty { return "Nada para copiar ainda" }
        guard settings.lastBackupDate != nil else { return "Nenhum backup feito" }
        return settings.backupIsOverdue() ? "Backup desatualizado" : "Backup em dia"
    }

    private var statusDetail: String {
        var lines = ["\(tickets.count) ticket(s) neste iPhone."]
        if let last = settings.lastBackupDate {
            lines.append("Último backup: \(last.shortDateTime).")
        } else {
            lines.append("Faça um backup para não perder seus comprovantes se o iPhone for perdido ou trocado.")
        }
        lines.append("Lembrete a cada \(settings.backupReminderDays) dias.")
        return lines.joined(separator: " ")
    }

    private func run(_ make: @escaping () throws -> ExportTarget) {
        isWorking = true
        Task { @MainActor in
            // Dá tempo para o indicador aparecer antes do trabalho pesado.
            try? await Task.sleep(nanoseconds: 100_000_000)
            do {
                exportURL = try make()
            } catch {
                message = "Não foi possível gerar o arquivo. (\(error.localizedDescription))"
            }
            isWorking = false
        }
    }

    private func restore(_ candidate: RestoreCandidate) {
        isWorking = true
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 100_000_000)
            do {
                let summary = try BackupService.restore(from: candidate.url, context: context, settings: settings)
                message = summary.message
            } catch {
                message = error.localizedDescription
            }
            isWorking = false
            restoreCandidate = nil
        }
    }
}
