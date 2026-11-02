export function cleanText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLabel(value: string | null | undefined): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/[():]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function splitSentences(text: string): string[] {
  return cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9₹])|\s*[•|]\s*/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

export function containsAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((needle) => lower.includes(needle.toLowerCase()));
}
