import SwiftUI
import UIKit

/// Recorte, rotação e realce antes do OCR. Trabalha numa cópia: o original é preservado.
struct ImageEditorView: View {
    let original: UIImage
    var onDone: (UIImage) -> Void

    @State private var quarterTurns = 0
    @State private var enhance = true
    @State private var cropRect = CGRect(x: 0, y: 0, width: 1, height: 1)
    @State private var preview: UIImage?
    @State private var isProcessing = false

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                if let preview {
                    CropOverlay(image: preview, cropRect: $cropRect)
                        .padding(20)
                } else {
                    ProgressView().tint(.white)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            VStack(spacing: 12) {
                Text("Arraste os cantos para enquadrar só o ticket.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                HStack(spacing: 12) {
                    toolButton("Girar à esquerda", systemImage: "rotate.left") { rotate(-1) }
                    toolButton("Girar à direita", systemImage: "rotate.right") { rotate(1) }
                    toolButton(enhance ? "Realce ativo" : "Realce", systemImage: enhance ? "wand.and.stars" : "wand.and.stars.inverse") {
                        enhance.toggle()
                    }
                    toolButton("Restaurar", systemImage: "arrow.counterclockwise") {
                        quarterTurns = 0
                        cropRect = CGRect(x: 0, y: 0, width: 1, height: 1)
                        enhance = true
                    }
                }
                Button {
                    finish()
                } label: {
                    Label(isProcessing ? "Preparando…" : "Reconhecer texto", systemImage: "text.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isProcessing || preview == nil)
            }
            .padding()
            .background(Color(.systemBackground))
        }
        .task(id: "\(quarterTurns)-\(enhance)") { await updatePreview() }
    }

    private func toolButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: systemImage).font(.title3)
                Text(title).font(.caption2).lineLimit(1).minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, minHeight: 52)
        }
        .buttonStyle(.bordered)
        .accessibilityLabel(title)
    }

    private func rotate(_ direction: Int) {
        quarterTurns += direction
        cropRect = CGRect(x: 0, y: 0, width: 1, height: 1)
    }

    /// Prévia em resolução reduzida (rápida); o processamento final usa a imagem inteira.
    @MainActor
    private func updatePreview() async {
        let source = original, turns = quarterTurns, enhance = enhance
        let image = await Task.detached(priority: .userInitiated) { () -> UIImage in
            let small = ImageProcessing.normalized(source, maxDimension: 1600)
            let rotated = ImageProcessing.rotated(small, quarterTurns: turns)
            return enhance ? ImageProcessing.enhanced(rotated) : rotated
        }.value
        preview = image
    }

    @MainActor
    private func finish() {
        isProcessing = true
        let source = original, turns = quarterTurns, rect = cropRect, enhance = enhance
        Task { @MainActor in
            let result = await Task.detached(priority: .userInitiated) { () -> UIImage in
                let rotated = ImageProcessing.rotated(source, quarterTurns: turns)
                let cropped = ImageProcessing.cropped(rotated, to: rect)
                return enhance ? ImageProcessing.enhanced(cropped) : cropped
            }.value
            isProcessing = false
            onDone(result)
        }
    }
}

/// Imagem com moldura de recorte ajustável pelos quatro cantos.
struct CropOverlay: View {
    let image: UIImage
    @Binding var cropRect: CGRect

    private enum Corner: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight

        var label: String {
            switch self {
            case .topLeft: return "Canto superior esquerdo"
            case .topRight: return "Canto superior direito"
            case .bottomLeft: return "Canto inferior esquerdo"
            case .bottomRight: return "Canto inferior direito"
            }
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let frame = fittedFrame(in: geometry.size)
            let crop = CGRect(x: frame.minX + cropRect.minX * frame.width,
                              y: frame.minY + cropRect.minY * frame.height,
                              width: cropRect.width * frame.width,
                              height: cropRect.height * frame.height)
            ZStack(alignment: .topLeading) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: frame.width, height: frame.height)
                    .position(x: frame.midX, y: frame.midY)
                    .accessibilityLabel("Prévia do ticket")

                Path { path in
                    path.addRect(frame)
                    path.addRect(crop)
                }
                .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
                .allowsHitTesting(false)

                Rectangle()
                    .stroke(Color.white, lineWidth: 2)
                    .frame(width: crop.width, height: crop.height)
                    .position(x: crop.midX, y: crop.midY)
                    .allowsHitTesting(false)

                ForEach(Corner.allCases, id: \.self) { corner in
                    Circle()
                        .fill(Color.white)
                        .frame(width: 26, height: 26)
                        .shadow(radius: 3)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                        .position(point(of: corner, in: crop))
                        .gesture(
                            DragGesture(coordinateSpace: .named("crop"))
                                .onChanged { value in move(corner, to: value.location, frame: frame) }
                        )
                        .accessibilityLabel(corner.label)
                }
            }
            .coordinateSpace(name: "crop")
        }
    }

    private func fittedFrame(in size: CGSize) -> CGRect {
        guard image.size.width > 0, image.size.height > 0 else { return .zero }
        let scale = min(size.width / image.size.width, size.height / image.size.height)
        let fitted = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return CGRect(x: (size.width - fitted.width) / 2, y: (size.height - fitted.height) / 2,
                      width: fitted.width, height: fitted.height)
    }

    private func point(of corner: Corner, in rect: CGRect) -> CGPoint {
        switch corner {
        case .topLeft: return CGPoint(x: rect.minX, y: rect.minY)
        case .topRight: return CGPoint(x: rect.maxX, y: rect.minY)
        case .bottomLeft: return CGPoint(x: rect.minX, y: rect.maxY)
        case .bottomRight: return CGPoint(x: rect.maxX, y: rect.maxY)
        }
    }

    private func move(_ corner: Corner, to location: CGPoint, frame: CGRect) {
        guard frame.width > 0, frame.height > 0 else { return }
        let x = min(max((location.x - frame.minX) / frame.width, 0), 1)
        let y = min(max((location.y - frame.minY) / frame.height, 0), 1)
        let minSize: CGFloat = 0.1
        var minX = cropRect.minX, minY = cropRect.minY, maxX = cropRect.maxX, maxY = cropRect.maxY
        switch corner {
        case .topLeft: minX = min(x, maxX - minSize); minY = min(y, maxY - minSize)
        case .topRight: maxX = max(x, minX + minSize); minY = min(y, maxY - minSize)
        case .bottomLeft: minX = min(x, maxX - minSize); maxY = max(y, minY + minSize)
        case .bottomRight: maxX = max(x, minX + minSize); maxY = max(y, minY + minSize)
        }
        cropRect = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}
