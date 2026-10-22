import XCTest
@testable import PontoCore

final class WorkdayAnalyzerTests: XCTestCase {
    let analyzer = WorkdayAnalyzer(schedule: .standard)
    let thursday = CalendarDate(key: "2026-10-22")!

    func testCompleteDay() {
        let records = [
            Fixtures.record("2026-10-22", "17:30", .saida),
            Fixtures.record("2026-10-22", "08:00", .entrada),
            Fixtures.record("2026-10-22", "12:00", .inicioIntervalo),
            Fixtures.record("2026-10-22", "13:00", .fimIntervalo)
        ]
        let day = analyzer.summarize(day: thursday, records: records)
        XCTAssertEqual(day.marks.map(\.time.formatted), ["08:00", "12:00", "13:00", "17:30"])
        XCTAssertEqual(day.gapsBetweenMarks, [240, 60, 270])
        XCTAssertEqual(day.workedMinutes, 510)
        XCTAssertEqual(day.breaks, [60])
        XCTAssertEqual(day.expectedMinutes, 480)
        XCTAssertEqual(day.balanceMinutes, 30)
        XCTAssertTrue(day.issues.isEmpty)
        XCTAssertFalse(day.isEstimate)
    }

    func testUndefinedTypesAreNeverGuessed() {
        let records = [
            Fixtures.record("2026-10-22", "08:00", .indefinido),
            Fixtures.record("2026-10-22", "17:00", .indefinido)
        ]
        let day = analyzer.summarize(day: thursday, records: records)
        XCTAssertNil(day.workedMinutes, "sem tipos confirmados não calcula horas trabalhadas")
        XCTAssertEqual(day.gapsBetweenMarks, [540], "mas mostra o tempo entre marcações")
        XCTAssertEqual(day.issues, [.undefinedMarkTypes(count: 2)])
    }

    func testMissingExitIsFlaggedAsPossibleMissingMark() {
        let records = [
            Fixtures.record("2026-10-22", "08:00", .entrada),
            Fixtures.record("2026-10-22", "12:00", .inicioIntervalo),
            Fixtures.record("2026-10-22", "13:00", .fimIntervalo)
        ]
        let day = analyzer.summarize(day: thursday, records: records)
        XCTAssertEqual(day.issues, [.openPeriod(since: ClockTime(hour: 13, minute: 0)!)])
        XCTAssertEqual(day.workedMinutes, 240)
        XCTAssertTrue(day.isEstimate)
    }

    func testEndWithoutStartAndConsecutiveStarts() {
        let day = analyzer.summarize(day: thursday, records: [
            Fixtures.record("2026-10-22", "07:00", .saida),
            Fixtures.record("2026-10-22", "08:00", .entrada),
            Fixtures.record("2026-10-22", "09:00", .entrada),
            Fixtures.record("2026-10-22", "17:00", .saida)
        ])
        XCTAssertTrue(day.issues.contains(.endWithoutStart(at: ClockTime(hour: 7, minute: 0)!)))
        XCTAssertTrue(day.issues.contains(.consecutiveStarts(at: ClockTime(hour: 9, minute: 0)!)))
    }

    func testShortBreakIsReportedAsReferenceNotInfraction() {
        let day = analyzer.summarize(day: thursday, records: [
            Fixtures.record("2026-10-22", "08:00", .entrada),
            Fixtures.record("2026-10-22", "12:00", .inicioIntervalo),
            Fixtures.record("2026-10-22", "12:30", .fimIntervalo),
            Fixtures.record("2026-10-22", "17:00", .saida)
        ])
        XCTAssertEqual(day.issues, [.breakShorterThanReference(minutes: 30)])
        XCTAssertTrue(day.issues[0].message.contains("referência"))
    }

    func testNightShiftWithManualJourneyAssociation() {
        let records = [
            Fixtures.record("2026-10-22", "22:00", .entrada),
            Fixtures.record("2026-10-23", "06:00", .saida, journey: "2026-10-22")
        ]
        let days = analyzer.summarizeAll(records)
        XCTAssertEqual(days.count, 1)
        XCTAssertEqual(days[0].date, thursday)
        XCTAssertEqual(days[0].workedMinutes, 480)
        XCTAssertEqual(days[0].issues, [.noBreakRecorded])
    }

    func testMonthSummaryOnlySumsDaysWithoutIssues() {
        let records = [
            Fixtures.record("2026-10-01", "08:00", .entrada), Fixtures.record("2026-10-01", "12:00", .inicioIntervalo),
            Fixtures.record("2026-10-01", "13:00", .fimIntervalo), Fixtures.record("2026-10-01", "17:00", .saida),
            Fixtures.record("2026-10-02", "08:00", .entrada)
        ]
        let summary = analyzer.summarize(month: YearMonth(year: 2026, month: 10), records: records,
                                         until: CalendarDate(key: "2026-10-06"))
        XCTAssertEqual(summary.days.count, 2)
        XCTAssertEqual(summary.workedMinutesConfirmedDays, 480)
        XCTAssertEqual(summary.balanceMinutesConfirmedDays, 0)
        XCTAssertEqual(summary.daysWithIssues, 1)
        // 05/10 (segunda) é dia útil sem ticket; 03 e 04 são fim de semana.
        XCTAssertEqual(summary.expectedDaysWithoutTickets.map(\.key), ["2026-10-05"])
        XCTAssertTrue(summary.isEstimate)
    }
}

final class CalendarTypesTests: XCTestCase {
    func testDateArithmeticAndFormatting() {
        let date = CalendarDate(key: "2026-10-22")!
        XCTAssertEqual(date.brazilian, "22/10/2026")
        XCTAssertEqual(date.weekday, 5)
        XCTAssertEqual(date.adding(days: 10).key, "2026-11-01")
        XCTAssertEqual(date.days(to: CalendarDate(key: "2027-01-01")!), 71)
        XCTAssertNil(CalendarDate(year: 2026, month: 2, day: 29))
        XCTAssertNotNil(CalendarDate(year: 2028, month: 2, day: 29))
        XCTAssertEqual(YearMonth(year: 2026, month: 12).adding(months: 1), YearMonth(year: 2027, month: 1))
        XCTAssertEqual(YearMonth(year: 2026, month: 2).numberOfDays, 28)
        XCTAssertEqual(DurationFormatter.string(minutes: -75), "-1h15")
        XCTAssertEqual(DurationFormatter.string(minutes: 30, showSign: true), "+0h30")
    }

    func testCodableRoundTrip() throws {
        let record = Fixtures.record("2026-10-22", "08:01", .entrada)
        let data = try BackupManifest.encoder().encode(record)
        let json = String(decoding: data, as: UTF8.self)
        XCTAssertTrue(json.contains("\"recordDate\" : \"2026-10-22\""))
        XCTAssertTrue(json.contains("\"recordTime\" : \"08:01\""))
        XCTAssertEqual(try BackupManifest.decoder().decode(TicketRecord.self, from: data), record)
    }
}

final class CSVExporterTests: XCTestCase {
    func testCSVEscapingAndBOM() {
        var record = Fixtures.record("2026-10-22", "08:01", .entrada, company: "ALFA; BETA \"LTDA\"")
        record.notes = "linha 1\nlinha 2"
        let csv = CSVExporter.tickets([record], timeZone: TimeZone(identifier: "America/Sao_Paulo")!)
        XCTAssertTrue(csv.hasPrefix("\u{FEFF}ID;Data do registro;Horário"))
        XCTAssertTrue(csv.contains(";22/10/2026;08:01;Entrada;\"ALFA; BETA \"\"LTDA\"\"\";"))
        XCTAssertTrue(csv.contains("\"linha 1\nlinha 2\""))
    }

    func testWorkdayCSVLabelsEstimates() {
        let day = WorkdayAnalyzer().summarize(day: CalendarDate(key: "2026-10-22")!, records: [
            Fixtures.record("2026-10-22", "08:00", .entrada)
        ])
        let csv = CSVExporter.workdays([day])
        XCTAssertTrue(csv.contains("Estimativa"))
        XCTAssertTrue(csv.contains("quinta-feira"))
    }
}

final class BackupArchiveTests: XCTestCase {
    var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    func testRoundTripPreservesTicketsAndImagesByteForByte() throws {
        let url = directory.appendingPathComponent("teste.mpdbackup")
        var record = Fixtures.record("2026-10-22", "08:01", .entrada)
        record.changes = [ChangeEntry(date: Date(timeIntervalSince1970: 1_792_000_000), field: "Horário", oldValue: "08:07", newValue: "08:01")]
        record.ocrSnapshot = TicketTextParser().parse(text: Fixtures.portaria671)
        let image = Data((0..<100_000).map { UInt8($0 % 251) })

        let writer = try BackupArchive.Writer(url: url)
        let manifest = BackupManifest(appVersion: "1.0", tickets: [record], settings: ["jornada": "padrão"])
        try writer.add(name: BackupArchive.manifestName, data: BackupManifest.encoder().encode(manifest))
        try writer.add(name: "images/\(record.id).jpg", data: image)
        try writer.add(name: "vazio.txt", data: Data())
        try writer.close()

        var entries: [String: Data] = [:]
        try BackupArchive.read(url: url) { entries[$0] = $1 }
        XCTAssertEqual(entries["images/\(record.id).jpg"], image)
        XCTAssertEqual(entries["vazio.txt"], Data())
        let restored = try BackupArchive.readManifest(url: url)
        XCTAssertEqual(restored.tickets, [record])
        XCTAssertEqual(restored.settings["jornada"], "padrão")
    }

    func testCorruptionIsDetected() throws {
        let url = directory.appendingPathComponent("corrompido.mpdbackup")
        let writer = try BackupArchive.Writer(url: url)
        try writer.add(name: "a.bin", data: Data(repeating: 7, count: 1000))
        try writer.close()
        var bytes = try Data(contentsOf: url)
        bytes[bytes.count - 10] ^= 0xFF
        try bytes.write(to: url)
        XCTAssertThrowsError(try BackupArchive.read(url: url) { _, _ in }) { error in
            XCTAssertEqual(error as? BackupArchiveError, .corrupted("a.bin"))
        }
    }

    func testTruncatedAndForeignFilesAreRejected() throws {
        let foreign = directory.appendingPathComponent("foto.jpg")
        try Data("not a backup".utf8).write(to: foreign)
        XCTAssertThrowsError(try BackupArchive.read(url: foreign) { _, _ in }) { error in
            XCTAssertEqual(error as? BackupArchiveError, .notABackup)
        }

        let url = directory.appendingPathComponent("truncado.mpdbackup")
        let writer = try BackupArchive.Writer(url: url)
        try writer.add(name: "a.bin", data: Data(repeating: 1, count: 500))
        try writer.close()
        let bytes = try Data(contentsOf: url)
        try bytes.prefix(bytes.count - 100).write(to: url)
        XCTAssertThrowsError(try BackupArchive.read(url: url) { _, _ in })
        XCTAssertThrowsError(try BackupArchive.readManifest(url: url))
    }

    func testCRC32KnownValue() {
        XCTAssertEqual(CRC32.checksum(Data("123456789".utf8)), 0xCBF4_3926)
    }
}
