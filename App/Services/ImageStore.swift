import Foundation
import UIKit
import ImageIO

/// Locais de armazenamento do app.
///
/// Tudo fica em `Application Support/MeuPontoDigital`, dentro do contêiner do app:
/// não aparece no app Arquivos, é apagado ao desinstalar o app e é incluído no backup
/// do iPhone (iCloud ou computador).
enum StorageLocations {
    static var baseDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MeuPontoDigital", isDirectory: true)
    }

    static var databaseURL: URL { baseDirectory.appendingPathComponent("MeuPonto.store") }
    static var imagesDirectory: URL { baseDirectory.appendingPathComponent("Comprovantes", isDirectory: true) }

    static func prepare() throws {
        let fm = FileManager.default
        for directory in [baseDirectory, imagesDirectory] where !fm.fileExists(atPath: directory.path) {
            // Proteção de dados: arquivos ficam criptografados pelo iOS enquanto o aparelho está bloqueado.
            try fm.createDirectory(at: directory, withIntermediateDirectories: true,
                                   attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        }
    }
}

/// Guarda as imagens dos comprovantes como arquivos, com proteção de dados do iOS.
///
/// A imagem original é gravada exatamente como recebida (mesmos bytes, mesmo formato),
/// sem recompressão, para preservar o comprovante.
final class ImageStore {
    static let shared = ImageStore()

    private let thumbnailCache = NSCache<NSString, UIImage>()
    private var directory: URL { StorageLocations.imagesDirectory }

    enum Kind: String {
        case original = "original"
        case processed = "tratada"
    }

    /// Grava os dados e devolve o nome do arquivo.
    func save(_ data: Data, id: UUID, kind: Kind, fileExtension: String) throws -> String {
        try StorageLocations.prepare()
        let ext = fileExtension.isEmpty ? "jpg" : fileExtension.lowercased()
        let fileName = "\(id.uuidString)-\(kind.rawValue).\(ext)"
        try data.write(to: url(for: fileName), options: [.atomic, .completeFileProtection])
        return fileName
    }

    /// Restaura um arquivo vindo de backup com o mesmo nome.
    func restore(_ data: Data, fileName: String) throws {
        try StorageLocations.prepare()
        let safeName = (fileName as NSString).lastPathComponent
        try data.write(to: url(for: safeName), options: [.atomic, .completeFileProtection])
    }

    func url(for fileName: String) -> URL {
        directory.appendingPathComponent((fileName as NSString).lastPathComponent)
    }

    func exists(_ fileName: String) -> Bool {
        FileManager.default.fileExists(atPath: url(for: fileName).path)
    }

    func data(for fileName: String) -> Data? {
        try? Data(contentsOf: url(for: fileName))
    }

    func image(for fileName: String) -> UIImage? {
        data(for: fileName).flatMap(UIImage.init(data:))
    }

    /// Miniatura gerada sem carregar a imagem inteira na memória.
    func thumbnail(for fileName: String, maxPixelSize: CGFloat = 240) -> UIImage? {
        let key = "\(fileName)#\(Int(maxPixelSize))" as NSString
        if let cached = thumbnailCache.object(forKey: key) { return cached }
        guard let source = CGImageSourceCreateWithURL(url(for: fileName) as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        let image = UIImage(cgImage: cgImage)
        thumbnailCache.setObject(image, forKey: key)
        return image
    }

    func delete(_ fileName: String?) {
        guard let fileName else { return }
        try? FileManager.default.removeItem(at: url(for: fileName))
        thumbnailCache.removeAllObjects()
    }

    /// Espaço ocupado pelas imagens (bytes).
    func totalSize() -> Int64 {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
        return files.reduce(0) { total, url in
            total + Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }
}
