import Foundation
@testable import PontoCore

/// Textos de comprovantes usados nos testes, simulando a saída do OCR para
/// diferentes modelos de relógio e qualidades de foto.
enum Fixtures {
    /// Modelo Portaria 671 (REP-C), foto nítida.
    static let portaria671 = """
    COMPROVANTE DE REGISTRO DE PONTO DO TRABALHADOR
    PADARIA BOM DIA LTDA
    CNPJ: 11.222.333/0001-81
    LOCAL: RUA DAS FLORES, 100 - SAO PAULO/SP
    REP: 00004000020005089
    NOME: JOÃO DA SILVA SANTOS
    PIS: 120.4567.890-5
    NSR: 000012345
    DATA: 22/10/2026 HORA: 08:01
    ENTRADA
    """

    /// Modelo antigo (Portaria 1510) com NSR e data/hora na mesma linha, sem tipo impresso.
    static let portaria1510 = """
    EMPREGADOR: COMERCIAL ALFA S/A
    CNPJ 11222333000181
    END: AV. BRASIL 500
    N° REP 0000100002000123
    EMPREGADO: MARIA OLIVEIRA
    PIS 12045678905
    NSR 000000987 22/10/26 12:03
    """

    /// Relógio convencional (ticket de empresa) com matrícula e tipo de intervalo.
    static let conventional = """
    Supermercado Preço Bom
    Funcionário: Ana Paula Souza
    Matrícula: 4521
    Saída para almoço
    23 OUT 2026   12h00
    Código de autenticação: A1B2-C3D4-E5F6
    Terminal: 03
    """

    /// Foto borrada: letras confundidas com dígitos e baixa confiança.
    static let blurry: [OCRLine] = [
        OCRLine(text: "COMPROVANTE DE REGISTRO DE PONTO", confidence: 0.6),
        OCRLine(text: "NOME: CARLOS PEREIRA", confidence: 0.5),
        OCRLine(text: "DATA: 2O/1O/2O26", confidence: 0.4),
        OCRLine(text: "HORA: O8:l5", confidence: 0.4),
        OCRLine(text: "RETORNO INTERVALO", confidence: 0.5)
    ]

    /// Ticket danificado: sem data legível.
    static let damaged = """
    COMPROVANTE DE REGISTRO
    NOME: JOSE
    HORA: 17:48
    SAÍDA
    """

    /// Ticket com cabeçalho "ENTRADA E SAÍDA" e duas datas diferentes.
    static let ambiguous = """
    REGISTRO DE ENTRADA E SAÍDA
    EMISSÃO: 01/11/2026 09:00
    DATA: 31/10/2026 HORA: 22:00
    """

    static func record(
        _ date: String?, _ time: String?, _ type: MarkType,
        company: String = "PADARIA BOM DIA LTDA", nsr: String = "", auth: String = "",
        hash: UInt64? = nil, journey: String? = nil, confirmed: Bool = true
    ) -> TicketRecord {
        TicketRecord(
            imageHash: hash,
            recordDate: date.flatMap { CalendarDate(key: $0) },
            recordTime: time.flatMap { ClockTime(string: $0) },
            markType: type,
            company: company,
            ticketNumber: nsr,
            authCode: auth,
            // Segundos inteiros: o backup grava datas em ISO 8601 sem fração.
            importedAt: Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded()),
            isConfirmed: confirmed,
            journeyDate: journey.flatMap { CalendarDate(key: $0) }
        )
    }
}
