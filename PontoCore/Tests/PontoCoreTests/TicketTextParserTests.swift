import XCTest
@testable import PontoCore

final class TicketTextParserTests: XCTestCase {
    let parser = TicketTextParser(acceptedYears: 2000...2027)

    func testPortaria671ExtractsAllFields() {
        let result = parser.parse(text: Fixtures.portaria671, confidence: 0.98)
        XCTAssertEqual(result.company?.value, "PADARIA BOM DIA LTDA")
        XCTAssertEqual(result.cnpj?.value, "11.222.333/0001-81")
        XCTAssertEqual(result.clockID?.value, "00004000020005089")
        XCTAssertEqual(result.employeeName?.value, "JOÃO DA SILVA SANTOS")
        XCTAssertEqual(result.employeeID?.value, "120.4567.890-5")
        XCTAssertEqual(result.employeeID?.note, "PIS válido")
        XCTAssertEqual(result.ticketNumber?.value, "000012345")
        XCTAssertEqual(result.date?.value, CalendarDate(year: 2026, month: 10, day: 22))
        XCTAssertEqual(result.time?.value, ClockTime(hour: 8, minute: 1))
        XCTAssertEqual(result.markType?.value, .entrada)
        XCTAssertTrue(result.criticalFieldsNeedingConfirmation.isEmpty, "\(result.criticalFieldsNeedingConfirmation)")
        // Informações sem campo próprio são preservadas em "outras informações".
        XCTAssertEqual(result.otherFields, [LabeledValue(label: "LOCAL", value: "RUA DAS FLORES, 100 - SAO PAULO/SP")])
    }

    func testPortaria1510WithoutPrintedTypeRequiresConfirmation() {
        let result = parser.parse(text: Fixtures.portaria1510, confidence: 0.95)
        XCTAssertEqual(result.company?.value, "COMERCIAL ALFA S/A")
        XCTAssertEqual(result.cnpj?.value, "11.222.333/0001-81")
        XCTAssertEqual(result.clockID?.value, "0000100002000123")
        XCTAssertEqual(result.employeeName?.value, "MARIA OLIVEIRA")
        XCTAssertEqual(result.ticketNumber?.value, "000000987")
        XCTAssertEqual(result.date?.value, CalendarDate(year: 2026, month: 10, day: 22))
        XCTAssertEqual(result.time?.value, ClockTime(hour: 12, minute: 3))
        // Tipo não impresso: nunca presumir.
        XCTAssertNil(result.markType)
        XCTAssertEqual(result.criticalFieldsNeedingConfirmation, [.markType])
        XCTAssertTrue(result.otherFields.contains(LabeledValue(label: "END", value: "AV. BRASIL 500")))
    }

    func testConventionalTicketWithMonthNameAndIntervalType() {
        let result = parser.parse(text: Fixtures.conventional, confidence: 0.97)
        XCTAssertEqual(result.employeeName?.value, "Ana Paula Souza")
        XCTAssertEqual(result.employeeID?.value, "4521")
        XCTAssertEqual(result.markType?.value, .inicioIntervalo, "'Saída para almoço' é início de intervalo, não saída")
        XCTAssertEqual(result.date?.value, CalendarDate(year: 2026, month: 10, day: 23))
        XCTAssertEqual(result.time?.value, ClockTime(hour: 12, minute: 0))
        XCTAssertEqual(result.authCode?.value, "A1B2-C3D4-E5F6")
        XCTAssertEqual(result.clockID?.value, "03")
        XCTAssertEqual(result.company?.value, "Supermercado Preço Bom")
        XCTAssertNotNil(result.company?.note, "empresa sem rótulo deve ser marcada para conferência")
    }

    func testBlurryTicketCorrectsDigitsButAsksForConfirmation() {
        let result = parser.parse(lines: Fixtures.blurry)
        XCTAssertEqual(result.date?.value, CalendarDate(year: 2026, month: 10, day: 20))
        XCTAssertEqual(result.time?.value, ClockTime(hour: 8, minute: 15))
        XCTAssertEqual(result.markType?.value, .fimIntervalo)
        XCTAssertNotNil(result.date?.note)
        XCTAssertEqual(Set(result.criticalFieldsNeedingConfirmation), [.date, .time, .markType])
    }

    func testDamagedTicketReportsMissingDate() {
        let result = parser.parse(text: Fixtures.damaged, confidence: 0.9)
        XCTAssertNil(result.date)
        XCTAssertEqual(result.time?.value, ClockTime(hour: 17, minute: 48))
        XCTAssertEqual(result.markType?.value, .saida)
        XCTAssertTrue(result.needsConfirmation(.date))
        XCTAssertTrue(result.warnings.contains("Data do registro não encontrada."))
    }

    func testAmbiguousTicketNeverAssumes() {
        let result = parser.parse(text: Fixtures.ambiguous, confidence: 0.99)
        // O cabeçalho "ENTRADA E SAÍDA" não define o tipo.
        XCTAssertNil(result.markType)
        // A linha rotulada "DATA" tem preferência, mas há duas datas: exige confirmação.
        XCTAssertEqual(result.date?.value, CalendarDate(year: 2026, month: 10, day: 31))
        XCTAssertEqual(result.time?.value, ClockTime(hour: 22, minute: 0))
        XCTAssertTrue(result.needsConfirmation(.date))
        XCTAssertTrue(result.needsConfirmation(.time))
        XCTAssertTrue(result.warnings.contains { $0.hasPrefix("Data:") })
    }

    func testConflictingMarkTypesBecomeUndefined() {
        let result = parser.parse(text: "ENTRADA\nDATA 01/10/2026 07:58\nSAIDA", confidence: 1)
        XCTAssertEqual(result.markType?.value, .indefinido)
        XCTAssertTrue(result.needsConfirmation(.markType))
    }

    func testDateFormatsVariety() {
        let cases: [(String, CalendarDate)] = [
            ("05/03/2026", CalendarDate(year: 2026, month: 3, day: 5)!),
            ("5-3-26", CalendarDate(year: 2026, month: 3, day: 5)!),
            ("05.03.2026", CalendarDate(year: 2026, month: 3, day: 5)!),
            ("2026-03-05", CalendarDate(year: 2026, month: 3, day: 5)!),
            ("05 de março de 2026", CalendarDate(year: 2026, month: 3, day: 5)!),
            ("05/MAR/26", CalendarDate(year: 2026, month: 3, day: 5)!)
        ]
        for (text, expected) in cases {
            XCTAssertEqual(parser.parse(text: "DATA: \(text)").date?.value, expected, text)
        }
    }

    func testInvalidDatesAreRejected() {
        XCTAssertNil(parser.parse(text: "DATA: 31/02/2026").date)
        XCTAssertNil(parser.parse(text: "DATA: 10/10/1985").date, "fora do intervalo de anos aceito")
    }

    func testTimeFormatsAndFalsePositives() {
        XCTAssertEqual(parser.parse(text: "HORA: 08:01:33").time?.value, ClockTime(hour: 8, minute: 1, second: 33))
        XCTAssertEqual(parser.parse(text: "7h05").time?.value, ClockTime(hour: 7, minute: 5))
        XCTAssertNil(parser.parse(text: "HORA: 25:10").time)
        // CNPJ e datas não podem virar horário.
        XCTAssertNil(parser.parse(text: "CNPJ: 11.222.333/0001-81").time)
        XCTAssertNil(parser.parse(text: "22/10/2026").time)
    }

    func testCNPJWithOCRConfusionIsCorrectedAndFlagged() {
        let result = parser.parse(text: "CNPJ: 11.222.333/OOO1-81", confidence: 1)
        XCTAssertEqual(result.cnpj?.value, "11.222.333/0001-81")
        XCTAssertNotNil(result.cnpj?.note)
        XCTAssertLessThan(result.cnpj!.confidence, ParsedTicket.confirmationThreshold)
    }

    func testAlphanumericCNPJ() {
        let result = parser.parse(text: "CNPJ: 12.ABC.345/01DE-35", confidence: 1)
        XCTAssertEqual(result.cnpj?.value, "12.ABC.345/01DE-35")
        XCTAssertNil(result.cnpj?.note)
    }

    func testEmptyInput() {
        let result = parser.parse(lines: [])
        XCTAssertNil(result.date)
        XCTAssertFalse(result.warnings.isEmpty)
    }
}

final class DocumentValidatorsTests: XCTestCase {
    func testCNPJ() {
        XCTAssertTrue(DocumentValidators.isValidCNPJ("11.222.333/0001-81"))
        XCTAssertTrue(DocumentValidators.isValidCNPJ("11222333000181"))
        XCTAssertFalse(DocumentValidators.isValidCNPJ("11.222.333/0001-82"))
        XCTAssertFalse(DocumentValidators.isValidCNPJ("00.000.000/0000-00"))
        XCTAssertTrue(DocumentValidators.isValidCNPJ("12.ABC.345/01DE-35"))
        XCTAssertFalse(DocumentValidators.isValidCNPJ("12.ABC.345/01DE-36"))
        XCTAssertEqual(DocumentValidators.formatCNPJ("11222333000181"), "11.222.333/0001-81")
    }

    func testCPFAndPIS() {
        XCTAssertTrue(DocumentValidators.isValidCPF("529.982.247-25"))
        XCTAssertFalse(DocumentValidators.isValidCPF("529.982.247-26"))
        XCTAssertFalse(DocumentValidators.isValidCPF("111.111.111-11"))
        XCTAssertTrue(DocumentValidators.isValidPIS("120.4567.890-5"))
        XCTAssertFalse(DocumentValidators.isValidPIS("120.4567.890-4"))
    }
}
