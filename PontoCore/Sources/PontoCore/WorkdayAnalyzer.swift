import Foundation

/// Jornada de trabalho configurada pelo usuário (referência para comparação).
public struct WorkSchedule: Hashable, Codable, Sendable {
    /// Minutos previstos por dia da semana (índice 0 = domingo ... 6 = sábado).
    public var expectedMinutesByWeekday: [Int]
    /// Intervalo mínimo esperado em jornadas longas (minutos).
    public var minimumBreakMinutes: Int
    /// Jornada a partir da qual o intervalo mínimo é esperado (minutos).
    public var breakRequiredAfterMinutes: Int
    /// Tolerância diária para diferenças em relação à jornada prevista (minutos).
    public var dailyToleranceMinutes: Int

    public init(expectedMinutesByWeekday: [Int] = [0, 480, 480, 480, 480, 480, 0],
                minimumBreakMinutes: Int = 60,
                breakRequiredAfterMinutes: Int = 360,
                dailyToleranceMinutes: Int = 10) {
        precondition(expectedMinutesByWeekday.count == 7)
        self.expectedMinutesByWeekday = expectedMinutesByWeekday
        self.minimumBreakMinutes = minimumBreakMinutes
        self.breakRequiredAfterMinutes = breakRequiredAfterMinutes
        self.dailyToleranceMinutes = dailyToleranceMinutes
    }

    public static let standard = WorkSchedule()

    public func expectedMinutes(on date: CalendarDate) -> Int {
        expectedMinutesByWeekday[date.weekday - 1]
    }
}

/// Uma marcação posicionada na linha do tempo da jornada.
public struct WorkdayMark: Hashable, Sendable {
    public var ticketID: UUID
    public var date: CalendarDate
    public var time: ClockTime
    public var type: MarkType
    /// Minutos desde a meia-noite do dia da jornada (pode passar de 1440 em turnos noturnos).
    public var minuteInJourney: Int
}

public struct WorkPeriod: Hashable, Sendable {
    public var start: WorkdayMark
    public var end: WorkdayMark
    public var minutes: Int { end.minuteInJourney - start.minuteInJourney }
}

/// Pendências encontradas na jornada. São indícios para conferência, não conclusões.
public enum WorkdayIssue: Hashable, Sendable {
    case undefinedMarkTypes(count: Int)
    case missingTime(count: Int)
    case consecutiveStarts(at: ClockTime)
    case endWithoutStart(at: ClockTime)
    case openPeriod(since: ClockTime)
    case breakShorterThanReference(minutes: Int)
    case noBreakRecorded
    case oddNumberOfMarks

    public var message: String {
        switch self {
        case .undefinedMarkTypes(let count):
            return "\(count) marcação(ões) sem tipo confirmado. Confirme entrada/saída para calcular a jornada."
        case .missingTime(let count):
            return "\(count) ticket(s) deste dia sem horário reconhecido."
        case .consecutiveStarts(let time):
            return "Duas marcações de início seguidas (\(time.formatted)). Pode haver uma marcação de saída ausente."
        case .endWithoutStart(let time):
            return "Marcação de saída/intervalo às \(time.formatted) sem início correspondente. Pode haver uma entrada ausente."
        case .openPeriod(let time):
            return "Período iniciado às \(time.formatted) sem marcação de encerramento. Pode haver uma saída ausente."
        case .breakShorterThanReference(let minutes):
            return "Intervalo registrado de \(DurationFormatter.string(minutes: minutes)), menor que a referência configurada."
        case .noBreakRecorded:
            return "Nenhum intervalo registrado em jornada acima da referência configurada."
        case .oddNumberOfMarks:
            return "Número ímpar de marcações. Pode haver marcação ausente."
        }
    }
}

/// Resumo de um dia de trabalho.
public struct WorkdaySummary: Hashable, Sendable, Identifiable {
    public var id: String { date.key }
    public var date: CalendarDate
    public var marks: [WorkdayMark]
    /// Intervalo entre marcações consecutivas, na ordem (minutos).
    public var gapsBetweenMarks: [Int]
    public var periods: [WorkPeriod]
    public var breaks: [Int]
    /// Tempo trabalhado calculado. `nil` quando os tipos não permitem calcular.
    public var workedMinutes: Int?
    public var expectedMinutes: Int
    public var issues: [WorkdayIssue]

    /// O cálculo é uma estimativa quando há pendências.
    public var isEstimate: Bool { !issues.isEmpty }

    /// Diferença em relação à jornada configurada (positivo = acima). Apenas indicativo.
    public var balanceMinutes: Int? { workedMinutes.map { $0 - expectedMinutes } }

    public var totalBreakMinutes: Int { breaks.reduce(0, +) }
}

public struct MonthSummary: Hashable, Sendable {
    public var month: YearMonth
    public var days: [WorkdaySummary]
    /// Soma apenas dos dias sem pendências.
    public var workedMinutesConfirmedDays: Int
    public var expectedMinutesConfirmedDays: Int
    public var daysWithIssues: Int
    public var daysWithoutCalculation: Int
    /// Dias úteis pela jornada configurada que não têm nenhum ticket.
    public var expectedDaysWithoutTickets: [CalendarDate]

    public var balanceMinutesConfirmedDays: Int { workedMinutesConfirmedDays - expectedMinutesConfirmedDays }
    public var isEstimate: Bool { daysWithIssues > 0 || daysWithoutCalculation > 0 || !expectedDaysWithoutTickets.isEmpty }
}

/// Análise opcional da jornada a partir dos tickets.
///
/// Regras importantes:
/// - O tipo de cada marcação vem do ticket (impresso ou confirmado pelo usuário).
///   Nunca se presume que a primeira marcação é entrada ou a última é saída.
/// - Os resultados são comparações com a jornada configurada, não conclusões sobre
///   horas extras, atrasos, faltas ou infrações.
public struct WorkdayAnalyzer: Sendable {
    public var schedule: WorkSchedule

    public init(schedule: WorkSchedule = .standard) {
        self.schedule = schedule
    }

    /// Agrupa os tickets por dia de jornada (data impressa ou associação manual).
    public func group(_ records: [TicketRecord]) -> [CalendarDate: [TicketRecord]] {
        Dictionary(grouping: records.filter { $0.workdayDate != nil }, by: { $0.workdayDate! })
    }

    public func summarize(day: CalendarDate, records: [TicketRecord]) -> WorkdaySummary {
        var issues: [WorkdayIssue] = []
        let withoutTime = records.filter { $0.recordTime == nil || $0.recordDate == nil }
        if !withoutTime.isEmpty { issues.append(.missingTime(count: withoutTime.count)) }

        let marks: [WorkdayMark] = records.compactMap { record in
            guard let date = record.recordDate, let time = record.recordTime else { return nil }
            let offset = day.days(to: date) * 1440
            return WorkdayMark(ticketID: record.id, date: date, time: time, type: record.markType,
                               minuteInJourney: offset + time.minutesOfDay)
        }.sorted { ($0.minuteInJourney, $0.time.secondsOfDay) < ($1.minuteInJourney, $1.time.secondsOfDay) }

        let gaps = zip(marks, marks.dropFirst()).map { $1.minuteInJourney - $0.minuteInJourney }
        let undefined = marks.filter { $0.type == .indefinido }.count
        var periods: [WorkPeriod] = []
        var breaks: [Int] = []
        var worked: Int?

        if undefined > 0 {
            issues.append(.undefinedMarkTypes(count: undefined))
            if marks.count % 2 == 1 { issues.append(.oddNumberOfMarks) }
        } else {
            var open: WorkdayMark?
            var lastEnd: WorkdayMark?
            for mark in marks {
                if mark.type.startsWork {
                    if open != nil { issues.append(.consecutiveStarts(at: mark.time)) }
                    if let end = lastEnd, open == nil { breaks.append(mark.minuteInJourney - end.minuteInJourney) }
                    open = mark
                    lastEnd = nil
                } else if mark.type.endsWork {
                    if let start = open {
                        periods.append(WorkPeriod(start: start, end: mark))
                        open = nil
                        lastEnd = mark
                    } else {
                        issues.append(.endWithoutStart(at: mark.time))
                    }
                }
            }
            if let open { issues.append(.openPeriod(since: open.time)) }
            if !marks.isEmpty { worked = periods.reduce(0) { $0 + $1.minutes } }

            if let worked, issues.isEmpty, worked > schedule.breakRequiredAfterMinutes {
                if breaks.isEmpty {
                    issues.append(.noBreakRecorded)
                } else if breaks.reduce(0, +) < schedule.minimumBreakMinutes {
                    issues.append(.breakShorterThanReference(minutes: breaks.reduce(0, +)))
                }
            }
        }

        return WorkdaySummary(date: day, marks: marks, gapsBetweenMarks: gaps, periods: periods, breaks: breaks,
                              workedMinutes: worked, expectedMinutes: schedule.expectedMinutes(on: day), issues: issues)
    }

    /// Resumos de todos os dias com tickets, em ordem cronológica.
    public func summarizeAll(_ records: [TicketRecord]) -> [WorkdaySummary] {
        group(records).map { summarize(day: $0.key, records: $0.value) }.sorted { $0.date < $1.date }
    }

    public func summarize(month: YearMonth, records: [TicketRecord], until today: CalendarDate? = nil) -> MonthSummary {
        let days = summarizeAll(records.filter { $0.workdayDate.map(month.contains) ?? false })
        // Avisos sobre intervalo são informativos; os demais impedem somar o dia ao total.
        let hasBlockingIssue: (WorkdaySummary) -> Bool = { day in
            day.issues.contains { issue in
                switch issue {
                case .breakShorterThanReference, .noBreakRecorded: return false
                default: return true
                }
            }
        }
        let calculable = days.filter { $0.workedMinutes != nil && !hasBlockingIssue($0) }
        let daysWithTickets = Set(days.map(\.date))
        // "Sem ticket" só considera dias que já passaram.
        let missing = month.days.filter { day in
            schedule.expectedMinutes(on: day) > 0 && !daysWithTickets.contains(day) && (today.map { day < $0 } ?? true)
        }
        return MonthSummary(
            month: month,
            days: days,
            workedMinutesConfirmedDays: calculable.reduce(0) { $0 + ($1.workedMinutes ?? 0) },
            expectedMinutesConfirmedDays: calculable.reduce(0) { $0 + $1.expectedMinutes },
            daysWithIssues: days.filter { !$0.issues.isEmpty }.count,
            daysWithoutCalculation: days.filter { $0.workedMinutes == nil }.count,
            expectedDaysWithoutTickets: missing
        )
    }
}
