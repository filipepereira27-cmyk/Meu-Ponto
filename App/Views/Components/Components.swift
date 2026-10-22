import SwiftUI
import UIKit
import PontoCore

// MARK: - Indicadores

/// Nível de confiança do OCR. Usa texto e ícone, não só cor (acessibilidade).
struct ConfidenceBadge: View {
    let confidence: Double?

    private var level: (text: String, color: Color, icon: String) {
        guard let confidence else { return ("Não encontrado", .secondary, "questionmark.circle") }
        if confidence >= ParsedTicket.confirmationThreshold { return ("Alta", .green, "checkmark.circle.fill") }
        if confidence >= 0.6 { return ("Média", .orange, "exclamationmark.circle.fill") }
        return ("Baixa", .red, "exclamationmark.triangle.fill")
    }

    var body: some View {
        let current = level
        Label {
            if let confidence {
                Text("\(current.text) · \(Int((confidence * 100).rounded()))%")
            } else {
                Text(current.text)
            }
        } icon: {
            Image(systemName: current.icon)
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(current.color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(confidence == nil ? "Não encontrado pelo OCR" : "Confiança do OCR \(current.text)")
    }
}

extension MarkType {
    var symbol: String {
        switch self {
        case .entrada: return "figure.walk.arrival"
        case .saida: return "figure.walk.departure"
        case .inicioIntervalo: return "cup.and.saucer"
        case .fimIntervalo: return "arrow.uturn.backward"
        case .indefinido: return "questionmark"
        }
    }

    var color: Color {
        switch self {
        case .entrada: return .green
        case .saida: return .blue
        case .inicioIntervalo: return .orange
        case .fimIntervalo: return .purple
        case .indefinido: return .gray
        }
    }
}

struct MarkTypeBadge: View {
    let type: MarkType

    var body: some View {
        Label(type.label, systemImage: type.symbol)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(type.color.opacity(0.15), in: Capsule())
            .foregroundStyle(type.color)
    }
}

// MARK: - Miniatura e linha de ticket

struct TicketThumbnail: View {
    let fileName: String
    var size: CGFloat = 56
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "doc.text.image")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.secondarySystemBackground))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
        .task(id: fileName) {
            let name = fileName
            let pixels = size * displayScale
            image = await Task.detached(priority: .utility) {
                ImageStore.shared.thumbnail(for: name, maxPixelSize: pixels)
            }.value
        }
    }
}

struct TicketRow: View {
    let ticket: Ticket

    var body: some View {
        HStack(spacing: 12) {
            TicketThumbnail(fileName: ticket.processedImageFileName ?? ticket.imageFileName)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(ticket.recordTime?.formatted ?? "--:--")
                        .font(.title3.monospacedDigit().weight(.semibold))
                    Text(ticket.recordDate?.brazilian ?? "Sem data")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                MarkTypeBadge(type: ticket.markType)
                if !ticket.company.isEmpty {
                    Text(ticket.company)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if ticket.isFlagged {
                Image(systemName: "flag.fill")
                    .foregroundStyle(.red)
                    .accessibilityLabel("Sinalizado para conferência")
            } else if ticket.needsReview {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Precisa de revisão")
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Cartões

struct CardSection<Content: View>: View {
    let title: String
    var systemImage: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let systemImage {
                Label(title, systemImage: systemImage).font(.headline)
            } else {
                Text(title).font(.headline)
            }
            content
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }
}

/// Aviso destacado (pendências, duplicidades, estimativas).
struct NoticeView: View {
    let text: String
    var systemImage = "exclamationmark.triangle.fill"
    var tint: Color = .orange

    var body: some View {
        Label {
            Text(text).font(.callout)
        } icon: {
            Image(systemName: systemImage).foregroundStyle(tint)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Compartilhamento e exportação

struct ShareItem: Identifiable {
    let id = UUID()
    let url: URL
}

/// Folha de compartilhamento do iOS (o usuário escolhe para onde enviar).
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Salva uma cópia de um arquivo ou pasta em um local escolhido no app Arquivos
/// (iPhone, iCloud Drive, pen drive, Google Drive etc.).
struct DocumentExportPicker: UIViewControllerRepresentable {
    let url: URL
    var onComplete: (Bool) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onComplete: onComplete) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}

    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onComplete: (Bool) -> Void

        init(onComplete: @escaping (Bool) -> Void) {
            self.onComplete = onComplete
        }

        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            onComplete(true)
        }

        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            onComplete(false)
        }
    }
}

extension String {
    /// "outubro de 2026" -> "Outubro de 2026"
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}

extension Date {
    var shortDateTime: String {
        formatted(date: .abbreviated, time: .shortened)
    }
}
