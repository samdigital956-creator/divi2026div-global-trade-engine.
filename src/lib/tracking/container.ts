/** ISO 6346 container numbers: owner code (3 letters), category (U/J/Z), 6-digit serial, check digit. */
const LETTER_VALUES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").reduce<Record<string, number>>((acc, ch, i) => {
  let v = 10 + i;
  v += Math.floor((v - 1) / 10); // values skip multiples of 11: A=10, B=12 … K=21, L=23 …
  acc[ch] = v;
  return acc;
}, {});

export function containerCheckDigit(first10: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = first10[i];
    sum += (/\d/.test(c) ? Number(c) : LETTER_VALUES[c]) * 2 ** i;
  }
  return (sum % 11) % 10;
}

/** null when valid; otherwise a message for the user (with the corrected number if only the check digit is off). */
export function containerNumberProblem(n: string): string | null {
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(n)) return "Container numbers are 4 letters ending in U, J or Z, then 7 digits, e.g. MSCU1234565.";
  const expected = containerCheckDigit(n.slice(0, 10));
  return Number(n[10]) === expected ? null : `The check digit does not match. Did you mean ${n.slice(0, 10)}${expected}?`;
}
