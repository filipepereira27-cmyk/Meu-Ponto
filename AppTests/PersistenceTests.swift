import XCTest
import SwiftData
import PontoCore
@testable import MeuPontoDigital

/// Persistência, histórico e backup/restauração com SwiftData (banco em memória).
final class PersistenceTests: XCTestCase {
    var container: ModelContainer!
    var context: ModelContext!
    var createdFiles: [String] = []

    override func setUpWithError() throws {
        container = try PersistenceController.makeContainer(inMemory: true)
        context = ModelContext(container)
    }

    override func tearDownWithError() throws {
        createdFiles.forEach { ImageStore.shared.delete($0) }
        context = nil
        container = nil
    }

    private func sampleRecord(id: UUID = UUID()) -> TicketRecord {
        let parsed = TicketTextParser().parse(text: """
        PADARIA BOM DIA LTDA
        CNPJ: 11.222.333/0001-81
        NOME: JOÃO DA SILVA
        NSR: 000012345
        DATA: 22/10/2026 HORA: 08:01:33
        ENTRADA
        """, confidence: 0.95)
        var record = TicketRecord(parsed: parsed, id: id, importedAt: Date(timeIntervalSince1970: 1_792_000_000))
        record.originalFileName = "teste.jpg"
        record.imageFileName = "\(id.uuidString)-original.jpg"
        record.tags = ["Entrada"]
        record.changes = [ChangeEntry(date: Date(timeIntervalSince1970: 1_792_000_000), field: "Inclusão", oldValue: "—", newValue: "Teste")]
        return record
    }

    func testRecordRoundTripThroughSwiftData() throws {
        let record = sampleRecord()
        Ticket.insert(record, into: context)
        try context.save()

        let fetched = try XCTUnwrap(try context.fetch(FetchDescriptor<Ticket>()).first)
        let restored = fetched.record(includeDetails: true)
        XCTAssertEqual(restored.recordDate, CalendarDate(key: "2026-10-22"))
        XCTAssertEqual(restored.recordTime?.formatted, "08:01:33", "segundos impressos são preservados")
        XCTAssertEqual(restored.markType, .entrada)
        XCTAssertEqual(restored.cnpj, "11.222.333/0001-81")
        XCTAssertEqual(restored.ocrSnapshot, record.ocrSnapshot)
        XCTAssertEqual(restored.ocrText, record.ocrText)
        XCTAssertEqual(restored.changes.count, 1)
        XCTAssertEqual(restored.tags, ["Entrada"])
    }

    func testEditKeepsOCRTextAndRecordsHistory() throws {
        let ticket = Ticket.insert(sampleRecord(), into: context)
        try context.save()
        let originalText = ticket.ocrText

        var edited = ticket.record()
        edited.recordTime = ClockTime(hour: 8, minute: 7)
        edited.isConfirmed = true
        ticket.update(to: edited)
        try context.save()

        XCTAssertEqual(ticket.ocrText, originalText, "o texto do OCR nunca é alterado")
        XCTAssertEqual(ticket.recordTimeText, "08:07")
        let fields = ticket.changes.map(\.field)
        XCTAssertTrue(fields.contains("Horário"))
        XCTAssertTrue(fields.contains("Situação da revisão"))
        let timeChange = try XCTUnwrap(ticket.changes.first { $0.field == "Horário" })
        XCTAssertEqual(timeChange.oldValue, "08:01:33")
        XCTAssertEqual(timeChange.newValue, "08:07")
    }

    func testDeletingTicketCascadesHistory() throws {
        let ticket = Ticket.insert(sampleRecord(), into: context)
        try context.save()
        context.delete(ticket)
        try context.save()
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<Ticket>()), 0)
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<TicketChange>()), 0)
    }

    func testImageStorePreservesOriginalBytesWithFileProtection() throws {
        let data = Data((0..<50_000).map { UInt8($0 % 256) })
        let id = UUID()
        let name = try ImageStore.shared.save(data, id: id, kind: .original, fileExtension: "HEIC")
        createdFiles.append(name)
        XCTAssertEqual(name, "\(id.uuidString)-original.heic")
        XCTAssertEqual(ImageStore.shared.data(for: name), data)
        let attributes = try FileManager.default.attributesOfItem(atPath: ImageStore.shared.url(for: name).path)
        // O simulador não implementa proteção de dados; em aparelho real o atributo deve ser .complete.
        if let protection = attributes[.protectionKey] as? FileProtectionType {
            XCTAssertEqual(protection, .complete)
        }
    }

    @MainActor
    func testBackupAndRestoreWithoutLoss() throws {
        let settings = AppSettings(defaults: UserDefaults(suiteName: "tests-\(UUID().uuidString)")!)
        let record = sampleRecord()
        let imageData = Data(repeating: 0xAB, count: 20_000)
        try ImageStore.shared.restore(imageData, fileName: record.imageFileName)
        createdFiles.append(record.imageFileName)
        Ticket.insert(record, into: context)
        try context.save()

        let backupURL = try BackupService.createBackup(context: context, settings: settings)
        defer { try? FileManager.default.removeItem(at: backupURL) }

        // Simula um aparelho novo: banco vazio e sem imagens.
        ImageStore.shared.delete(record.imageFileName)
        let freshContainer = try PersistenceController.makeContainer(inMemory: true)
        let freshContext = ModelContext(freshContainer)

        let summary = try BackupService.restore(from: backupURL, context: freshContext, settings: settings)
        XCTAssertEqual(summary.inserted, 1)
        XCTAssertEqual(summary.missingImages, 0)
        let restored = try XCTUnwrap(try freshContext.fetch(FetchDescriptor<Ticket>()).first)
        XCTAssertEqual(restored.record(includeDetails: true).recordTime, record.recordTime)
        XCTAssertEqual(restored.changes.count, record.changes.count)
        XCTAssertEqual(ImageStore.shared.data(for: record.imageFileName), imageData)

        // Restaurar de novo não duplica nem altera nada.
        let again = try BackupService.restore(from: backupURL, context: freshContext, settings: settings)
        XCTAssertEqual(again.inserted, 0)
        XCTAssertEqual(again.skippedExisting, 1)
        XCTAssertEqual(try freshContext.fetchCount(FetchDescriptor<Ticket>()), 1)
    }

    func testCorruptedBackupChangesNothing() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ruim.mpdbackup")
        try Data("isto não é um backup".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let settings = AppSettings(defaults: UserDefaults(suiteName: "tests-\(UUID().uuidString)")!)
        XCTAssertThrowsError(try BackupService.restore(from: url, context: context, settings: settings))
        XCTAssertEqual(try context.fetchCount(FetchDescriptor<Ticket>()), 0)
    }
}
