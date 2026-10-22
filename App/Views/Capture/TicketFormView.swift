import SwiftUI
import PontoCore

/// Formulário de revisão (novo ticket) e edição (ticket salvo).
///
/// Campos críticos (data, horário e tipo) com dúvida aparecem destacados e só deixam
/// confirmar a revisão depois de conferidos. O usuário sempre pode salvar como pendente.
struct TicketFormView: View {
    @Bindable var draft: TicketDraft
    var previewImage: UIImage?
    var ocrText: String?
    var saveTitle = "Salvar"
    var onSave: (_ confirmed: Bool) -> Void

    @State private var showFullImage = false

    var body: some View {
        Form {
            if let previewImage {
                Section {
                    Button {
                        showFullImage = true
                    } label: {
                        Image(uiImage: previewImage)
                            .resizable()
                            .scaledToFit()
                            .frame(maxHeight: 220)
                            .frame(maxWidth: .infinity)
                    }
                    .accessibilityLabel("Ampliar imagem do ticket")
                } footer: {
                    Text("Toque para ampliar e comparar com os dados abaixo.")
                }
            }

            if !draft.warnings.isEmpty {
                Section {
                    ForEach(draft.warnings, id: \.self) { warning in
                        NoticeView(text: warning)
                    }
                }
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
                .listRowBackground(Color.clear)
            }

            Section {
                criticalRow(.date) {
                    if draft.hasDate {
                        DatePicker("Data", selection: $draft.date, displayedComponents: .date)
                    } else {
                        Button("Informar data") { draft.hasDate = true }
                    }
                }
                criticalRow(.time) {
                    if draft.hasTime {
                        DatePicker("Horário", selection: $draft.time, displayedComponents: .hourAndMinute)
                            .environment(\.locale, Locale(identifier: "pt_BR"))
                    } else {
                        Button("Informar horário") { draft.hasTime = true }
                    }
                }
                criticalRow(.markType) {
                    Picker("Tipo", selection: $draft.markType) {
                        ForEach(MarkType.allCases) { type in
                            Label(type.label, systemImage: type.symbol).tag(type)
                        }
                    }
                }
            } header: {
                Text("Registro")
            } footer: {
                Text("O tipo de marcação nunca é deduzido pela ordem dos tickets. Use o que está impresso ou informe manualmente.")
            }
            .onChange(of: draft.date) { _, _ in draft.confirm(.date) }
            .onChange(of: draft.time) { _, _ in draft.confirm(.time) }
            .onChange(of: draft.markType) { _, newValue in
                if newValue != .indefinido { draft.confirm(.markType) }
            }

            Section("Empresa e funcionário") {
                textRow(.company, text: $draft.company)
                textRow(.cnpj, text: $draft.cnpj, keyboard: .asciiCapable)
                textRow(.employeeName, text: $draft.employeeName)
                textRow(.employeeID, text: $draft.employeeID, keyboard: .asciiCapable)
            }

            Section("Identificação do comprovante") {
                textRow(.clockID, text: $draft.clockID, keyboard: .asciiCapable)
                textRow(.ticketNumber, text: $draft.ticketNumber, keyboard: .asciiCapable)
                textRow(.authCode, text: $draft.authCode, keyboard: .asciiCapable)
            }

            Section("Organização") {
                TagEditor(tags: $draft.tags)
                Toggle(isOn: $draft.isFlagged) {
                    Label("Sinalizar para conferência", systemImage: "flag")
                }
                TextField("Observações pessoais", text: $draft.notes, axis: .vertical)
                    .lineLimit(2...6)
            }

            if let ocrText, !ocrText.isEmpty {
                Section {
                    DisclosureGroup("Texto reconhecido") {
                        Text(ocrText)
                            .font(.system(.footnote, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }
            }

            Section {
                if !draft.canConfirm {
                    ForEach(draft.confirmationBlockers, id: \.self) { blocker in
                        Label(blocker, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
                Button {
                    onSave(true)
                } label: {
                    Label("\(saveTitle) e confirmar", systemImage: "checkmark.seal.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!draft.canConfirm)

                Button {
                    onSave(false)
                } label: {
                    Label("\(saveTitle) para revisar depois", systemImage: "clock.badge.questionmark")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }
        .fullScreenCover(isPresented: $showFullImage) {
            if let previewImage {
                ImageViewerScreen(image: previewImage)
            }
        }
    }

    /// Linha de campo crítico: valor + confiança + botão de conferência.
    @ViewBuilder
    private func criticalRow<Content: View>(_ field: TicketField, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            content()
            HStack {
                ConfidenceBadge(confidence: draft.confidence(of: field))
                Spacer()
                if draft.needsConfirmation(field) {
                    Button {
                        draft.confirm(field)
                    } label: {
                        Label("Está correto", systemImage: "checkmark")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .tint(.orange)
                    .disabled(field == .markType && draft.markType == .indefinido
                              || field == .date && !draft.hasDate
                              || field == .time && !draft.hasTime)
                } else {
                    Label("Conferido", systemImage: "checkmark.seal")
                        .font(.caption)
                        .foregroundStyle(.green)
                }
            }
        }
        .padding(.vertical, 2)
        .listRowBackground(draft.needsConfirmation(field) ? Color.orange.opacity(0.10) : nil)
    }

    private func textRow(_ field: TicketField, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(field.label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if !text.wrappedValue.isEmpty || draft.confidence(of: field) != nil {
                    ConfidenceBadge(confidence: draft.confidence(of: field))
                }
            }
            TextField(field.label, text: text)
                .keyboardType(keyboard)
                .autocorrectionDisabled(keyboard == .asciiCapable)
                .textInputAutocapitalization(keyboard == .asciiCapable ? .characters : .words)
        }
    }
}

/// Etiquetas predefinidas e personalizadas.
struct TagEditor: View {
    static let suggested = ["Entrada", "Saída", "Intervalo", "Divergência"]
    @Binding var tags: [String]
    @State private var newTag = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Etiquetas").font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(Array(Set(Self.suggested + tags)).sorted(), id: \.self) { tag in
                        let selected = tags.contains(tag)
                        Button {
                            if selected { tags.removeAll { $0 == tag } } else { tags.append(tag) }
                        } label: {
                            Label(tag, systemImage: selected ? "checkmark" : "plus")
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(selected ? Color.accentColor.opacity(0.2) : Color(.tertiarySystemFill), in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }
            HStack {
                TextField("Nova etiqueta", text: $newTag)
                    .onSubmit(add)
                Button("Adicionar", action: add)
                    .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func add() {
        let tag = newTag.trimmingCharacters(in: .whitespaces)
        guard !tag.isEmpty, !tags.contains(tag) else { return }
        tags.append(tag)
        newTag = ""
    }
}
