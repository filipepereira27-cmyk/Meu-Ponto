import UIKit
import CoreImage
import CoreImage.CIFilterBuiltins
import PontoCore

/// Ajustes de imagem feitos antes do OCR. Operam sobre uma cópia: o arquivo original
/// do comprovante nunca é alterado.
enum ImageProcessing {
    private static let context = CIContext(options: [.useSoftwareRenderer: false])

    /// Redesenha a imagem com orientação "para cima" e escala 1 (pixels = pontos).
    static func normalized(_ image: UIImage, maxDimension: CGFloat = 4000) -> UIImage {
        let size = image.size
        let factor = min(1, maxDimension / max(size.width, size.height))
        let target = CGSize(width: (size.width * factor).rounded(), height: (size.height * factor).rounded())
        if image.imageOrientation == .up, image.scale == 1, factor == 1 { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    /// Gira em múltiplos de 90° (positivo = sentido horário).
    static func rotated(_ image: UIImage, quarterTurns: Int) -> UIImage {
        let turns = ((quarterTurns % 4) + 4) % 4
        guard turns != 0 else { return image }
        let size = turns % 2 == 0 ? image.size : CGSize(width: image.size.height, height: image.size.width)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            let cg = context.cgContext
            cg.translateBy(x: size.width / 2, y: size.height / 2)
            cg.rotate(by: CGFloat(turns) * .pi / 2)
            image.draw(in: CGRect(x: -image.size.width / 2, y: -image.size.height / 2,
                                  width: image.size.width, height: image.size.height))
        }
    }

    /// Recorta usando um retângulo normalizado (0...1) em relação à imagem.
    static func cropped(_ image: UIImage, to normalizedRect: CGRect) -> UIImage {
        let full = CGRect(origin: .zero, size: CGSize(width: 1, height: 1))
        let rect = normalizedRect.intersection(full)
        guard rect != full, !rect.isEmpty, let cgImage = image.cgImage else { return image }
        let pixelRect = CGRect(x: rect.minX * CGFloat(cgImage.width), y: rect.minY * CGFloat(cgImage.height),
                               width: rect.width * CGFloat(cgImage.width), height: rect.height * CGFloat(cgImage.height)).integral
        guard let croppedImage = cgImage.cropping(to: pixelRect) else { return image }
        return UIImage(cgImage: croppedImage, scale: 1, orientation: .up)
    }

    /// Melhora a legibilidade: tons de cinza, mais contraste e nitidez (papel térmico desbotado).
    static func enhanced(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let input = CIImage(cgImage: cgImage)

        let controls = CIFilter.colorControls()
        controls.inputImage = input
        controls.saturation = 0
        controls.contrast = 1.45
        controls.brightness = 0.04

        let sharpen = CIFilter.unsharpMask()
        sharpen.inputImage = controls.outputImage
        sharpen.radius = 2.0
        sharpen.intensity = 0.6

        guard let output = sharpen.outputImage,
              let result = context.createCGImage(output, from: input.extent) else { return image }
        return UIImage(cgImage: result, scale: 1, orientation: .up)
    }

    /// Hash perceptual (dHash) para detectar fotos repetidas do mesmo ticket.
    static func differenceHash(of image: UIImage) -> UInt64? {
        guard let cgImage = image.cgImage else { return nil }
        let width = DifferenceHash.width, height = DifferenceHash.height
        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(),
                                          bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            context.interpolationQuality = .medium
            context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? DifferenceHash.compute(grayscale: pixels) : nil
    }
}
