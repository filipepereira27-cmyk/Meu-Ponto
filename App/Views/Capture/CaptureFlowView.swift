import SwiftUI
import SwiftData
import PontoCore

/// Fluxo de inclusão: ajustar imagem → reconhecer texto → revisar → salvar.
/// Processa um ou vários tickets em sequência.
struct CaptureFlowView: View {
    let batch: CaptureBatch

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query private var existingTickets: [Ticket]

    @State private var index = 0
    @State private var stage: Stage = .editing
    @State private var savedCount = 0
    @State private var duplicateAlert: DuplicateAlert?
    @State private var errorMessage: String?
    @State private var confirmCancel = false

    private enum Stage {
        case editing
        case processing
        case review(TicketDraft, UIImage, ParsedTicket)
        case failed(String, UIImage)
    }

    private struct DuplicateAlert: Identifiable {
        let id = UUID()
        let confirmed: Bool
        let description: String
    }

    private var current: ImportedImage { batch.images[index] }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(batch.images.count > 1 ? "Ticket \(index + 1) de \(batch.images.count)" : "Novo ticket")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancelar") { confirmCancel = true }
                    }
                    if batch.images.count > 1 {
                        ToolbarItem(placement: .primaryAction) {
                            Button("Pular") { advance() }
                        }
                    }
                }
        }
        .interactiveDismissDisabled()
        .confirmationDialog("Descartar este ticket?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Descartar e sair", role: .destructive) { dismiss() }
            Button("Continuar revisando", role: .cancel) {}
        } message: {
            Text(savedCount > 0 ? "\(savedCount) ticket(s) já foram salvos. O ticket atual não será salvo." : "A imagem e os dados reconhecidos não serão salvos.")
        }
        .alert(item: $duplicateAlert) { alert in
            Alert(
                title: Text("Possível duplicidade"),
                message: Text(alert.description + "\n\nNada será apagado automaticamente. Você decide."),
                primaryButton: .default(Text("Salvar mesmo assim")) { save(confirmed: alert.confirmed, skipDuplicateCheck: true) },
                secondaryButton: .cancel(Text("Voltar e revisar"))
            )
        }
        .alert("Não foi possível salvar", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    @ViewBuilder
    private var content: some View {
        switch stage {
        case .editing:
            ImageEditorView(original: current.image) { processed in
                Task { await recognize(processed) }
            }
            .id(index)
        case .processing:
            VStack(spacing: 16) {
                ProgressView()
                    .controlSize(.large)
                Text("Reconhecendo o texto no aparelho…")
                    .font(.headline)
                Text("Nenhuma imagem é enviada para a internet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .review(let draft, let processed, let parsed):
            TicketFormView(draft: draft, previewImage: processed, ocrText: parsed.fullText) { confirmed in
                save(confirmed: confirmed, skipDuplicateCheck: false)
            }
        case .failed(let message, let processed):
            ContentUnavailableView {
                Label("Texto não reconhecido", systemImage: "text.badge.xmark")
            } description: {
                Text(message)
            } actions: {
                Button("Ajustar a imagem novamente") { stage = .editing }
                    .buttonStyle(.borderedProminent)
                Button("Preencher manualmente") {
                    var parsed = ParsedTicket()
                    parsed.warnings = ["Preenchimento manual: confira os dados com o comprovante."]
                    stage = .review(TicketDraft(parsed: parsed), processed, parsed)
                }
            }
        }
    }

    @MainActor
    private func recognize(_ processed: UIImage) async {
        stage = .processing
        do {
            guard let cgImage = processed.cgImage else { throw OCRService.OCRError.invalidImage }
            let lines = try await OCRService.recognizeLines(in: cgImage)
            let parsed = TicketTextParser().parse(lines: lines)
            if lines.isEmpty {
                stage = .failed("Nenhum texto foi encontrado. Fotografe com boa luz, sem reflexo, e enquadre o ticket inteiro.", processed)
                return
            }
            let draft = TicketDraft(parsed: parsed)
            draft.imageHash = ImageProcessing.differenceHash(of: processed)
            stage = .review(draft, processed, parsed)
        } catch {
            stage = .failed("O reconhecimento falhou: \(error.localizedDescription)", processed)
        }
    }

    private func save(confirmed: Bool, skipDuplicateCheck: Bool) {
        guard case .review(let draft, let processed, let parsed) = stage else { return }
        var record = draft.makeRecord(confirmed: confirmed)

        if !skipDuplicateCheck {
            let matches = DuplicateDetector.matches(for: record, in: existingTickets.map { $0.record() })
            if !matches.isEmpty {
                let byID = Dictionary(uniqueKeysWithValues: existingTickets.map { ($0.id, $0) })
                let lines = matches.prefix(3).map { match -> String in
                    let other = byID[match.second].map { $0.displayDateTime } ?? "outro ticket"
                    return "• \(other): " + match.reasons.map(\.rawValue).joined(separator: "; ")
                }
                duplicateAlert = DuplicateAlert(confirmed: confirmed,
                                                description: "Este ticket parece já estar arquivado:\n" + lines.joined(separator: "\n"))
                return
            }
        }

        let id = UUID()
        var savedFiles: [String] = []
        do {
            let originalName = try ImageStore.shared.save(current.originalData, id: id, kind: .original,
                                                          fileExtension: current.fileExtension)
            savedFiles.append(originalName)
            var processedName: String?
            if let data = processed.jpegData(compressionQuality: 0.9) {
                processedName = try ImageStore.shared.save(data, id: id, kind: .processed, fileExtension: "jpg")
                savedFiles.append(processedName!)
            }

            let now = Date()
            record.id = id
            record.importedAt = now
            record.originalFileName = current.originalFileName
            record.imageFileName = originalName
            record.processedImageFileName = processedName

            // Histórico: inclusão + correções feitas na revisão em relação ao OCR.
            var ocrBaseline = TicketRecord(parsed: parsed, id: id, importedAt: now)
            ocrBaseline.imageHash = record.imageHash
            record.changes = [ChangeEntry(date: now, field: "Inclusão", oldValue: "—",
                                          newValue: "Digitalizado (\(current.originalFileName)) e reconhecido por OCR")]
                + ChangeTracker.diff(from: ocrBaseline, to: record, at: now)

            Ticket.insert(record, into: context)
            try context.save()
            savedCount += 1
            advance()
        } catch {
            context.rollback()
            savedFiles.forEach { ImageStore.shared.delete($0) }
            errorMessage = "O ticket não foi salvo. Verifique o espaço livre no iPhone e tente novamente. (\(error.localizedDescription))"
        }
    }

    private func advance() {
        if index + 1 < batch.images.count {
            index += 1
            stage = .editing
        } else {
            dismiss()
        }
    }
}
