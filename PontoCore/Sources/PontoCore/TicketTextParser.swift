import Foundation

/// Interpreta o texto reconhecido pelo OCR e extrai os campos de um comprovante de ponto.
///
/// Projetado para os modelos mais comuns no Brasil (comprovantes de REP-C/REP-A/REP-P
/// das Portarias 1510/2009 e 671/2021, e tickets de relógios convencionais), mas sem
/// depender de um layout fixo: usa rótulos ("NOME:", "NSR:"), padrões (datas, horas, CNPJ)
/// e heurísticas com confiança reduzida. Na dúvida, o campo é marcado para confirmação.
public struct TicketTextParser: Sendable {
    /// Intervalo de anos aceito para a data do registro.
    public var acceptedYears: ClosedRange<Int>

    public init(referenceDate: Date = Date()) {
        let year = CalendarDate(date: referenceDate).year
        acceptedYears = 2000...(year + 1)
    }

    public init(acceptedYears: ClosedRange<Int>) {
        self.acceptedYears = acceptedYears
    }

    // MARK: - Rótulos conhecidos (normalizados: sem acento, maiúsculas, sem pontuação)

    enum LabelCategory {
        case employeeName, employeeID, company, cnpj, clockID, ticketNumber, authCode, markType, date, time, ignored
    }

    static let labels: [(String, LabelCategory)] = [
        ("NOME", .employeeName), ("NOME DO TRABALHADOR", .employeeName), ("TRABALHADOR", .employeeName),
        ("FUNCIONARIO", .employeeName), ("NOME DO FUNCIONARIO", .employeeName), ("NOME FUNCIONARIO", .employeeName),
        ("EMPREGADO", .employeeName), ("NOME DO EMPREGADO", .employeeName), ("COLABORADOR", .employeeName),
        ("NOME DO COLABORADOR", .employeeName),

        ("MATRICULA", .employeeID), ("MAT", .employeeID), ("PIS", .employeeID), ("PIS/PASEP", .employeeID),
        ("PASEP", .employeeID), ("NIT", .employeeID), ("CPF", .employeeID), ("CPF DO TRABALHADOR", .employeeID),
        ("CRACHA", .employeeID), ("CHAPA", .employeeID), ("CODIGO DO FUNCIONARIO", .employeeID),
        ("CODIGO DO EMPREGADO", .employeeID), ("ID FUNCIONARIO", .employeeID), ("REGISTRO", .employeeID),

        ("EMPRESA", .company), ("EMPREGADOR", .company), ("RAZAO SOCIAL", .company),
        ("NOME DO EMPREGADOR", .company), ("NOME DA EMPRESA", .company),

        ("CNPJ", .cnpj), ("CNPJ/CPF", .cnpj), ("CPF/CNPJ", .cnpj), ("CNPJ DO EMPREGADOR", .cnpj),
        ("CPF DO EMPREGADOR", .cnpj), ("CNPJ/CPF DO EMPREGADOR", .cnpj), ("CPF/CNPJ DO EMPREGADOR", .cnpj),

        ("REP", .clockID), ("N REP", .clockID), ("NR REP", .clockID), ("NUMERO DO REP", .clockID),
        ("NUMERO REP", .clockID), ("N DO REP", .clockID), ("ID DO REP", .clockID), ("REP C", .clockID),
        ("REP A", .clockID), ("REP P", .clockID), ("N FABRICACAO", .clockID), ("N DE FABRICACAO", .clockID),
        ("NUMERO DE FABRICACAO", .clockID), ("N FAB", .clockID), ("NUMERO DE SERIE", .clockID),
        ("N SERIE", .clockID), ("RELOGIO", .clockID), ("EQUIPAMENTO", .clockID), ("COLETOR", .clockID),
        ("TERMINAL", .clockID), ("IDENTIFICADOR DO REP", .clockID),

        ("NSR", .ticketNumber), ("N S R", .ticketNumber), ("TICKET", .ticketNumber), ("N TICKET", .ticketNumber),
        ("NUMERO DO TICKET", .ticketNumber), ("COMPROVANTE N", .ticketNumber), ("SEQUENCIAL", .ticketNumber),
        ("N SEQUENCIAL", .ticketNumber), ("NUMERO SEQUENCIAL DO REGISTRO", .ticketNumber),

        ("CODIGO DE AUTENTICACAO", .authCode), ("AUTENTICACAO", .authCode), ("COD AUTENTICACAO", .authCode),
        ("HASH", .authCode), ("CODIGO HASH", .authCode), ("CHAVE", .authCode), ("ASSINATURA", .authCode),
        ("CODIGO", .authCode), ("COD VERIFICACAO", .authCode), ("CODIGO DE VERIFICACAO", .authCode),
        ("CODIGO DE CONTROLE", .authCode), ("CRC", .authCode),

        ("TIPO", .markType), ("TIPO DE MARCACAO", .markType), ("MARCACAO", .markType), ("EVENTO", .markType),
        ("OPERACAO", .markType), ("SENTIDO", .markType), ("MOVIMENTO", .markType),

        ("DATA", .date), ("DATA DO REGISTRO", .date), ("DATA DA MARCACAO", .date), ("DIA", .date),
        ("HORA", .time), ("HORARIO", .time), ("HORA DO REGISTRO", .time), ("DATA/HORA", .date),
        ("DATA E HORA", .date),

        ("LOCAL", .ignored), ("ENDERECO", .ignored), ("CEI", .ignored), ("CAEPF", .ignored), ("CNO", .ignored)
    ]

    /// Maior rótulo conhecido que corresponde ao início do texto (já normalizado).
    static func matchLabel(_ normalized: String, requireExact: Bool) -> (label: String, category: LabelCategory)? {
        var best: (String, LabelCategory)?
        for (label, category) in labels {
            let matches = requireExact ? normalized == label : (normalized == label || normalized.hasPrefix(label + " "))
            if matches, label.count > (best?.0.count ?? 0) { best = (label, category) }
        }
        return best
    }

    // MARK: - Interpretação

    public func parse(lines rawLines: [OCRLine]) -> ParsedTicket {
        let lines = rawLines
            .map { OCRLine(text: TextNormalizer.collapseSpaces($0.text), confidence: $0.confidence) }
            .filter { !$0.text.isEmpty }

        var result = ParsedTicket()
        result.fullText = lines.map(\.text).joined(separator: "\n")
        result.averageConfidence = lines.isEmpty ? 0 : lines.map(\.confidence).reduce(0, +) / Double(lines.count)
        guard !lines.isEmpty else {
            result.warnings.append("Nenhum texto foi reconhecido. Tente outra foto, com mais luz e o ticket inteiro visível.")
            return result
        }

        var dateLines = Set<Int>()
        var timeLines = Set<Int>()
        var markLines = Set<Int>()

        // 1. Pares rótulo/valor
        for (index, line) in lines.enumerated() {
            guard let (label, category, value) = splitLabel(line.text) else { continue }
            let trimmed = value.trimmingCharacters(in: CharacterSet(charactersIn: " :-.\t"))
            switch category {
            case .employeeName:
                if result.employeeName == nil, isPlausibleName(trimmed) {
                    result.employeeName = ExtractedValue(value: trimmed, confidence: line.confidence * 0.97, sourceText: line.text)
                }
            case .employeeID:
                if result.employeeID == nil, let id = extractIdentifier(trimmed, label: label, line: line) {
                    result.employeeID = id
                }
            case .company:
                if result.company == nil, isPlausibleName(trimmed) {
                    result.company = ExtractedValue(value: trimmed, confidence: line.confidence * 0.97, sourceText: line.text)
                }
            case .cnpj:
                if result.cnpj == nil, let cnpj = extractCNPJ(from: trimmed, labeled: true, line: line) {
                    result.cnpj = cnpj
                }
            case .clockID:
                if result.clockID == nil, let code = extractCode(trimmed) {
                    result.clockID = ExtractedValue(value: code, confidence: line.confidence * 0.95, sourceText: line.text)
                }
            case .ticketNumber:
                if result.ticketNumber == nil, let code = extractCode(trimmed) {
                    result.ticketNumber = ExtractedValue(value: code, confidence: line.confidence * 0.95, sourceText: line.text)
                }
            case .authCode:
                if result.authCode == nil, let code = extractCode(trimmed, allowSpaces: true) {
                    result.authCode = ExtractedValue(value: code, confidence: line.confidence * 0.9, sourceText: line.text)
                }
            case .markType:
                markLines.insert(index)
            case .date:
                dateLines.insert(index)
                if TextNormalizer.fold(line.text).contains("HORA") { timeLines.insert(index) }
            case .time:
                timeLines.insert(index)
            case .ignored:
                break
            }
            _ = label
        }

        // 2. CNPJ em qualquer linha (formatado), se não veio por rótulo
        if result.cnpj == nil {
            for line in lines {
                if let cnpj = extractCNPJ(from: line.text, labeled: false, line: line) {
                    result.cnpj = cnpj
                    break
                }
            }
        }

        // 3. Data e hora
        let dateCandidates = lines.enumerated().flatMap { index, line in
            findDates(in: line).map { ($0, index) }
        }
        if let chosen = choose(dateCandidates, preferredLines: dateLines.union(timeLines), lines: lines) {
            result.date = chosen.value
            if let warning = chosen.warning { result.warnings.append("Data: \(warning)") }
        }
        let dateLineIndex = dateCandidates.first(where: { $0.0.value == result.date?.value })?.1
        let timeCandidates = lines.enumerated().flatMap { index, line in
            findTimes(in: line).map { ($0, index) }
        }
        var preferredTimeLines = timeLines
        if let dateLineIndex { preferredTimeLines.insert(dateLineIndex) }
        if let chosen = choose(timeCandidates, preferredLines: preferredTimeLines, lines: lines) {
            result.time = chosen.value
            if let warning = chosen.warning { result.warnings.append("Horário: \(warning)") }
        }

        // 4. Tipo de marcação
        result.markType = findMarkType(lines: lines, labeledLines: markLines)
        if result.markType == nil {
            result.warnings.append("O tipo de marcação (entrada, saída, intervalo) não está impresso ou não foi reconhecido. Informe manualmente.")
        } else if let mark = result.markType, mark.value == .indefinido {
            result.warnings.append("O comprovante cita mais de um tipo de marcação. Confirme qual se aplica.")
        }

        // 5. Empresa sem rótulo: linha com sufixo societário ou imediatamente antes do CNPJ
        if result.company == nil {
            result.company = guessCompany(lines: lines, cnpjSource: result.cnpj?.sourceText)
        }

        // 6. Demais pares rótulo: valor não reconhecidos
        let used = Set([result.employeeName, result.employeeID, result.company, result.cnpj, result.clockID,
                        result.ticketNumber, result.authCode].compactMap { $0?.sourceText })
        for line in lines where !used.contains(line.text) {
            guard let colon = line.text.firstIndex(of: ":") else { continue }
            let label = line.text[..<colon].trimmingCharacters(in: .whitespaces)
            let value = line.text[line.text.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !label.isEmpty, !value.isEmpty, label.count <= 40 else { continue }
            let normalized = TextNormalizer.normalizeLabel(label)
            if let match = Self.matchLabel(normalized, requireExact: false),
               [.date, .time, .markType].contains(match.category) { continue }
            result.otherFields.append(LabeledValue(label: label, value: value))
        }

        if result.date == nil { result.warnings.append("Data do registro não encontrada.") }
        if result.time == nil { result.warnings.append("Horário do registro não encontrado.") }
        if let note = result.cnpj?.note { result.warnings.append("CNPJ: \(note)") }
        if let note = result.employeeID?.note, note.contains("inválido") { result.warnings.append("Identificador: \(note)") }
        return result
    }

    /// Conveniência para texto simples (cada linha com a mesma confiança).
    public func parse(text: String, confidence: Double = 1) -> ParsedTicket {
        parse(lines: text.components(separatedBy: .newlines).map { OCRLine(text: $0, confidence: confidence) })
    }

    // MARK: - Rótulos

    /// Divide "RÓTULO: valor" (ou "RÓTULO valor" para rótulos conhecidos).
    func splitLabel(_ text: String) -> (String, LabelCategory, String)? {
        if let colon = text.firstIndex(of: ":") {
            let rawLabel = String(text[..<colon])
            let normalized = TextNormalizer.normalizeLabel(rawLabel)
            if let match = Self.matchLabel(normalized, requireExact: true) {
                return (match.label, match.category, String(text[text.index(after: colon)...]))
            }
            // Rótulo com complemento sem números antes dos dois-pontos ("NOME DO TRABALHADOR (A):").
            // Se o complemento tiver números, os dois-pontos provavelmente são de um horário
            // ("NSR 000000987 22/10/26 12:03") e a linha é tratada como "RÓTULO valor".
            if let match = Self.matchLabel(normalized, requireExact: false), match.label.count >= 3,
               !normalized.dropFirst(match.label.count).contains(where: \.isNumber) {
                return (match.label, match.category, String(text[text.index(after: colon)...]))
            }
        }
        // Sem dois-pontos: compara palavras iniciais. O número de palavras é preservado na normalização.
        let words = text.split(separator: " ")
        for count in stride(from: min(5, words.count - 1), through: 1, by: -1) {
            let candidate = TextNormalizer.normalizeLabel(words.prefix(count).joined(separator: " "))
            guard candidate.split(separator: " ").count == count,
                  let match = Self.matchLabel(candidate, requireExact: true), match.label.count >= 3 else { continue }
            return (match.label, match.category, words.dropFirst(count).joined(separator: " "))
        }
        return nil
    }

    func isPlausibleName(_ text: String) -> Bool {
        let letters = text.filter(\.isLetter).count
        return letters >= 3 && Double(letters) / Double(max(text.count, 1)) > 0.6
    }

    /// Códigos (REP, NSR, autenticação): letras, dígitos e alguns separadores.
    func extractCode(_ text: String, allowSpaces: Bool = false) -> String? {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-/." + (allowSpaces ? " " : "")))
        let firstToken = allowSpaces ? text : String(text.split(separator: " ").first ?? "")
        let code = String(firstToken.unicodeScalars.filter { allowed.contains($0) }.map(Character.init))
            .trimmingCharacters(in: .whitespaces)
        return code.filter(\.isNumber).isEmpty && code.count < 4 ? nil : (code.isEmpty ? nil : code)
    }

    func extractIdentifier(_ value: String, label: String, line: OCRLine) -> ExtractedValue<String>? {
        let token = value.split(separator: " ").prefix(3).joined(separator: " ")
        guard let code = extractCode(token, allowSpaces: true), code.contains(where: \.isNumber) else { return nil }
        let digits = TextNormalizer.digits(code)
        var confidence = line.confidence * 0.95
        var note: String? = label
        if label.hasPrefix("PIS") || label == "NIT" || label == "PASEP" {
            if DocumentValidators.isValidPIS(digits) {
                note = "PIS válido"
            } else {
                note = "PIS inválido — confira os dígitos"
                confidence *= 0.6
            }
        } else if label.hasPrefix("CPF") {
            if DocumentValidators.isValidCPF(digits) {
                note = "CPF válido"
            } else {
                note = "CPF inválido — confira os dígitos"
                confidence *= 0.6
            }
        }
        return ExtractedValue(value: code, confidence: confidence, sourceText: line.text, note: note)
    }

    // MARK: - CNPJ

    func extractCNPJ(from text: String, labeled: Bool, line: OCRLine) -> ExtractedValue<String>? {
        let upper = text.uppercased()
        var candidates: [String] = Regex.matches(
            #"(?<![0-9A-Z])[0-9A-Z]{2}\s?\.\s?[0-9A-Z]{3}\s?\.\s?[0-9A-Z]{3}\s?/\s?[0-9A-Z]{4}\s?-\s?[0-9]{2}(?![0-9])"#,
            in: upper
        ).compactMap { $0[0] }
        if labeled {
            // Em linha rotulada, aceita também 14 caracteres sem pontuação.
            candidates += Regex.matches(#"[0-9A-Z./\- ]{14,22}"#, in: upper).compactMap { $0[0] }
                .filter { DocumentValidators.compactCNPJ($0).count == 14 }
        }
        for candidate in candidates {
            let compact = DocumentValidators.compactCNPJ(candidate)
            if DocumentValidators.isValidCNPJ(compact) {
                return ExtractedValue(value: DocumentValidators.formatCNPJ(compact), confidence: line.confidence * 0.98, sourceText: line.text)
            }
            // Confusões comuns do OCR em CNPJ numérico: O->0, I/L->1, S->5, B->8
            let fixed = fixDigits(compact)
            if fixed != compact, DocumentValidators.isValidCNPJ(fixed) {
                return ExtractedValue(value: DocumentValidators.formatCNPJ(fixed), confidence: line.confidence * 0.8,
                                      sourceText: line.text, note: "caracteres corrigidos automaticamente — confira")
            }
        }
        if let first = candidates.first {
            let compact = DocumentValidators.compactCNPJ(first)
            if compact.count == 14 {
                return ExtractedValue(value: DocumentValidators.formatCNPJ(compact), confidence: line.confidence * 0.5,
                                      sourceText: line.text, note: "dígitos verificadores não conferem — confira")
            }
        }
        return nil
    }

    // MARK: - Datas

    struct Candidate<Value: Hashable & Codable & Sendable> {
        var value: Value
        var score: Double
        var note: String?
    }

    /// Converte letras confundidas com dígitos dentro de trechos numéricos.
    func fixDigits(_ text: String) -> String {
        String(text.map { char -> Character in
            switch char {
            case "O", "o", "Q", "D": return "0"
            case "I", "l", "|", "i", "L", "!": return "1"
            case "S", "s": return "5"
            case "B": return "8"
            case "Z", "z": return "2"
            default: return char
            }
        })
    }

    static let ocrDigit = "[0-9OoIl|SB]"

    func findDates(in line: OCRLine) -> [Candidate<CalendarDate>] {
        var results: [Candidate<CalendarDate>] = []
        let d = Self.ocrDigit
        // dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa
        for match in Regex.matches("(?<![0-9A-Za-z])(\(d){1,2})\\s?[/.\\-]\\s?(\(d){1,2})\\s?[/.\\-]\\s?(\(d){4}|\(d){2})(?![0-9])", in: line.text) {
            guard let raw = match[0], let dd = match[1], let mm = match[2], let yy = match[3] else { continue }
            let fixed = [dd, mm, yy].map(fixDigits)
            guard let day = Int(fixed[0]), let month = Int(fixed[1]), var year = Int(fixed[2]) else { continue }
            var score = line.confidence
            var note: String?
            if yy.count == 2 { year += 2000; score *= 0.95 }
            if fixed.joined() != [dd, mm, yy].joined() { score *= 0.75; note = "caracteres corrigidos (\(raw))" }
            guard acceptedYears.contains(year), let date = CalendarDate(year: year, month: month, day: day) else { continue }
            results.append(Candidate(value: date, score: score, note: note))
        }
        // aaaa-mm-dd
        for match in Regex.matches(#"(?<![0-9])([0-9]{4})[/.\-]([0-9]{1,2})[/.\-]([0-9]{1,2})(?![0-9])"#, in: line.text) {
            guard let year = Int(match[1] ?? ""), let month = Int(match[2] ?? ""), let day = Int(match[3] ?? ""),
                  acceptedYears.contains(year), let date = CalendarDate(year: year, month: month, day: day) else { continue }
            results.append(Candidate(value: date, score: line.confidence, note: nil))
        }
        // 22 OUT 2026, 22/OUT/26, 22 de outubro de 2026
        let folded = TextNormalizer.fold(line.text)
        let months = PortugueseCalendar.monthAbbreviations.joined(separator: "|")
        for match in Regex.matches("(?<![0-9])([0-9]{1,2})\\s?(?:DE\\s+|[/.\\-]\\s?)?(\(months))[A-Z]*\\.?\\s?(?:DE\\s+|[/.\\-]\\s?)?([0-9]{4}|[0-9]{2})(?![0-9])", in: folded) {
            guard let day = Int(match[1] ?? ""), let monthName = match[2],
                  let monthIndex = PortugueseCalendar.monthAbbreviations.firstIndex(of: monthName),
                  var year = Int(match[3] ?? "") else { continue }
            var score = line.confidence * 0.97
            if (match[3] ?? "").count == 2 { year += 2000; score *= 0.95 }
            guard acceptedYears.contains(year), let date = CalendarDate(year: year, month: monthIndex + 1, day: day) else { continue }
            results.append(Candidate(value: date, score: score, note: nil))
        }
        return results
    }

    // MARK: - Horários

    func findTimes(in line: OCRLine) -> [Candidate<ClockTime>] {
        var results: [Candidate<ClockTime>] = []
        let d = "[0-9OoIl|]"
        let pattern = "(?<![0-9A-Za-z/.,])(\(d){1,2})\\s?[:hH]\\s?(\(d){2})(?:\\s?:\\s?(\(d){2}))?(?![0-9/])"
        for match in Regex.matches(pattern, in: line.text) {
            guard let raw = match[0], let hh = match[1], let mm = match[2] else { continue }
            // Exige ao menos dois dígitos reais para não confundir palavras com horários.
            guard raw.filter(\.isNumber).count >= 2 else { continue }
            let fixedH = fixDigits(hh), fixedM = fixDigits(mm), fixedS = match[3].map(fixDigits)
            guard let hour = Int(fixedH), let minute = Int(fixedM) else { continue }
            let second = fixedS.flatMap { Int($0) }
            guard let time = ClockTime(hour: hour, minute: minute, second: second) else { continue }
            var score = line.confidence
            var note: String?
            if fixedH != hh || fixedM != mm || fixedS != match[3] { score *= 0.75; note = "caracteres corrigidos (\(raw))" }
            if raw.contains("h") || raw.contains("H") { score *= 0.97 }
            results.append(Candidate(value: time, score: score, note: note))
        }
        return results
    }

    // MARK: - Escolha entre candidatos

    func choose<V>(_ candidates: [(Candidate<V>, Int)], preferredLines: Set<Int>, lines: [OCRLine]) -> (value: ExtractedValue<V>, warning: String?)? {
        guard !candidates.isEmpty else { return nil }
        let ranked = candidates.map { candidate, index -> (Candidate<V>, Int, Double) in
            (candidate, index, candidate.score * (preferredLines.isEmpty || preferredLines.contains(index) ? 1.0 : 0.92))
        }.sorted { $0.2 > $1.2 }
        let best = ranked[0]
        let distinct = Set(candidates.map { $0.0.value })
        var confidence = best.2
        var warning: String?
        if distinct.count > 1 {
            // Valores diferentes no mesmo ticket: nunca assumir. Reduz a confiança para exigir confirmação.
            confidence = min(confidence * 0.6, ParsedTicket.confirmationThreshold - 0.05)
            warning = "foram encontrados \(distinct.count) valores diferentes; confirme o correto."
        }
        return (ExtractedValue(value: best.0.value, confidence: confidence, sourceText: lines[best.1].text, note: best.0.note), warning)
    }

    // MARK: - Tipo de marcação

    static let markPhrases: [(String, MarkType)] = [
        ("INICIO DO INTERVALO", .inicioIntervalo), ("INICIO INTERVALO", .inicioIntervalo), ("INICIO DE INTERVALO", .inicioIntervalo),
        ("SAIDA PARA INTERVALO", .inicioIntervalo), ("SAIDA INTERVALO", .inicioIntervalo), ("SAIDA PARA ALMOCO", .inicioIntervalo),
        ("SAIDA ALMOCO", .inicioIntervalo), ("SAIDA REFEICAO", .inicioIntervalo), ("SAIDA PARA REFEICAO", .inicioIntervalo),
        ("INTERVALO INICIO", .inicioIntervalo), ("INI INTERVALO", .inicioIntervalo),
        ("FIM DO INTERVALO", .fimIntervalo), ("FIM INTERVALO", .fimIntervalo), ("FIM DE INTERVALO", .fimIntervalo),
        ("RETORNO DO INTERVALO", .fimIntervalo), ("RETORNO INTERVALO", .fimIntervalo), ("RETORNO DE INTERVALO", .fimIntervalo),
        ("RETORNO DO ALMOCO", .fimIntervalo), ("RETORNO ALMOCO", .fimIntervalo), ("VOLTA DO ALMOCO", .fimIntervalo),
        ("VOLTA ALMOCO", .fimIntervalo), ("RETORNO REFEICAO", .fimIntervalo), ("INTERVALO FIM", .fimIntervalo),
        ("RETORNO", .fimIntervalo),
        ("ENTRADA", .entrada),
        ("SAIDA", .saida)
    ]

    func findMarkType(lines: [OCRLine], labeledLines: Set<Int>) -> ExtractedValue<MarkType>? {
        var found: [(MarkType, Double, String)] = []
        for (index, line) in lines.enumerated() {
            var text = " " + TextNormalizer.normalizeLabel(line.text) + " "
            // Cabeçalhos genéricos não indicam o tipo da marcação.
            for header in ["REGISTRO DE ENTRADA E SAIDA", "ENTRADA E SAIDA", "ENTRADA/SAIDA", "ENTRADAS E SAIDAS"] {
                text = text.replacingOccurrences(of: header, with: " ")
            }
            for (phrase, type) in Self.markPhrases where text.contains(" \(phrase) ") {
                let factor = labeledLines.contains(index) ? 0.97 : 0.9
                found.append((type, line.confidence * factor, line.text))
                // Remove a frase para não contar "SAIDA" de "SAIDA ALMOCO" como saída.
                text = text.replacingOccurrences(of: " \(phrase) ", with: " ")
            }
        }
        guard let first = found.first else { return nil }
        let types = Set(found.map(\.0))
        if types.count > 1 {
            return ExtractedValue(value: .indefinido, confidence: 0, sourceText: found.map(\.2).joined(separator: " | "),
                                  note: "tipos conflitantes: " + found.map(\.0.label).joined(separator: ", "))
        }
        return ExtractedValue(value: first.0, confidence: found.map(\.1).max() ?? first.1, sourceText: first.2)
    }

    // MARK: - Empresa sem rótulo

    static let companySuffixes = ["LTDA", "S/A", "S A", "SA", "ME", "EPP", "EIRELI", "MEI", "CIA", "COMERCIO", "INDUSTRIA",
                                  "SERVICOS", "HOSPITAL", "SUPERMERCADO", "SUPERMERCADOS", "ASSOCIACAO", "COOPERATIVA",
                                  "FUNDACAO", "INSTITUTO", "CONDOMINIO", "LOJAS"]
    static let headerWords = ["COMPROVANTE", "REGISTRO DE PONTO", "PONTO DO TRABALHADOR", "CNPJ", "LOCAL", "ENDERECO"]

    func guessCompany(lines: [OCRLine], cnpjSource: String?) -> ExtractedValue<String>? {
        for line in lines.prefix(8) {
            let normalized = TextNormalizer.normalizeLabel(line.text)
            let words = Set(normalized.split(separator: " ").map(String.init))
            guard !Self.headerWords.contains(where: { normalized.contains($0) }), isPlausibleName(line.text) else { continue }
            if Self.companySuffixes.contains(where: { suffix in
                suffix.contains(" ") ? normalized.contains(suffix) : words.contains(suffix)
            }) {
                return ExtractedValue(value: line.text, confidence: line.confidence * 0.75, sourceText: line.text,
                                      note: "identificada sem rótulo — confira")
            }
        }
        if let cnpjSource, let cnpjIndex = lines.firstIndex(where: { $0.text == cnpjSource }), cnpjIndex > 0 {
            let previous = lines[cnpjIndex - 1]
            let normalized = TextNormalizer.normalizeLabel(previous.text)
            if !Self.headerWords.contains(where: { normalized.contains($0) }), isPlausibleName(previous.text),
               splitLabel(previous.text) == nil {
                return ExtractedValue(value: previous.text, confidence: previous.confidence * 0.6, sourceText: previous.text,
                                      note: "identificada pela posição — confira")
            }
        }
        return nil
    }
}
