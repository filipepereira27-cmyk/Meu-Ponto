import Foundation

/// Tipo de marcação do comprovante.
///
/// `indefinido` significa que o tipo não foi impresso ou não foi reconhecido.
/// O app nunca deduz o tipo pela posição da marcação no dia.
public enum MarkType: String, Codable, CaseIterable, Sendable, Identifiable {
    case entrada
    case saida
    case inicioIntervalo
    case fimIntervalo
    case indefinido

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .entrada: return "Entrada"
        case .saida: return "Saída"
        case .inicioIntervalo: return "Início de intervalo"
        case .fimIntervalo: return "Fim de intervalo"
        case .indefinido: return "Não identificado"
        }
    }

    /// Marcação que inicia um período trabalhado.
    public var startsWork: Bool { self == .entrada || self == .fimIntervalo }
    /// Marcação que encerra um período trabalhado.
    public var endsWork: Bool { self == .saida || self == .inicioIntervalo }
}
