import Foundation
import Vision
import CoreGraphics
import PontoCore

/// Reconhecimento de texto 100% no aparelho, com o framework Vision da Apple.
/// Nenhuma imagem é enviada para servidores.
enum OCRService {
    enum OCRError: LocalizedError {
        case invalidImage

        var errorDescription: String? {
            "Não foi possível ler esta imagem. Tente outra foto."
        }
    }

    /// Reconhece o texto e devolve as linhas de cima para baixo.
    ///
    /// Trechos na mesma altura (ex.: "DATA: 22/10/2026" e "HORA: 08:01" em colunas)
    /// são unidos em uma única linha, como aparecem no papel.
    static func recognizeLines(in image: CGImage) async throws -> [OCRLine] {
        try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["pt-BR", "en-US"]
            request.usesLanguageCorrection = true
            request.minimumTextHeight = 0.01

            let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
            try handler.perform([request])
            let observations = request.results ?? []
            return OCRService.mergeIntoLines(observations)
        }.value
    }

    private struct Fragment {
        var text: String
        var confidence: Double
        var box: CGRect
    }

    private static func mergeIntoLines(_ observations: [VNRecognizedTextObservation]) -> [OCRLine] {
        let fragments: [Fragment] = observations.compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            return Fragment(text: candidate.string, confidence: Double(candidate.confidence), box: observation.boundingBox)
        }
        // Coordenadas do Vision: origem no canto inferior esquerdo.
        let sorted = fragments.sorted { $0.box.midY > $1.box.midY }
        var rows: [[Fragment]] = []
        for fragment in sorted {
            if let last = rows.last?.last,
               abs(last.box.midY - fragment.box.midY) < min(last.box.height, fragment.box.height) * 0.5 {
                rows[rows.count - 1].append(fragment)
            } else {
                rows.append([fragment])
            }
        }
        return rows.map { row in
            let ordered = row.sorted { $0.box.minX < $1.box.minX }
            let confidence = ordered.map(\.confidence).reduce(0, +) / Double(ordered.count)
            return OCRLine(text: ordered.map(\.text).joined(separator: " "), confidence: confidence)
        }
    }
}
