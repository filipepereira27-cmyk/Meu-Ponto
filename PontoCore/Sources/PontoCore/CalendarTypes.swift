import Foundation

/// Data civil (dia/mês/ano) sem fuso horário.
///
/// Comprovantes de ponto registram a hora local do relógio. Guardar como `Date`
/// introduziria conversões de fuso que poderiam mudar o dia do registro, por isso
/// data e horário impressos são mantidos como valores civis independentes.
public struct CalendarDate: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let year: Int
    public let month: Int
    public let day: Int

    /// Calendário gregoriano em UTC usado apenas para aritmética de datas (sem horário de verão).
    static let gregorianUTC: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    /// Cria uma data validando dia/mês/ano (ex.: 31/02 retorna `nil`).
    public init?(year: Int, month: Int, day: Int) {
        guard (1...12).contains(month), (1...31).contains(day), (1900...2999).contains(year) else { return nil }
        let components = DateComponents(year: year, month: month, day: day)
        guard let date = Self.gregorianUTC.date(from: components) else { return nil }
        let check = Self.gregorianUTC.dateComponents([.year, .month, .day], from: date)
        guard check.year == year, check.month == month, check.day == day else { return nil }
        self.year = year
        self.month = month
        self.day = day
    }

    /// Cria a partir de uma chave `yyyy-MM-dd`.
    public init?(key: String) {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    /// Data civil de um instante, no fuso informado.
    public init(date: Date, timeZone: TimeZone = .current) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        self.year = c.year!
        self.month = c.month!
        self.day = c.day!
    }

    /// Chave ordenável e pesquisável (`2026-10-22`).
    public var key: String { String(format: "%04d-%02d-%02d", year, month, day) }

    /// Formato brasileiro (`22/10/2026`).
    public var brazilian: String { String(format: "%02d/%02d/%04d", day, month, year) }

    public var description: String { brazilian }

    /// Meio-dia UTC deste dia — referência estável para aritmética.
    var utcNoon: Date {
        Self.gregorianUTC.date(from: DateComponents(year: year, month: month, day: day, hour: 12))!
    }

    /// Dia da semana: 1 = domingo ... 7 = sábado.
    public var weekday: Int { Self.gregorianUTC.component(.weekday, from: utcNoon) }

    public func adding(days: Int) -> CalendarDate {
        let date = Self.gregorianUTC.date(byAdding: .day, value: days, to: utcNoon)!
        return CalendarDate(date: date, timeZone: TimeZone(identifier: "UTC")!)
    }

    /// Número de dias de `self` até `other` (positivo se `other` for posterior).
    public func days(to other: CalendarDate) -> Int {
        Self.gregorianUTC.dateComponents([.day], from: utcNoon, to: other.utcNoon).day!
    }

    /// Instante correspondente a este dia + horário no fuso informado.
    public func date(at time: ClockTime? = nil, timeZone: TimeZone = .current) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar.date(from: DateComponents(
            year: year, month: month, day: day,
            hour: time?.hour ?? 0, minute: time?.minute ?? 0, second: time?.second ?? 0
        ))!
    }

    public static func < (lhs: CalendarDate, rhs: CalendarDate) -> Bool { lhs.key < rhs.key }

    // Codable como string `yyyy-MM-dd`, legível em backups e exportações.
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let value = CalendarDate(key: raw) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Data inválida: \(raw)")
        }
        self = value
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(key)
    }
}

/// Horário civil impresso no comprovante.
public struct ClockTime: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public let hour: Int
    public let minute: Int
    /// Segundos são opcionais: muitos comprovantes imprimem apenas HH:MM.
    public let second: Int?

    public init?(hour: Int, minute: Int, second: Int? = nil) {
        guard (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        if let second, !(0...59).contains(second) { return nil }
        self.hour = hour
        self.minute = minute
        self.second = second
    }

    /// Cria a partir de segundos desde a meia-noite.
    public init?(secondsOfDay: Int) {
        guard (0..<86_400).contains(secondsOfDay) else { return nil }
        let s = secondsOfDay % 60
        self.init(hour: secondsOfDay / 3600, minute: (secondsOfDay % 3600) / 60, second: s == 0 ? nil : s)
    }

    /// Interpreta `HH:MM` ou `HH:MM:SS`.
    public init?(string: String) {
        let parts = string.trimmingCharacters(in: .whitespaces).split(separator: ":").map { Int($0) }
        guard parts.count == 2 || parts.count == 3, parts.allSatisfy({ $0 != nil }) else { return nil }
        self.init(hour: parts[0]!, minute: parts[1]!, second: parts.count == 3 ? parts[2] : nil)
    }

    public var secondsOfDay: Int { hour * 3600 + minute * 60 + (second ?? 0) }
    public var minutesOfDay: Int { hour * 60 + minute }

    /// `08:01` ou `08:01:33`.
    public var formatted: String {
        if let second { return String(format: "%02d:%02d:%02d", hour, minute, second) }
        return String(format: "%02d:%02d", hour, minute)
    }

    public var description: String { formatted }

    public static func < (lhs: ClockTime, rhs: ClockTime) -> Bool { lhs.secondsOfDay < rhs.secondsOfDay }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard let value = ClockTime(string: raw) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Horário inválido: \(raw)")
        }
        self = value
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(formatted)
    }
}

/// Mês de referência (para filtros e resumos mensais).
public struct YearMonth: Hashable, Comparable, Codable, Sendable {
    public let year: Int
    public let month: Int

    public init(year: Int, month: Int) {
        self.year = year
        self.month = month
    }

    public init(_ date: CalendarDate) {
        self.init(year: date.year, month: date.month)
    }

    public var firstDay: CalendarDate { CalendarDate(year: year, month: month, day: 1)! }

    public var numberOfDays: Int {
        let range = CalendarDate.gregorianUTC.range(of: .day, in: .month, for: firstDay.utcNoon)!
        return range.count
    }

    public var days: [CalendarDate] {
        (0..<numberOfDays).map { firstDay.adding(days: $0) }
    }

    public func adding(months: Int) -> YearMonth {
        let total = year * 12 + (month - 1) + months
        return YearMonth(year: total / 12, month: total % 12 + 1)
    }

    public func contains(_ date: CalendarDate) -> Bool { date.year == year && date.month == month }

    /// "outubro de 2026"
    public var longName: String { "\(PortugueseCalendar.monthNames[month - 1]) de \(year)" }

    public static func < (lhs: YearMonth, rhs: YearMonth) -> Bool {
        (lhs.year, lhs.month) < (rhs.year, rhs.month)
    }
}

/// Nomes em português usados na busca textual e nos relatórios.
public enum PortugueseCalendar {
    public static let monthNames = [
        "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ]
    /// Abreviações (sem acento, maiúsculas) como aparecem em comprovantes.
    public static let monthAbbreviations = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]
    /// 1 = domingo.
    public static let weekdayNames = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"]
    public static let weekdayShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]
}

/// Formata durações em minutos como `7h48`, `-0h12`.
public enum DurationFormatter {
    public static func string(minutes: Int, showSign: Bool = false) -> String {
        let sign = minutes < 0 ? "-" : (showSign && minutes > 0 ? "+" : "")
        let value = abs(minutes)
        return "\(sign)\(value / 60)h\(String(format: "%02d", value % 60))"
    }
}
