import Foundation
import SwiftData
import PontoCore

/// Esquema versionado do banco de dados.
///
/// Toda mudança futura no modelo deve criar um `SchemaV2` (copiando as classes) e um
/// `MigrationStage` em `TicketMigrationPlan`, para que atualizações do app nunca percam
/// registros. Nunca altere as classes de uma versão já publicada.
enum SchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)

    static var models: [any PersistentModel.Type] {
        [Ticket.self, TicketChange.self]
    }

    /// Ticket digitalizado. A imagem fica em arquivo (ver `ImageStore`); aqui ficam os dados.
    @Model
    final class Ticket {
        @Attribute(.unique) var id: UUID

        // Arquivos
        var originalFileName: String
        var imageFileName: String
        var processedImageFileName: String?
        /// Hash perceptual (bits de um UInt64) para detectar fotos repetidas.
        var imageHashBits: Int64?

        // OCR — preservado como reconhecido
        var ocrText: String
        var ocrConfidence: Double
        var fieldConfidencesData: Data?
        var ocrSnapshotData: Data?

        // Dados estruturados (data e hora civis, como impressos)
        /// `yyyy-MM-dd` — ordenável e independente de fuso horário.
        var recordDayKey: String?
        /// `HH:mm` ou `HH:mm:ss`.
        var recordTimeText: String?
        var markTypeRaw: String
        var company: String
        var cnpj: String
        var employeeName: String
        var employeeID: String
        var clockID: String
        var ticketNumber: String
        var authCode: String
        var otherFieldsData: Data?

        // Organização
        var importedAt: Date
        var isConfirmed: Bool
        var isFlagged: Bool
        var notes: String
        var tags: [String]
        var journeyDayKey: String?
        /// Última alteração (inclusão ou edição); usado para atualizar caches de busca.
        var updatedAt: Date

        @Relationship(deleteRule: .cascade, inverse: \TicketChange.ticket)
        var changes: [TicketChange] = []

        init(id: UUID, importedAt: Date) {
            self.id = id
            self.originalFileName = ""
            self.imageFileName = ""
            self.ocrText = ""
            self.ocrConfidence = 0
            self.markTypeRaw = MarkType.indefinido.rawValue
            self.company = ""
            self.cnpj = ""
            self.employeeName = ""
            self.employeeID = ""
            self.clockID = ""
            self.ticketNumber = ""
            self.authCode = ""
            self.importedAt = importedAt
            self.updatedAt = importedAt
            self.isConfirmed = false
            self.isFlagged = false
            self.notes = ""
            self.tags = []
        }
    }

    /// Entrada do histórico de alterações de um ticket.
    @Model
    final class TicketChange {
        @Attribute(.unique) var id: UUID
        var date: Date
        var field: String
        var oldValue: String
        var newValue: String
        var ticket: Ticket?

        init(id: UUID = UUID(), date: Date, field: String, oldValue: String, newValue: String) {
            self.id = id
            self.date = date
            self.field = field
            self.oldValue = oldValue
            self.newValue = newValue
        }
    }
}

typealias Ticket = SchemaV1.Ticket
typealias TicketChange = SchemaV1.TicketChange

enum TicketMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [SchemaV1.self] }
    static var stages: [MigrationStage] { [] }
}

enum PersistenceController {
    /// Cria o contêiner do banco local (sem CloudKit: os dados ficam somente no aparelho).
    static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        let schema = Schema(versionedSchema: SchemaV1.self)
        let configuration: ModelConfiguration
        if inMemory {
            configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true, cloudKitDatabase: .none)
        } else {
            try StorageLocations.prepare()
            configuration = ModelConfiguration(schema: schema, url: StorageLocations.databaseURL, cloudKitDatabase: .none)
        }
        return try ModelContainer(for: schema, migrationPlan: TicketMigrationPlan.self, configurations: [configuration])
    }
}
