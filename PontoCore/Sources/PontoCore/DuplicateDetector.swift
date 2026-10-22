import Foundation

/// Hash perceptual por diferença (dHash) de 64 bits.
///
/// O app reduz a imagem para 9×8 pixels em tons de cinza e passa os valores para cá.
/// Fotos do mesmo ticket tiradas em momentos diferentes produzem hashes próximos.
public enum DifferenceHash {
    public static let width = 9
    public static let height = 8

    /// `pixels`: 72 valores de luminância (linha a linha, 9 colunas × 8 linhas).
    public static func compute(grayscale pixels: [UInt8]) -> UInt64? {
        guard pixels.count == width * height else { return nil }
        var hash: UInt64 = 0
        var bit: UInt64 = 0
        for row in 0..<height {
            for column in 0..<(width - 1) {
                let left = pixels[row * width + column]
                let right = pixels[row * width + column + 1]
                if left > right { hash |= (1 << bit) }
                bit += 1
            }
        }
        return hash
    }

    /// Número de bits diferentes (0 = idênticas, 64 = opostas).
    public static func distance(_ a: UInt64, _ b: UInt64) -> Int {
        (a ^ b).nonzeroBitCount
    }
}

/// Possível duplicidade entre dois tickets. O app apenas sinaliza: a decisão é sempre do usuário.
public struct DuplicateMatch: Hashable, Sendable {
    public enum Reason: String, Hashable, Sendable {
        case sameAuthCode = "Mesmo código de autenticação"
        case sameTicketNumber = "Mesmo NSR / nº do ticket no mesmo relógio"
        case sameDateTimeAndType = "Mesma data, horário e tipo de marcação"
        case similarImage = "Imagens muito parecidas"
    }

    public var first: UUID
    public var second: UUID
    public var reasons: [Reason]

    /// Coincidências de código são fortes; data/hora iguais ou imagem parecida são indícios.
    public var isStrong: Bool { reasons.contains(.sameAuthCode) || reasons.contains(.sameTicketNumber) || reasons.count >= 2 }
}

public enum DuplicateDetector {
    /// Distância máxima de dHash para considerar imagens parecidas.
    public static let imageDistanceThreshold = 6

    public static func compare(_ a: TicketRecord, _ b: TicketRecord) -> DuplicateMatch? {
        guard a.id != b.id else { return nil }
        var reasons: [DuplicateMatch.Reason] = []
        func normalized(_ text: String) -> String { TextNormalizer.fold(text).filter { $0.isLetter || $0.isNumber } }

        if !normalized(a.authCode).isEmpty, normalized(a.authCode) == normalized(b.authCode) {
            reasons.append(.sameAuthCode)
        }
        let numberA = normalized(a.ticketNumber).drop(while: { $0 == "0" })
        let numberB = normalized(b.ticketNumber).drop(while: { $0 == "0" })
        if !numberA.isEmpty, numberA == numberB, normalized(a.clockID) == normalized(b.clockID) {
            reasons.append(.sameTicketNumber)
        }
        if let da = a.recordDate, da == b.recordDate,
           let ta = a.recordTime, let tb = b.recordTime, ta.minutesOfDay == tb.minutesOfDay,
           a.markType == b.markType,
           a.company.isEmpty || b.company.isEmpty || normalized(a.company) == normalized(b.company) {
            reasons.append(.sameDateTimeAndType)
        }
        if let ha = a.imageHash, let hb = b.imageHash, DifferenceHash.distance(ha, hb) <= imageDistanceThreshold {
            reasons.append(.similarImage)
        }
        return reasons.isEmpty ? nil : DuplicateMatch(first: a.id, second: b.id, reasons: reasons)
    }

    /// Possíveis duplicatas de um novo ticket em relação aos existentes.
    public static func matches(for candidate: TicketRecord, in existing: [TicketRecord]) -> [DuplicateMatch] {
        existing.compactMap { compare(candidate, $0) }
    }

    /// Todas as duplicidades no arquivo.
    ///
    /// Para escalar a milhares de tickets, só compara em detalhe os pares que compartilham
    /// alguma chave (código, NSR, data+hora) ou cujos hashes de imagem são próximos
    /// (comparação de inteiros, barata mesmo com todos os pares).
    public static func allMatches(in records: [TicketRecord]) -> [DuplicateMatch] {
        func normalized(_ text: String) -> String { TextNormalizer.fold(text).filter { $0.isLetter || $0.isNumber } }
        var buckets: [String: [Int]] = [:]
        for (index, record) in records.enumerated() {
            let auth = normalized(record.authCode)
            if !auth.isEmpty { buckets["a:" + auth, default: []].append(index) }
            let number = String(normalized(record.ticketNumber).drop(while: { $0 == "0" }))
            if !number.isEmpty { buckets["n:" + number, default: []].append(index) }
            if let date = record.recordDate, let time = record.recordTime {
                buckets["d:\(date.key) \(time.minutesOfDay)", default: []].append(index)
            }
        }
        var pairs = Set<[Int]>()
        for indices in buckets.values where indices.count > 1 {
            for i in indices.indices {
                for j in indices.indices where j > i { pairs.insert([indices[i], indices[j]]) }
            }
        }
        let hashed = records.indices.compactMap { index in records[index].imageHash.map { (index, $0) } }
        for i in hashed.indices {
            for j in hashed.indices where j > i
                && DifferenceHash.distance(hashed[i].1, hashed[j].1) <= imageDistanceThreshold {
                pairs.insert([hashed[i].0, hashed[j].0])
            }
        }
        return pairs.sorted { ($0[0], $0[1]) < ($1[0], $1[1]) }
            .compactMap { compare(records[$0[0]], records[$0[1]]) }
    }
}
