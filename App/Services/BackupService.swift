import Foundation
import SwiftData
import PontoCore

/// Cria e restaura backups completos (dados + imagens originais) no formato `.mpdbackup`.
enum BackupService {
    struct RestoreSummary {
        var inserted: Int
        var skippedExisting: Int
        var missingImages: Int

        var message: String {
            var parts = ["\(inserted) ticket(s) restaurado(s)."]
            if skippedExisting > 0 { parts.append("\(skippedExisting) já existiam e foram mantidos sem alteração.") }
            if missingImages > 0 { parts.append("\(missingImages) imagem(ns) não estavam no backup.") }
            return parts.joined(separator: " ")
        }
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    /// Gera o arquivo de backup em uma pasta temporária e devolve sua URL.
    static func createBackup(context: ModelContext, settings: AppSettings) throws -> URL {
        let tickets = try context.fetch(FetchDescriptor<Ticket>())
        let records = tickets.map { $0.record(includeDetails: true) }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pt_BR")
        formatter.dateFormat = "yyyy-MM-dd-HHmm"
        let name = "MeuPontoDigital-backup-\(formatter.string(from: Date())).\(BackupArchive.fileExtension)"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)

        let writer = try BackupArchive.Writer(url: url)
        do {
            let manifest = BackupManifest(appVersion: appVersion, tickets: records, settings: settings.exportable)
            try writer.add(name: BackupArchive.manifestName, data: BackupManifest.encoder().encode(manifest))
            for record in records {
                for fileName in [record.imageFileName, record.processedImageFileName].compactMap({ $0 }) where !fileName.isEmpty {
                    // Uma imagem por vez, para não carregar todo o acervo na memória.
                    try autoreleasepool {
                        if let data = ImageStore.shared.data(for: fileName) {
                            try writer.add(name: "images/\(fileName)", data: data)
                        }
                    }
                }
            }
            try writer.close()
        } catch {
            try? writer.close()
            try? FileManager.default.removeItem(at: url)
            throw error
        }
        return url
    }

    /// Pré-visualização: quantos tickets há no backup e quando foi criado.
    static func preview(url: URL) throws -> BackupManifest {
        try withSecurityScope(url) { try BackupArchive.readManifest(url: url) }
    }

    /// Restaura sem apagar nada: tickets que já existem (mesmo ID) são mantidos como estão.
    /// O arquivo inteiro é validado antes de qualquer gravação.
    static func restore(from url: URL, context: ModelContext, settings: AppSettings) throws -> RestoreSummary {
        try withSecurityScope(url) {
            let manifest = try BackupArchive.readManifest(url: url)
            let existingIDs = Set(try context.fetch(FetchDescriptor<Ticket>()).map(\.id))
            let newRecords = manifest.tickets.filter { !existingIDs.contains($0.id) }
            let neededImages = Set(newRecords.flatMap { [$0.imageFileName, $0.processedImageFileName ?? ""] }.filter { !$0.isEmpty })

            // 1ª passagem: verifica a integridade de todas as entradas (CRC) sem gravar.
            try BackupArchive.read(url: url) { _, _ in }

            // 2ª passagem: grava as imagens necessárias.
            var restoredImages = Set<String>()
            var writtenFiles: [String] = []
            do {
                try BackupArchive.read(url: url) { name, data in
                    guard name.hasPrefix("images/") else { return }
                    let fileName = String(name.dropFirst("images/".count))
                    guard neededImages.contains(fileName) else { return }
                    if !ImageStore.shared.exists(fileName) {
                        try ImageStore.shared.restore(data, fileName: fileName)
                        writtenFiles.append(fileName)
                    }
                    restoredImages.insert(fileName)
                }
                for record in newRecords {
                    Ticket.insert(record, into: context)
                }
                try context.save()
            } catch {
                context.rollback()
                writtenFiles.forEach { ImageStore.shared.delete($0) }
                throw error
            }
            if existingIDs.isEmpty { settings.importSettings(manifest.settings) }
            let missing = newRecords.filter { !restoredImages.contains($0.imageFileName) && !ImageStore.shared.exists($0.imageFileName) }.count
            return RestoreSummary(inserted: newRecords.count, skippedExisting: manifest.tickets.count - newRecords.count,
                                  missingImages: missing)
        }
    }

    /// Exportação aberta (LGPD — portabilidade): pasta com CSV, JSON e as imagens originais,
    /// legível sem o app.
    static func createOpenExport(context: ModelContext) throws -> URL {
        let tickets = try context.fetch(FetchDescriptor<Ticket>())
        let records = tickets.map { $0.record(includeDetails: true) }.sorted(by: TicketRecord.chronological)

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("MeuPontoDigital-exportacao-\(formatter.string(from: Date()))", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        let imagesFolder = folder.appendingPathComponent("imagens", isDirectory: true)
        try FileManager.default.createDirectory(at: imagesFolder, withIntermediateDirectories: true)

        try Data(CSVExporter.tickets(records).utf8).write(to: folder.appendingPathComponent("tickets.csv"))
        let manifest = BackupManifest(appVersion: appVersion, tickets: records)
        try BackupManifest.encoder().encode(manifest).write(to: folder.appendingPathComponent("dados.json"))
        for record in records where !record.imageFileName.isEmpty {
            let source = ImageStore.shared.url(for: record.imageFileName)
            let ext = source.pathExtension.isEmpty ? "jpg" : source.pathExtension
            let datePart = record.recordDate?.key ?? "sem-data"
            let timePart = record.recordTime.map { $0.formatted.replacingOccurrences(of: ":", with: "") } ?? "sem-hora"
            let target = imagesFolder.appendingPathComponent("\(datePart)_\(timePart)_\(record.id.uuidString.prefix(8)).\(ext)")
            try? FileManager.default.copyItem(at: source, to: target)
        }
        let readme = """
        Exportação do Meu Ponto Digital — \(formatter.string(from: Date()))

        tickets.csv  Planilha com um ticket por linha (abre no Excel, Numbers ou Planilhas Google).
        dados.json   Todos os dados, incluindo texto do OCR e histórico de alterações.
        imagens/     Fotografias originais dos comprovantes (data_hora_identificador).

        Os dados extraídos por OCR podem conter erros. O comprovante original é a referência.
        """
        try Data(readme.utf8).write(to: folder.appendingPathComponent("LEIA-ME.txt"))
        return folder
    }

    private static func withSecurityScope<T>(_ url: URL, _ body: () throws -> T) throws -> T {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        return try body()
    }
}
