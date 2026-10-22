import { digitsOnly } from './text';

/** Remove pontuação, mantendo letras maiúsculas e dígitos. */
export function compactCNPJ(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * CNPJ numérico ou alfanumérico (formato vigente desde julho/2026: 12 caracteres
 * alfanuméricos + 2 dígitos verificadores). Valor de cada caractere = código ASCII − 48.
 */
export function isValidCNPJ(text: string): boolean {
  const c = compactCNPJ(text);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(c)) return false;
  if (new Set(c).size === 1) return false;
  const values = [...c].map((ch) => ch.charCodeAt(0) - 48);
  const check = (prefix: number[]) => {
    let weight = 2, sum = 0;
    for (let i = prefix.length - 1; i >= 0; i--) {
      sum += prefix[i] * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = check(values.slice(0, 12));
  const d2 = check([...values.slice(0, 12), d1]);
  return values[12] === d1 && values[13] === d2;
}

/** `12.ABC.345/01DE-35` */
export function formatCNPJ(text: string): string {
  const c = compactCNPJ(text);
  if (c.length !== 14) return text;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function isValidCPF(text: string): boolean {
  const d = [...digitsOnly(text)].map(Number);
  if (d.length !== 11 || new Set(d).size === 1) return false;
  const check = (n: number) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] * (n + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return d[9] === check(9) && d[10] === check(10);
}

/** PIS/PASEP/NIT */
export function isValidPIS(text: string): boolean {
  const d = [...digitsOnly(text)].map(Number);
  if (d.length !== 11 || new Set(d).size === 1) return false;
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * d[i], 0);
  const rest = 11 - (sum % 11);
  return d[10] === (rest >= 10 ? 0 : rest);
}
