import XCTest
@testable import PontoCore

final class TicketFilterTests: XCTestCase {
    let records: [TicketRecord] = [
        Fixtures.record("2026-10-22", "08:01", .entrada),
        Fixtures.record("2026-10-22", "17:30", .saida),
        Fixtures.record("2026-09-15", "12:00", .inicioIntervalo, company: "COMERCIAL ALFA S/A"),
        Fixtures.record(nil, "09:00", .indefinido, confirmed: false)
    ]

    func testSearchByBrazilianDateAndPartialDate() {
        var filter = TicketFilter()
        filter.text = "22/10/2026"
        XCTAssertEqual(filter.apply(to: records).count, 2)
        filter.text = "22/10"
        XCTAssertEqual(filter.apply(to: records).count, 2)
        filter.text = "22/10/26"
        XCTAssertEqual(filter.apply(to: records).count, 2)
    }

    func testSearchByTimeInDifferentWritings() {
        var filter = TicketFilter()
        for query in ["8:01", "08:01", "8h01"] {
            filter.text = query
            XCTAssertEqual(filter.apply(to: records).map(\.recordTime), [ClockTime(hour: 8, minute: 1)], query)
        }
    }

    func testSearchByMonthNameWeekdayAndAccentInsensitiveText() {
        var filter = TicketFilter()
        filter.text = "setembro"
        XCTAssertEqual(filter.apply(to: records).count, 1)
        filter.text = "quinta-feira" // 22/10/2026 é quinta-feira
        XCTAssertEqual(filter.apply(to: records).count, 2)
        filter.text = "saida"
        XCTAssertEqual(filter.apply(to: records).first?.markType, .saida)
        filter.text = "padaria entrada"
        XCTAssertEqual(filter.apply(to: records).count, 1)
    }

    func testSearchInsideOCRText() {
        let record = TicketRecord(ocrText: "LOCAL: RUA DAS FLORES, 100", recordDate: CalendarDate(key: "2026-01-02"))
        var filter = TicketFilter()
        filter.text = "flores"
        XCTAssertTrue(filter.matches(record))
    }

    func testStructuredFilters() {
        var filter = TicketFilter()
        filter.dateFrom = CalendarDate(key: "2026-10-01")
        filter.dateTo = CalendarDate(key: "2026-10-31")
        XCTAssertEqual(filter.apply(to: records).count, 2)

        filter = TicketFilter()
        filter.month = YearMonth(year: 2026, month: 9)
        XCTAssertEqual(filter.apply(to: records).count, 1)

        filter = TicketFilter()
        filter.company = "alfa"
        XCTAssertEqual(filter.apply(to: records).count, 1)

        filter = TicketFilter()
        filter.markTypes = [.entrada, .saida]
        XCTAssertEqual(filter.apply(to: records).count, 2)

        filter = TicketFilter()
        filter.timeFrom = 11 * 60
        filter.timeTo = 13 * 60
        XCTAssertEqual(filter.apply(to: records).count, 1)

        filter = TicketFilter()
        filter.onlyIncomplete = true
        XCTAssertEqual(filter.apply(to: records).count, 1)
        XCTAssertEqual(filter.activeFilterCount, 1)
    }

    func testChronologicalOrderUsesPrintedDateNotImportDate() {
        let late = TicketRecord(recordDate: CalendarDate(key: "2026-10-22"), recordTime: ClockTime(hour: 17, minute: 0), importedAt: Date(timeIntervalSince1970: 0))
        let early = TicketRecord(recordDate: CalendarDate(key: "2026-10-22"), recordTime: ClockTime(hour: 8, minute: 0), importedAt: Date())
        let undated = TicketRecord(importedAt: Date(timeIntervalSince1970: -100))
        let sorted = [undated, late, early].sorted(by: TicketRecord.chronological)
        XCTAssertEqual(sorted.map(\.id), [early.id, late.id, undated.id])
    }

    func testLargeArchivePerformance() {
        var many: [TicketRecord] = []
        let start = CalendarDate(key: "2020-01-01")!
        for i in 0..<10_000 {
            many.append(Fixtures.record(start.adding(days: i / 4).key, String(format: "%02d:%02d", 7 + i % 4 * 3, i % 60), .entrada))
        }
        var filter = TicketFilter()
        filter.text = "15/03/2022"
        let begin = Date()
        let found = filter.apply(to: many)
        XCTAssertEqual(found.count, 4)
        XCTAssertLessThan(Date().timeIntervalSince(begin), 10, "busca em 10 mil tickets deve ser rápida")
    }
}

final class ChangeTrackerTests: XCTestCase {
    func testDiffRecordsOnlyChangedFields() {
        let old = Fixtures.record("2026-10-22", "08:01", .indefinido, confirmed: false)
        var new = old
        new.markType = .entrada
        new.isConfirmed = true
        new.notes = "Conferido com o holerite"
        let changes = ChangeTracker.diff(from: old, to: new)
        XCTAssertEqual(changes.map(\.field), ["Tipo de marcação", "Observações", "Situação da revisão"])
        XCTAssertEqual(changes.first?.oldValue, "Não identificado")
        XCTAssertEqual(changes.first?.newValue, "Entrada")
        XCTAssertEqual(changes[1].oldValue, "(vazio)")
    }
}

final class DuplicateDetectorTests: XCTestCase {
    func testSameNSRSameClockIsStrongDuplicate() {
        var a = Fixtures.record("2026-10-22", "08:01", .entrada, nsr: "000012345")
        var b = Fixtures.record("2026-10-22", "08:01", .entrada, nsr: "12345")
        a.clockID = "00004000020005089"
        b.clockID = "00004000020005089"
        let match = DuplicateDetector.compare(a, b)
        XCTAssertEqual(match?.reasons, [.sameTicketNumber, .sameDateTimeAndType])
        XCTAssertTrue(match?.isStrong ?? false)
    }

    func testSimilarImageOnly() {
        let a = Fixtures.record("2026-10-22", "08:01", .entrada, hash: 0xFFFF_0000_FFFF_0000)
        let b = Fixtures.record("2026-10-23", "08:05", .entrada, hash: 0xFFFF_0000_FFFF_0007)
        XCTAssertEqual(DuplicateDetector.compare(a, b)?.reasons, [.similarImage])
        XCTAssertFalse(DuplicateDetector.compare(a, b)!.isStrong)
    }

    func testDifferentTicketsAreNotDuplicates() {
        let a = Fixtures.record("2026-10-22", "08:01", .entrada, nsr: "1", hash: 0)
        let b = Fixtures.record("2026-10-22", "17:30", .saida, nsr: "2", hash: UInt64.max)
        XCTAssertNil(DuplicateDetector.compare(a, b))
    }

    func testAllMatchesFindsPairs() {
        let records = [
            Fixtures.record("2026-10-22", "08:01", .entrada, auth: "ABC"),
            Fixtures.record("2026-10-22", "12:00", .inicioIntervalo),
            Fixtures.record("2026-10-23", "08:00", .entrada, auth: "abc")
        ]
        let matches = DuplicateDetector.allMatches(in: records)
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?.reasons, [.sameAuthCode])
    }

    func testDifferenceHash() {
        let gradient = (0..<72).map { UInt8(255 - ($0 % 9) * 20) }
        XCTAssertEqual(DifferenceHash.compute(grayscale: gradient), UInt64.max)
        XCTAssertNil(DifferenceHash.compute(grayscale: [1, 2, 3]))
        XCTAssertEqual(DifferenceHash.distance(0b1011, 0b0001), 2)
    }
}
