import Foundation

/// Normalização de texto para comparação e busca (sem acentos, maiúsculas).
public enum TextNormalizer {
    /// "Saída Almoço" -> "SAIDA ALMOCO"
    public static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive, .widthInsensitive], locale: Locale(identifier: "pt_BR"))
            .uppercased()
    }

    /// Normaliza um rótulo de campo: remove acentos, símbolos como `º`, `°`, `.` e espaços repetidos.
    /// "Nº  Fabricação." -> "N FABRICACAO"
    public static func normalizeLabel(_ text: String) -> String {
        let folded = fold(text)
        var scalars = String.UnicodeScalarView()
        for scalar in folded.unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) || scalar == "/" {
                scalars.append(scalar.properties.isAlphabetic && !scalar.isASCII ? " " : scalar)
            } else {
                scalars.append(" ")
            }
        }
        return collapseSpaces(String(scalars))
    }

    public static func collapseSpaces(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// Palavras para busca: texto dobrado, separado por espaços e pontuação simples.
    public static func searchTokens(_ text: String) -> [String] {
        fold(text)
            .split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" })
            .map(String.init)
            .filter { !$0.isEmpty }
    }

    /// Apenas dígitos.
    public static func digits(_ text: String) -> String {
        String(text.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) && $0.isASCII }.map(Character.init))
    }
}

/// Pequeno utilitário sobre `NSRegularExpression` (disponível em todas as plataformas).
enum Regex {
    private static var cache: [String: NSRegularExpression] = [:]
    private static let lock = NSLock()

    static func compile(_ pattern: String) -> NSRegularExpression {
        lock.lock()
        defer { lock.unlock() }
        if let cached = cache[pattern] { return cached }
        // Padrões são constantes do código; falha aqui é erro de programação.
        let regex = try! NSRegularExpression(pattern: pattern, options: [])
        cache[pattern] = regex
        return regex
    }

    /// Todas as ocorrências; cada item contém o texto completo (índice 0) e os grupos.
    static func matches(_ pattern: String, in text: String) -> [[String?]] {
        let regex = compile(pattern)
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { match in
            (0..<match.numberOfRanges).map { index in
                let range = match.range(at: index)
                return range.location == NSNotFound ? nil : ns.substring(with: range)
            }
        }
    }

    static func firstMatch(_ pattern: String, in text: String) -> [String?]? {
        matches(pattern, in: text).first
    }
}
