import Foundation

/// Conteúdo descritivo do backup (gravado como `manifest.json` dentro do arquivo).
public struct BackupManifest: Codable, Sendable {
    public static let currentFormatVersion = 1

    public var formatVersion: Int
    public var createdAt: Date
    public var appVersion: String
    public var tickets: [TicketRecord]
    public var settings: [String: String]

    public init(createdAt: Date = Date(), appVersion: String, tickets: [TicketRecord], settings: [String: String] = [:]) {
        self.formatVersion = Self.currentFormatVersion
        self.createdAt = createdAt
        self.appVersion = appVersion
        self.tickets = tickets
        self.settings = settings
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

public enum BackupArchiveError: Error, LocalizedError, Equatable {
    case notABackup
    case unsupportedVersion(Int)
    case corrupted(String)
    case missingManifest

    public var errorDescription: String? {
        switch self {
        case .notABackup: return "O arquivo escolhido não é um backup do Meu Ponto Digital."
        case .unsupportedVersion(let v): return "Este backup foi criado por uma versão mais nova do app (formato \(v)). Atualize o app e tente novamente."
        case .corrupted(let name): return "O backup está danificado (\(name)). Nenhum dado foi alterado."
        case .missingManifest: return "O backup não contém a lista de tickets. Nenhum dado foi alterado."
        }
    }
}

/// Formato de arquivo de backup (`.mpdbackup`).
///
/// Formato simples e documentado, lido e gravado em fluxo (sem carregar todas as imagens
/// na memória) e sem dependências externas:
///
///     "MPDBKP" + versão (UInt8) + "\n"
///     repetido: [UInt32 tamanho do nome][nome UTF-8][UInt64 tamanho][CRC32 UInt32][dados]
///
/// Inteiros em little-endian. Cada entrada tem CRC32 para detectar corrupção.
public enum BackupArchive {
    public static let magic = Array("MPDBKP".utf8)
    public static let version: UInt8 = 1
    public static let fileExtension = "mpdbackup"
    public static let manifestName = "manifest.json"

    // MARK: Escrita

    public final class Writer {
        private let handle: FileHandle

        public init(url: URL) throws {
            guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
                throw CocoaError(.fileWriteUnknown, userInfo: [NSFilePathErrorKey: url.path])
            }
            handle = try FileHandle(forWritingTo: url)
            try handle.write(contentsOf: Data(BackupArchive.magic + [BackupArchive.version, 0x0A]))
        }

        public func add(name: String, data: Data) throws {
            let nameData = Data(name.utf8)
            var header = Data()
            header.append(littleEndian: UInt32(nameData.count))
            header.append(nameData)
            header.append(littleEndian: UInt64(data.count))
            header.append(littleEndian: CRC32.checksum(data))
            try handle.write(contentsOf: header)
            try handle.write(contentsOf: data)
        }

        public func close() throws {
            try handle.synchronize()
            try handle.close()
        }
    }

    // MARK: Leitura

    /// Percorre as entradas do arquivo, verificando a integridade de cada uma.
    public static func read(url: URL, entry: (String, Data) throws -> Void) throws {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let header = try handle.read(upToCount: magic.count + 2) ?? Data()
        guard header.count == magic.count + 2, Array(header.prefix(magic.count)) == magic else {
            throw BackupArchiveError.notABackup
        }
        let fileVersion = header[header.startIndex + magic.count]
        guard fileVersion <= version else { throw BackupArchiveError.unsupportedVersion(Int(fileVersion)) }

        while true {
            guard let lengthData = try handle.read(upToCount: 4), !lengthData.isEmpty else { break }
            guard lengthData.count == 4 else { throw BackupArchiveError.corrupted("cabeçalho") }
            let nameLength = Int(lengthData.littleEndianUInt32(at: 0))
            guard nameLength > 0, nameLength < 4096,
                  let nameData = try handle.read(upToCount: nameLength), nameData.count == nameLength,
                  let name = String(data: nameData, encoding: .utf8) else {
                throw BackupArchiveError.corrupted("nome de entrada")
            }
            guard let sizeData = try handle.read(upToCount: 12), sizeData.count == 12 else {
                throw BackupArchiveError.corrupted(name)
            }
            let size = Int(sizeData.littleEndianUInt64(at: 0))
            let crc = sizeData.littleEndianUInt32(at: 8)
            let data = size == 0 ? Data() : (try handle.read(upToCount: size) ?? Data())
            guard data.count == size, CRC32.checksum(data) == crc else { throw BackupArchiveError.corrupted(name) }
            try entry(name, data)
        }
    }

    /// Lê apenas o manifesto (para pré-visualizar a restauração).
    public static func readManifest(url: URL) throws -> BackupManifest {
        var manifest: BackupManifest?
        try read(url: url) { name, data in
            if name == manifestName {
                manifest = try BackupManifest.decoder().decode(BackupManifest.self, from: data)
            }
        }
        guard let manifest else { throw BackupArchiveError.missingManifest }
        guard manifest.formatVersion <= BackupManifest.currentFormatVersion else {
            throw BackupArchiveError.unsupportedVersion(manifest.formatVersion)
        }
        return manifest
    }
}

/// CRC-32 (IEEE 802.3), usado para verificar a integridade das entradas do backup.
public enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { index in
        var c = UInt32(index)
        for _ in 0..<8 { c = (c & 1) != 0 ? (0xEDB8_8320 ^ (c >> 1)) : (c >> 1) }
        return c
    }

    public static func checksum(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data { crc = table[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8) }
        return crc ^ 0xFFFF_FFFF
    }
}

extension Data {
    mutating func append<T: FixedWidthInteger>(littleEndian value: T) {
        Swift.withUnsafeBytes(of: value.littleEndian) { append(contentsOf: $0) }
    }

    func littleEndianUInt32(at offset: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { $0 | UInt32(self[startIndex + offset + $1]) << (8 * $1) }
    }

    func littleEndianUInt64(at offset: Int) -> UInt64 {
        (0..<8).reduce(UInt64(0)) { $0 | UInt64(self[startIndex + offset + $1]) << (8 * $1) }
    }
}
