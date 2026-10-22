import SwiftUI
import SwiftData
import PontoCore

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppLock.self) private var appLock
    @Environment(\.modelContext) private var context
    @Query private var tickets: [Ticket]

    @State private var confirmDeleteAll = false
    @State private var message: String?

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: Binding(
                        get: { settings.lockEnabled },
                        set: { newValue in Task { await setLock(newValue) } }
                    )) {
                        Label("Exigir \(appLock.biometryName)", systemImage: appLock.biometrySymbol)
                    }
                    .disabled(!appLock.deviceSupportsLock && !settings.lockEnabled)
                } header: {
                    Text("Segurança")
                } footer: {
                    if appLock.deviceSupportsLock {
                        Text("O app pede desbloqueio ao abrir e depois de 30 segundos em segundo plano. Se o \(appLock.biometryName) falhar, você pode usar o código do iPhone.")
                    } else {
                        Text("Configure um código no iPhone (Ajustes › Face ID e Código) para poder proteger o app.")
                    }
                }

                Section {
                    NavigationLink {
                        BackupView()
                    } label: {
                        HStack {
                            Label("Backup e exportação", systemImage: "externaldrive")
                            Spacer()
                            if settings.lastBackupDate == nil || settings.backupIsOverdue() {
                                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
                                    .accessibilityLabel("Backup pendente")
                            }
                        }
                    }
                } header: {
                    Text("Seus dados")
                } footer: {
                    if let last = settings.lastBackupDate {
                        Text("Último backup: \(last.shortDateTime).")
                    } else {
                        Text("Nenhum backup foi feito pelo app ainda.")
                    }
                }

                Section("Jornada de trabalho") {
                    Toggle(isOn: $settings.analysisEnabled) {
                        Label("Análise de jornada", systemImage: "chart.bar.doc.horizontal")
                    }
                    NavigationLink {
                        ScheduleSettingsView()
                    } label: {
                        Label("Jornada de referência", systemImage: "slider.horizontal.3")
                    }
                }

                Section("Privacidade") {
                    NavigationLink {
                        PrivacyPolicyView()
                    } label: {
                        Label("Política de privacidade", systemImage: "hand.raised")
                    }
                    NavigationLink {
                        StorageInfoView(ticketCount: tickets.count)
                    } label: {
                        Label("Onde meus dados ficam", systemImage: "iphone")
                    }
                    Button(role: .destructive) {
                        confirmDeleteAll = true
                    } label: {
                        Label("Apagar todos os dados", systemImage: "trash")
                    }
                    .disabled(tickets.isEmpty)
                }

                Section("Sobre") {
                    LabeledContent("Versão", value: BackupService.appVersion)
                    LabeledContent("Reconhecimento de texto", value: "No aparelho (Apple Vision)")
                    LabeledContent("Anúncios e rastreamento", value: "Nenhum")
                }
            }
            .navigationTitle("Ajustes")
            .confirmationDialog("Apagar todos os \(tickets.count) tickets?", isPresented: $confirmDeleteAll, titleVisibility: .visible) {
                Button("Apagar tudo deste iPhone", role: .destructive) { Task { await deleteAll() } }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Fotos, dados e histórico serão apagados deste iPhone. Arquivos de backup que você salvou em outros locais não são afetados. Recomendamos fazer um backup antes.")
            }
            .alert("Ajustes", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(message ?? "")
            }
        }
    }

    @MainActor
    private func setLock(_ enabled: Bool) async {
        // Confirma a identidade antes de mudar a proteção.
        guard await appLock.confirmOwner(reason: enabled ? "Ativar a proteção do app" : "Desativar a proteção do app") else { return }
        settings.lockEnabled = enabled
    }

    @MainActor
    private func deleteAll() async {
        guard await appLock.confirmOwner(reason: "Apagar todos os comprovantes do app") else { return }
        let files = tickets.flatMap { [$0.imageFileName, $0.processedImageFileName] }
        do {
            // Exclusão um a um para aplicar a regra de cascata (histórico de alterações).
            for ticket in tickets { context.delete(ticket) }
            try context.save()
            files.forEach { ImageStore.shared.delete($0) }
            message = "Todos os dados foram apagados deste iPhone."
        } catch {
            context.rollback()
            message = "Não foi possível apagar os dados. Nada foi alterado. (\(error.localizedDescription))"
        }
    }
}

/// Jornada de referência usada apenas para comparação na análise.
struct ScheduleSettingsView: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        Form {
            Section {
                ForEach(0..<7, id: \.self) { index in
                    Stepper(value: Binding(
                        get: { settings.schedule.expectedMinutesByWeekday[index] },
                        set: { settings.schedule.expectedMinutesByWeekday[index] = $0 }
                    ), in: 0...(14 * 60), step: 30) {
                        HStack {
                            Text(PortugueseCalendar.weekdayNames[index].capitalizedFirst)
                            Spacer()
                            let minutes = settings.schedule.expectedMinutesByWeekday[index]
                            Text(minutes == 0 ? "Folga" : DurationFormatter.string(minutes: minutes))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text("Horas previstas por dia")
            } footer: {
                Text("Informe a jornada do seu contrato ou acordo. Ela serve só como referência para comparar com os tickets.")
            }

            Section {
                Stepper(value: Binding(get: { settings.schedule.minimumBreakMinutes },
                                       set: { settings.schedule.minimumBreakMinutes = $0 }),
                        in: 0...180, step: 15) {
                    LabeledContent("Intervalo de referência", value: DurationFormatter.string(minutes: settings.schedule.minimumBreakMinutes))
                }
                Stepper(value: Binding(get: { settings.schedule.breakRequiredAfterMinutes },
                                       set: { settings.schedule.breakRequiredAfterMinutes = $0 }),
                        in: 0...(12 * 60), step: 30) {
                    LabeledContent("Intervalo esperado acima de", value: DurationFormatter.string(minutes: settings.schedule.breakRequiredAfterMinutes))
                }
            } header: {
                Text("Intervalo")
            } footer: {
                Text("Usado apenas para destacar dias que merecem conferência. Regras de intervalo variam conforme contrato, convenção coletiva e legislação.")
            }

            Section {
                Button("Restaurar padrão (8h de segunda a sexta)") {
                    settings.schedule = .standard
                }
            }
        }
        .navigationTitle("Jornada de referência")
    }
}
