import Foundation

/// Validação de documentos brasileiros impressos nos comprovantes.
public enum DocumentValidators {

    // MARK: CNPJ

    /// Valida CNPJ numérico ou alfanumérico (formato vigente a partir de julho/2026:
    /// 12 primeiros caracteres alfanuméricos e 2 dígitos verificadores numéricos).
    public static func isValidCNPJ(_ text: String) -> Bool {
        let chars = Array(compactCNPJ(text))
        guard chars.count == 14 else { return false }
        guard chars[12].isNumber, chars[13].isNumber else { return false }
        guard chars.prefix(12).allSatisfy({ $0.isASCII && ($0.isNumber || $0.isUppercase) }) else { return false }
        // Sequências repetidas (00000000000000) passam no cálculo, mas são inválidas.
        if Set(chars).count == 1 { return false }

        // Valor de cada caractere: código ASCII - 48 ("0" = 0 ... "9" = 9, "A" = 17 ... "Z" = 42).
        let values = chars.map { Int($0.asciiValue!) - 48 }
        func checkDigit(_ prefix: ArraySlice<Int>) -> Int {
            var weight = 2
            var sum = 0
            for value in prefix.reversed() {
                sum += value * weight
                weight = weight == 9 ? 2 : weight + 1
            }
            let rest = sum % 11
            return rest < 2 ? 0 : 11 - rest
        }
        let d1 = checkDigit(values[0..<12])
        let d2 = checkDigit(values[0..<12] + [d1])
        return values[12] == d1 && values[13] == d2
    }

    /// Remove pontuação e espaços, mantendo letras maiúsculas e dígitos.
    public static func compactCNPJ(_ text: String) -> String {
        String(text.uppercased().filter { $0.isASCII && ($0.isNumber || $0.isLetter) })
    }

    /// `12.ABC.345/01DE-35`
    public static func formatCNPJ(_ text: String) -> String {
        let c = Array(compactCNPJ(text))
        guard c.count == 14 else { return text }
        let s = String(c)
        func part(_ from: Int, _ to: Int) -> Substring {
            s[s.index(s.startIndex, offsetBy: from)..<s.index(s.startIndex, offsetBy: to)]
        }
        return "\(part(0, 2)).\(part(2, 5)).\(part(5, 8))/\(part(8, 12))-\(part(12, 14))"
    }

    // MARK: CPF

    public static func isValidCPF(_ text: String) -> Bool {
        let digits = TextNormalizer.digits(text).compactMap { Int(String($0)) }
        guard digits.count == 11, Set(digits).count > 1 else { return false }
        func checkDigit(_ prefix: ArraySlice<Int>) -> Int {
            let weightStart = prefix.count + 1
            let sum = prefix.enumerated().reduce(0) { $0 + $1.element * (weightStart - $1.offset) }
            let rest = (sum * 10) % 11
            return rest == 10 ? 0 : rest
        }
        return digits[9] == checkDigit(digits[0..<9]) && digits[10] == checkDigit(digits[0..<10])
    }

    // MARK: PIS/PASEP/NIT

    public static func isValidPIS(_ text: String) -> Bool {
        let digits = TextNormalizer.digits(text).compactMap { Int(String($0)) }
        guard digits.count == 11, Set(digits).count > 1 else { return false }
        let weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        let sum = zip(digits.prefix(10), weights).reduce(0) { $0 + $1.0 * $1.1 }
        let rest = 11 - (sum % 11)
        let check = rest >= 10 ? 0 : rest
        return digits[10] == check
    }
}
