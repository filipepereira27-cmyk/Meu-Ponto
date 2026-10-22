/** Normalização de texto para comparação e busca. */

/** "Saída Almoço" → "SAIDA ALMOCO" */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
}

export function collapseSpaces(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

/** "Nº  Fabricação." → "N FABRICACAO" (mantém `/`). */
export function normalizeLabel(text: string): string {
  return collapseSpaces(fold(text).replace(/[^A-Z0-9/]/g, ' '));
}

export function digitsOnly(text: string): string {
  return text.replace(/\D/g, '');
}

export function searchTokens(text: string): string[] {
  return fold(text).split(/[\s,;]+/).filter(Boolean);
}

export const isLetter = (c: string) => /\p{L}/u.test(c);
export const isDigit = (c: string) => c >= '0' && c <= '9';
