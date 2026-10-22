import XCTest
import UIKit
import CoreImage
import CoreImage.CIFilterBuiltins
import PontoCore
@testable import MeuPontoDigital

/// Pipeline real (imagem → Vision → interpretação) com tickets sintéticos.
/// Roda no simulador ou em aparelho; não usa internet.
final class OCRPipelineTests: XCTestCase {
    static let ticketText = """
    COMPROVANTE DE REGISTRO DE PONTO
    PADARIA BOM DIA LTDA
    CNPJ: 11.222.333/0001-81
    REP: 00004000020005089
    NOME: JOAO DA SILVA SANTOS
    PIS: 120.4567.890-5
    NSR: 000012345
    DATA: 22/10/2026 HORA: 08:01
    ENTRADA
    """

    /// Desenha um ticket de papel térmico (texto preto em fundo branco, fonte monoespaçada).
    static func renderTicket(_ text: String, fontSize: CGFloat = 28) -> UIImage {
        let lines = text.components(separatedBy: "\n")
        let font = UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
        let lineHeight = fontSize * 1.6
        let size = CGSize(width: 900, height: CGFloat(lines.count) * lineHeight + 80)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            for (index, line) in lines.enumerated() {
                (line as NSString).draw(at: CGPoint(x: 40, y: 40 + CGFloat(index) * lineHeight),
                                        withAttributes: [.font: font, .foregroundColor: UIColor.black])
            }
        }
    }

    private func recognize(_ image: UIImage) async throws -> ParsedTicket {
        let lines = try await OCRService.recognizeLines(in: try XCTUnwrap(image.cgImage))
        return TicketTextParser().parse(lines: lines)
    }

    func testSharpTicket() async throws {
        let parsed = try await recognize(Self.renderTicket(Self.ticketText))
        XCTAssertEqual(parsed.date?.value, CalendarDate(key: "2026-10-22"))
        XCTAssertEqual(parsed.time?.value, ClockTime(hour: 8, minute: 1))
        XCTAssertEqual(parsed.markType?.value, .entrada)
        XCTAssertEqual(parsed.cnpj?.value, "11.222.333/0001-81")
        XCTAssertEqual(parsed.ticketNumber?.value, "000012345")
    }

    func testRotatedTicketAfterUserRotation() async throws {
        let rotated = ImageProcessing.rotated(Self.renderTicket(Self.ticketText), quarterTurns: 1)
        // O usuário gira de volta no editor.
        let fixed = ImageProcessing.rotated(rotated, quarterTurns: -1)
        let parsed = try await recognize(fixed)
        XCTAssertEqual(parsed.date?.value, CalendarDate(key: "2026-10-22"))
    }

    /// Foto borrada/desbotada: o app pode não ler, mas nunca deve afirmar um valor errado sem pedir confirmação.
    func testBlurredFadedTicketNeverSilentlyWrong() async throws {
        let base = Self.renderTicket(Self.ticketText)
        let input = CIImage(cgImage: try XCTUnwrap(base.cgImage))
        let blur = CIFilter.gaussianBlur()
        blur.inputImage = input
        blur.radius = 2.2
        let fade = CIFilter.colorControls()
        fade.inputImage = blur.outputImage?.cropped(to: input.extent)
        fade.contrast = 0.35
        fade.brightness = 0.25
        let output = try XCTUnwrap(CIContext().createCGImage(try XCTUnwrap(fade.outputImage), from: input.extent))
        let degraded = UIImage(cgImage: output)

        let parsed = try await recognize(ImageProcessing.enhanced(degraded))
        if let date = parsed.date, date.value != CalendarDate(key: "2026-10-22") {
            XCTAssertTrue(parsed.needsConfirmation(.date), "data errada não pode passar como confirmada")
        }
        if let time = parsed.time, time.value != ClockTime(hour: 8, minute: 1) {
            XCTAssertTrue(parsed.needsConfirmation(.time), "horário errado não pode passar como confirmado")
        }
    }

    func testImageProcessingGeometryAndHash() throws {
        let image = Self.renderTicket(Self.ticketText)
        let rotated = ImageProcessing.rotated(image, quarterTurns: 1)
        XCTAssertEqual(rotated.size.width, image.size.height)
        let cropped = ImageProcessing.cropped(image, to: CGRect(x: 0, y: 0, width: 0.5, height: 0.5))
        XCTAssertEqual(cropped.size.width, (image.size.width / 2).rounded(), accuracy: 1)

        let hashA = try XCTUnwrap(ImageProcessing.differenceHash(of: image))
        let hashB = try XCTUnwrap(ImageProcessing.differenceHash(of: ImageProcessing.enhanced(image)))
        let other = try XCTUnwrap(ImageProcessing.differenceHash(of: Self.renderTicket("OUTRO\nTEXTO\nCOMPLETAMENTE\nDIFERENTE 99:99", fontSize: 60)))
        XCTAssertLessThanOrEqual(DifferenceHash.distance(hashA, hashB), DuplicateDetector.imageDistanceThreshold)
        XCTAssertGreaterThan(DifferenceHash.distance(hashA, other), DuplicateDetector.imageDistanceThreshold)
    }
}
