import SwiftUI
import SwiftData
import PontoCore

struct TicketDetailView: View {
    @Bindable var ticket: Ticket
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var allTickets: [Ticket]

    @State private var showProcessed = false
    @State private var displayImage: UIImage?
    @State private var showFullImage = false
    @State private var editingDraft: TicketDraft?
    @State private var shareItem: ShareItem?
    @State private var confirmDelete = false
    @State private var errorMessage: String?

    private var imageFileName: String {
        showProcessed ? (ticket.processedImageFileName ?? ticket.imageFileName) : ticket.imageFileName
    }

    var body: some View {
        List {
            imageSection
            statusSection
            dataSection
            if !ticket.otherFields.isEmpty { otherFieldsSection }
            notesSection
            duplicatesSection
            ocrSection
            fileSection
            historySection
        }
        .listStyle(.insetGrouped)
        .navigationTitle(ticket.recordDate?.brazilian ?? "Ticket")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Editar") { startEditing() }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { share(.pdf) } label: { Label("Compartilhar PDF", systemImage: "doc.richtext") }
                    Button { share(.image) } label: { Label("Compartilhar foto original", systemImage: "photo") }
                    Button { printTicket() } label: { Label("Imprimir", systemImage: "printer") }
                    Divider()
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Excluir ticket", systemImage: "trash") }
                } label: {
                    Label("Mais opções", systemImage: "ellipsis.circle")
                }
            }
        }
        .task(id: imageFileName) {
            let name = imageFileName
            displayImage = await Task.detached(priority: .userInitiated) {
                ImageStore.shared.image(for: name)
            }.value
        }
        .fullScreenCover(isPresented: $showFullImage) {
            if let displayImage { ImageViewerScreen(image: displayImage) }
        }
        .sheet(item: $editingDraft) { draft in
            NavigationStack {
                TicketFormView(draft: draft, previewImage: displayImage, ocrText: ticket.ocrText, saveTitle: "Salvar") { confirmed in
                    saveEdit(draft, confirmed: confirmed)
                }
                .navigationTitle("Editar ticket")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { editingDraft = nil } }
                }
            }
        }
        .sheet(item: $shareItem) { item in
            ActivityView(items: [item.url])
                .presentationDetents([.medium, .large])
        }
        .confirmationDialog("Excluir este ticket?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Excluir ticket e imagem", role: .destructive) { deleteTicket() }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("A foto original e os dados serão apagados deste iPhone. Esta ação não pode ser desfeita. Backups já feitos não são alterados.")
        }
        .alert("Atenção", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: Seções

    private var imageSection: some View {
        Section {
            if ticket.processedImageFileName != nil {
                Picker("Imagem", selection: $showProcessed) {
                    Text("Original").tag(false)
                    Text("Tratada (usada no OCR)").tag(true)
                }
                .pickerStyle(.segmented)
            }
            Button {
                if displayImage != nil { showFullImage = true }
            } label: {
                Group {
                    if let displayImage {
                        Image(uiImage: displayImage)
                            .resizable()
                            .scaledToFit()
                    } else {
                        ProgressView().frame(height: 200)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: 360)
            }
            .accessibilityLabel("Ampliar foto do comprovante")
        } footer: {
            Text(showProcessed ? "Cópia recortada e realçada para leitura." : "Fotografia original, preservada sem alterações. Toque para ampliar.")
        }
    }

    private var statusSection: some View {
        Section {
            HStack {
                if ticket.isConfirmed {
                    Label("Revisão confirmada", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
                } else {
                    Label("Revisão pendente", systemImage: "clock.badge.questionmark").foregroundStyle(.orange)
                }
                Spacer()
                MarkTypeBadge(type: ticket.markType)
            }
            if !ticket.isConfirmed {
                Button {
                    startEditing()
                } label: {
                    Label("Conferir e confirmar dados", systemImage: "checkmark.circle")
                }
            }
            Button {
                toggleFlag()
            } label: {
                Label(ticket.isFlagged ? "Remover sinalização" : "Sinalizar para conferência",
                      systemImage: ticket.isFlagged ? "flag.slash" : "flag")
            }
            .tint(ticket.isFlagged ? .secondary : .red)
            if let journey = ticket.journeyDayKey.flatMap(CalendarDate.init(key:)), journey != ticket.recordDate {
                Label("Associado à jornada de \(journey.brazilian)", systemImage: "link")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var dataSection: some View {
        let confidences = ticket.fieldConfidences
        return Section("Dados do registro") {
            fieldRow(.date, value: ticket.recordDate.map { "\($0.brazilian) (\(PortugueseCalendar.weekdayNames[$0.weekday - 1]))" }, confidences)
            fieldRow(.time, value: ticket.recordTime?.formatted, confidences)
            fieldRow(.markType, value: ticket.markType == .indefinido ? nil : ticket.markType.label, confidences)
            fieldRow(.company, value: ticket.company, confidences)
            fieldRow(.cnpj, value: ticket.cnpj, confidences)
            fieldRow(.employeeName, value: ticket.employeeName, confidences)
            fieldRow(.employeeID, value: ticket.employeeID, confidences)
            fieldRow(.clockID, value: ticket.clockID, confidences)
            fieldRow(.ticketNumber, value: ticket.ticketNumber, confidences)
            fieldRow(.authCode, value: ticket.authCode, confidences)
        }
    }

    private func fieldRow(_ field: TicketField, value: String?, _ confidences: [String: Double]) -> some View {
        let text = (value?.isEmpty ?? true) ? nil : value
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(field.label).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if let confidence = confidences[field.rawValue] {
                    ConfidenceBadge(confidence: confidence)
                }
            }
            Text(text ?? "Não informado")
                .foregroundStyle(text == nil ? .secondary : .primary)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }

    private var otherFieldsSection: some View {
        Section("Outras informações do comprovante") {
            ForEach(Array(ticket.otherFields.enumerated()), id: \.offset) { _, field in
                LabeledContent(field.label, value: field.value)
            }
        }
    }

    private var notesSection: some View {
        Section("Observações e etiquetas") {
            if ticket.tags.isEmpty && ticket.notes.isEmpty {
                Button("Adicionar observação ou etiqueta") { startEditing() }
            }
            if !ticket.tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(ticket.tags, id: \.self) { tag in
                            Text(tag)
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.accentColor.opacity(0.15), in: Capsule())
                        }
                    }
                }
            }
            if !ticket.notes.isEmpty {
                Text(ticket.notes)
            }
        }
    }

    @ViewBuilder
    private var duplicatesSection: some View {
        let mine = ticket.record()
        let matches = DuplicateDetector.matches(for: mine, in: allTickets.map { $0.record() })
        if !matches.isEmpty {
            let byID = Dictionary(uniqueKeysWithValues: allTickets.map { ($0.id, $0) })
            Section {
                ForEach(matches, id: \.second) { match in
                    if let other = byID[match.second] {
                        NavigationLink(value: other.id) {
                            VStack(alignment: .leading, spacing: 4) {
                                TicketRow(ticket: other)
                                Text(match.reasons.map(\.rawValue).joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
            } header: {
                Label("Possível duplicidade", systemImage: "doc.on.doc")
            } footer: {
                Text("Compare as imagens. Se for uma foto repetida, exclua a que não quiser manter. Nada é apagado automaticamente.")
            }
        }
    }

    private var ocrSection: some View {
        Section {
            DisclosureGroup("Texto reconhecido pelo OCR") {
                Text(ticket.ocrText.isEmpty ? "(nenhum texto reconhecido)" : ticket.ocrText)
                    .font(.system(.footnote, design: .monospaced))
                    .textSelection(.enabled)
            }
        } footer: {
            Text("Texto preservado exatamente como reconhecido. Correções feitas por você ficam no histórico.")
        }
    }

    private var fileSection: some View {
        Section("Arquivo") {
            LabeledContent("Incluído em", value: ticket.importedAt.shortDateTime)
            LabeledContent("Arquivo original", value: ticket.originalFileName)
            LabeledContent("Confiança média do OCR", value: "\(Int((ticket.ocrConfidence * 100).rounded()))%")
        }
    }

    private var historySection: some View {
        Section("Histórico de alterações") {
            let changes = ticket.changes.sorted { $0.date > $1.date }
            if changes.isEmpty {
                Text("Nenhuma alteração.").foregroundStyle(.secondary)
            }
            ForEach(changes) { change in
                VStack(alignment: .leading, spacing: 2) {
                    Text(change.field).font(.subheadline.weight(.semibold))
                    Text("\(change.oldValue) → \(change.newValue)").font(.callout)
                    Text(change.date.shortDateTime).font(.caption).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    // MARK: Ações

    private func startEditing() {
        editingDraft = TicketDraft(record: ticket.record(includeDetails: true))
    }

    private func saveEdit(_ draft: TicketDraft, confirmed: Bool) {
        ticket.update(to: draft.makeRecord(confirmed: confirmed))
        persist()
        editingDraft = nil
    }

    private func toggleFlag() {
        var edited = ticket.record()
        edited.isFlagged.toggle()
        if edited.isFlagged, !edited.tags.contains("Divergência") { edited.tags.append("Divergência") }
        ticket.update(to: edited)
        persist()
    }

    private func persist() {
        do {
            try context.save()
        } catch {
            context.rollback()
            errorMessage = "Não foi possível salvar a alteração. (\(error.localizedDescription))"
        }
    }

    private enum ShareKind { case pdf, image }

    private func share(_ kind: ShareKind) {
        do {
            switch kind {
            case .pdf:
                shareItem = ShareItem(url: try ExportService.ticketPDF(ticket.record(includeDetails: true)))
            case .image:
                shareItem = ShareItem(url: ImageStore.shared.url(for: ticket.imageFileName))
            }
        } catch {
            errorMessage = "Não foi possível gerar o arquivo. (\(error.localizedDescription))"
        }
    }

    private func printTicket() {
        do {
            let url = try ExportService.ticketPDF(ticket.record(includeDetails: true))
            ExportService.printDocument(url: url, jobName: "Ticket \(ticket.displayDateTime)")
        } catch {
            errorMessage = "Não foi possível preparar a impressão. (\(error.localizedDescription))"
        }
    }

    private func deleteTicket() {
        let files = [ticket.imageFileName, ticket.processedImageFileName]
        let target = ticket
        let context = context
        // Sai da tela antes de excluir: uma tela exibindo um objeto já excluído pode falhar.
        dismiss()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            context.delete(target)
            do {
                try context.save()
                files.forEach { ImageStore.shared.delete($0) }
            } catch {
                // As imagens só são apagadas se a exclusão no banco der certo.
                context.rollback()
            }
        }
    }
}

// MARK: - Visualizador com zoom

struct ImageViewerScreen: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            ZoomableImageView(image: image)
                .ignoresSafeArea()
                .accessibilityLabel("Foto do comprovante. Use dois dedos para ampliar.")
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 32))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .padding()
            .accessibilityLabel("Fechar")
        }
    }
}

/// Zoom por pinça e toque duplo (UIScrollView).
struct ZoomableImageView: UIViewRepresentable {
    let image: UIImage

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scrollView = UIScrollView()
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 8
        scrollView.bouncesZoom = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.delegate = context.coordinator
        scrollView.backgroundColor = .black

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(imageView)
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            imageView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            imageView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            imageView.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
            imageView.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor)
        ])
        context.coordinator.imageView = imageView

        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scrollView.addGestureRecognizer(doubleTap)
        return scrollView
    }

    func updateUIView(_ scrollView: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

        @objc func doubleTapped(_ recognizer: UITapGestureRecognizer) {
            guard let scrollView = recognizer.view as? UIScrollView else { return }
            if scrollView.zoomScale > 1 {
                scrollView.setZoomScale(1, animated: true)
            } else {
                let point = recognizer.location(in: imageView)
                let size = CGSize(width: scrollView.bounds.width / 3, height: scrollView.bounds.height / 3)
                scrollView.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2,
                                           width: size.width, height: size.height), animated: true)
            }
        }
    }
}
