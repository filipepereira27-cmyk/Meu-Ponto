import { brDate, dayOf, hhmm, minutesOf } from './calendar';
import { fold } from './text';
import { compactCNPJ, formatCNPJ } from './validators';
import { CONFIRMATION_THRESHOLD, FIELD_LABEL, type Extracted, type ParsedTicket, type TicketRecord } from './types';

/**
 * Usa os tickets já CONFIRMADOS pelo usuário para melhorar e conferir uma nova leitura:
 *
 * 1. Valores conhecidos: nome, matrícula, empresa, CNPJ e relógio quase nunca mudam.
 *    Uma leitura muito parecida com um valor já confirmado é corrigida para ele
 *    ("…LTIA" → "…LTDA"), e um valor idêntico ganha confiança.
 * 2. Sequência do NSR: no mesmo relógio, o NSR só cresce com o tempo. Se a ordem não
 *    bater com a data/hora, algum dos dois foi lido errado → pede conferência.
 * 3. Plausibilidade: data no futuro ou horário depois do momento da foto.
 *
 * Toda correção é informada ao usuário e registrada no histórico do ticket.
 */

type StableField = 'employeeName' | 'employeeID' | 'company' | 'cnpj' | 'clockID';
const STABLE: StableField[] = ['employeeName', 'employeeID', 'company', 'cnpj', 'clockID'];
/** Campos que podem ser preenchidos quando faltam (o relógio pode variar entre filiais). */
const FILLABLE = new Set<StableField>(['employeeName', 'employeeID', 'company', 'cnpj']);
/** Vezes que um valor precisa ter sido confirmado para preencher um campo vazio. */
const MIN_CONFIRMATIONS_TO_FILL = 3;

export interface KnowledgeResult {
  parsed: ParsedTicket;
  /** Ajustes feitos (para mostrar ao usuário). */
  adjustments: string[];
  /** Conflitos encontrados (pedem conferência). */
  warnings: string[];
}

const key = (field: StableField, value: string) =>
  field === 'cnpj' ? compactCNPJ(value) : fold(value).replace(/[^A-Z0-9]/g, '');

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Diferença máxima aceita para corrigir automaticamente (proporcional ao tamanho). */
const maxDistance = (field: StableField, length: number) =>
  field === 'cnpj' ? 2 : length <= 6 ? 1 : length <= 15 ? 2 : 3;

const nsrNumber = (s: string) => (/^\d+$/.test(s.replace(/\D/g, '')) && /\d/.test(s) ? Number(s.replace(/\D/g, '')) : undefined);
const stamp = (r: { date?: string; time?: string }) => (r.date && r.time ? `${r.date} ${r.time.padEnd(8, ':00').slice(0, 8)}` : undefined);

export function applyKnowledge(input: ParsedTicket, history: TicketRecord[], now: Date = new Date()): KnowledgeResult {
  const parsed: ParsedTicket = { ...input, warnings: [...input.warnings] };
  const adjustments: string[] = [];
  const warnings: string[] = [];
  const confirmed = history.filter((r) => r.isConfirmed);

  // ─── 1. Valores conhecidos ────────────────────────────────────────────────────
  for (const field of STABLE) {
    const counts = new Map<string, { value: string; n: number }>();
    for (const r of confirmed) {
      const v = r[field].trim();
      if (!v) continue;
      const k = key(field, v);
      if (!k) continue;
      counts.set(k, { value: v, n: (counts.get(k)?.n ?? 0) + 1 });
    }
    if (!counts.size) continue;
    const current = parsed[field] as Extracted<string> | undefined;

    if (current) {
      const k = key(field, current.value);
      if (counts.has(k)) {
        // Igual a um valor já confirmado: leitura confiável.
        parsed[field] = { ...current, confidence: Math.max(current.confidence, 0.95) };
        continue;
      }
      const ranked = [...counts.entries()]
        .map(([known, info]) => ({ known, info, d: editDistance(k, known) }))
        .sort((a, b) => a.d - b.d || b.info.n - a.info.n);
      const best = ranked[0];
      const limit = Math.min(maxDistance(field, best.known.length), Math.floor(best.known.length * 0.25));
      const unique = ranked.length === 1 || ranked[1].d > best.d;
      if (best.d > 0 && best.d <= limit && unique) {
        const value = field === 'cnpj' ? formatCNPJ(best.info.value) : best.info.value;
        parsed[field] = { ...current, value, confidence: 0.9, note: `corrigido de “${current.value}” para valor já confirmado` };
        adjustments.push(`${FIELD_LABEL[field]}: “${current.value}” corrigido para “${value}”, igual aos seus tickets anteriores.`);
      }
    } else if (FILLABLE.has(field) && counts.size === 1) {
      const only = [...counts.values()][0];
      if (only.n >= MIN_CONFIRMATIONS_TO_FILL) {
        // Abaixo do limite de confiança: aparece destacado para o usuário conferir.
        parsed[field] = { value: only.value, confidence: 0.8, source: '', note: 'preenchido com o valor dos tickets anteriores' };
        adjustments.push(`${FIELD_LABEL[field]}: não foi lido; preenchido com “${only.value}”, dos seus tickets anteriores. Confira.`);
      }
    }
  }

  // ─── 2. Sequência do NSR ──────────────────────────────────────────────────────
  const nsr = parsed.ticketNumber ? nsrNumber(parsed.ticketNumber.value) : undefined;
  if (nsr !== undefined) {
    const clock = parsed.clockID ? key('clockID', parsed.clockID.value) : '';
    const clocks = new Set(confirmed.map((r) => key('clockID', r.clockID)).filter(Boolean));
    // Sem relógio legível, só compara se todos os tickets confirmados são do mesmo relógio.
    const sameClock = confirmed.filter((r) => {
      const c = key('clockID', r.clockID);
      return clock ? c === clock : clocks.size === 1 && !!c;
    });
    const seq = sameClock
      .map((r) => ({ r, n: nsrNumber(r.ticketNumber), at: stamp({ date: r.recordDate, time: r.recordTime }) }))
      .filter((x): x is { r: TicketRecord; n: number; at: string } => x.n !== undefined && x.at !== undefined && x.n !== nsr);
    const before = seq.filter((x) => x.n < nsr).sort((a, b) => b.n - a.n)[0];
    const after = seq.filter((x) => x.n > nsr).sort((a, b) => a.n - b.n)[0];
    const at = stamp({ date: parsed.date?.value, time: parsed.time?.value });
    const describe = (x: { r: TicketRecord; n: number }) => `o ticket de ${brDate(x.r.recordDate!)} ${hhmm(x.r.recordTime!)} tem NSR ${x.r.ticketNumber}`;

    if (at) {
      const conflict = (before && before.at > at && before) || (after && after.at < at && after);
      if (conflict) {
        warnings.push(`NSR ${parsed.ticketNumber!.value} não combina com a data/hora lida: ${describe(conflict)}. O NSR sempre cresce com o tempo no mesmo relógio — confira data, horário e NSR.`);
        for (const f of ['date', 'time', 'ticketNumber'] as const) {
          const e = parsed[f] as Extracted<string> | undefined;
          if (e) (parsed as unknown as Record<string, Extracted<string>>)[f] = { ...e, confidence: Math.min(e.confidence, CONFIRMATION_THRESHOLD - 0.1), note: 'não combina com a sequência do NSR' };
        }
      }
    } else if (!parsed.date && (before || after)) {
      const range = before && after
        ? `entre ${brDate(before.r.recordDate!)} e ${brDate(after.r.recordDate!)}`
        : before ? `de ${brDate(before.r.recordDate!)} ou depois` : `de ${brDate(after!.r.recordDate!)} ou antes`;
      adjustments.push(`Pelo NSR, este ticket é ${range}.`);
    }
  }

  // ─── 3. Plausibilidade ────────────────────────────────────────────────────────
  const today = dayOf(now);
  if (parsed.date && parsed.date.value > today) {
    warnings.push(`A data lida (${brDate(parsed.date.value)}) está no futuro. Confira.`);
    parsed.date = { ...parsed.date, confidence: Math.min(parsed.date.confidence, CONFIRMATION_THRESHOLD - 0.1), note: 'data no futuro' };
  } else if (parsed.date?.value === today && parsed.time && minutesOf(parsed.time.value) > now.getHours() * 60 + now.getMinutes() + 10) {
    warnings.push(`O horário lido (${hhmm(parsed.time.value)}) é posterior ao momento da foto. Confira.`);
    parsed.time = { ...parsed.time, confidence: Math.min(parsed.time.confidence, CONFIRMATION_THRESHOLD - 0.1), note: 'horário no futuro' };
  }

  parsed.warnings = [...parsed.warnings, ...warnings];
  return { parsed, adjustments, warnings };
}

