import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import VisionKit
import UIKit

/// Origem da imagem do ticket.
enum CaptureSource: String, Identifiable {
    case camera, library, files
    var id: String { rawValue }
}

/// Imagem recebida, com os bytes originais preservados exatamente como chegaram.
struct ImportedImage: Identifiable {
    let id = UUID()
    let originalData: Data
    let fileExtension: String
    let originalFileName: String
    /// Cópia em orientação "para cima" usada na edição e no OCR.
    let image: UIImage

    init?(data: Data, fileExtension: String, originalFileName: String) {
        guard let decoded = UIImage(data: data) else { return nil }
        self.originalData = data
        self.fileExtension = fileExtension
        self.originalFileName = originalFileName
        self.image = ImageProcessing.normalized(decoded)
    }

    /// Fotos da câmera/scanner não têm arquivo de origem: gravamos um JPEG de alta qualidade.
    init?(cameraImage: UIImage, index: Int = 0) {
        let normalized = ImageProcessing.normalized(cameraImage)
        guard let data = normalized.jpegData(compressionQuality: 0.95) else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd-HHmmss"
        self.originalData = data
        self.fileExtension = "jpg"
        self.originalFileName = "Camera-\(formatter.string(from: Date()))\(index > 0 ? "-\(index + 1)" : "").jpg"
        self.image = normalized
    }
}

struct CaptureBatch: Identifiable {
    let id = UUID()
    var images: [ImportedImage]
}

/// Adiciona a qualquer tela a capacidade de fotografar/importar tickets.
/// Basta alterar `request` para iniciar o fluxo.
struct TicketCaptureModifier: ViewModifier {
    @Binding var request: CaptureSource?

    @State private var showCamera = false
    @State private var showPhotos = false
    @State private var showFiles = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pendingBatch: CaptureBatch?
    @State private var batch: CaptureBatch?
    @State private var isLoading = false
    @State private var errorMessage: String?

    func body(content: Content) -> some View {
        content
            .onChange(of: request) { _, source in
                guard let source else { return }
                request = nil
                switch source {
                case .camera:
                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        showCamera = true
                    } else {
                        errorMessage = "A câmera não está disponível neste aparelho. Use “Importar foto”."
                    }
                case .library: showPhotos = true
                case .files: showFiles = true
                }
            }
            .fullScreenCover(isPresented: $showCamera, onDismiss: presentPending) {
                CameraCaptureView { images in
                    let imported = images.enumerated().compactMap { ImportedImage(cameraImage: $0.element, index: $0.offset) }
                    if !imported.isEmpty { pendingBatch = CaptureBatch(images: imported) }
                    showCamera = false
                }
                .ignoresSafeArea()
            }
            .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 10,
                          selectionBehavior: .ordered, matching: .images, preferredItemEncoding: .current)
            .onChange(of: photoItems) { _, items in
                guard !items.isEmpty else { return }
                photoItems = []
                Task { await loadPhotos(items) }
            }
            .fileImporter(isPresented: $showFiles, allowedContentTypes: [.image], allowsMultipleSelection: true) { result in
                switch result {
                case .success(let urls): loadFiles(urls)
                case .failure: errorMessage = "Não foi possível abrir o arquivo escolhido."
                }
            }
            .fullScreenCover(item: $batch) { batch in
                CaptureFlowView(batch: batch)
            }
            .overlay {
                if isLoading {
                    ProgressView("Abrindo imagens…")
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .alert("Atenção", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
    }

    private func presentPending() {
        batch = pendingBatch
        pendingBatch = nil
    }

    @MainActor
    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        isLoading = true
        defer { isLoading = false }
        var images: [ImportedImage] = []
        var failures = 0
        for (index, item) in items.enumerated() {
            // `.current` mantém o formato original (HEIC/JPEG) sem recompressão.
            let type = item.supportedContentTypes.first
            let ext = type?.preferredFilenameExtension ?? "jpg"
            if let data = try? await item.loadTransferable(type: Data.self),
               let image = ImportedImage(data: data, fileExtension: ext,
                                         originalFileName: "Foto-da-galeria-\(Self.stamp())-\(index + 1).\(ext)") {
                images.append(image)
            } else {
                failures += 1
            }
        }
        if failures > 0 { errorMessage = "\(failures) imagem(ns) não puderam ser abertas." }
        if !images.isEmpty { batch = CaptureBatch(images: images) }
    }

    private func loadFiles(_ urls: [URL]) {
        var images: [ImportedImage] = []
        var failures = 0
        for url in urls {
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            if let data = try? Data(contentsOf: url),
               let image = ImportedImage(data: data, fileExtension: url.pathExtension, originalFileName: url.lastPathComponent) {
                images.append(image)
            } else {
                failures += 1
            }
        }
        if failures > 0 { errorMessage = "\(failures) arquivo(s) não são imagens compatíveis." }
        if !images.isEmpty { batch = CaptureBatch(images: images) }
    }

    private static func stamp() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd-HHmmss"
        return formatter.string(from: Date())
    }
}

extension View {
    func ticketCapture(request: Binding<CaptureSource?>) -> some View {
        modifier(TicketCaptureModifier(request: request))
    }
}

// MARK: - Câmera

/// Usa o scanner de documentos do iOS (detecta bordas e corrige a perspectiva) e,
/// se indisponível, a câmera comum.
struct CameraCaptureView: View {
    var onFinish: ([UIImage]) -> Void

    var body: some View {
        if VNDocumentCameraViewController.isSupported {
            DocumentScannerView(onFinish: onFinish)
        } else {
            CameraPicker(onFinish: onFinish)
        }
    }
}

struct DocumentScannerView: UIViewControllerRepresentable {
    var onFinish: ([UIImage]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let controller = VNDocumentCameraViewController()
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}

    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onFinish: ([UIImage]) -> Void

        init(onFinish: @escaping ([UIImage]) -> Void) {
            self.onFinish = onFinish
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            // Cada página digitalizada vira um ticket.
            onFinish((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
            onFinish([])
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
            onFinish([])
        }
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    var onFinish: ([UIImage]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: ([UIImage]) -> Void

        init(onFinish: @escaping ([UIImage]) -> Void) {
            self.onFinish = onFinish
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish([info[.originalImage] as? UIImage].compactMap { $0 })
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish([])
        }
    }
}
