import type { PageSnapshot, SpecRow } from "../types.js";
import { normalizeLabel } from "../normalize/text.js";

export class SpecIndex {
  readonly rows: SpecRow[];

  constructor(snapshot: PageSnapshot) {
    this.rows = snapshot.specRows;
  }

  find(labels: string[]): SpecRow[] {
    const wanted = new Set(labels.map((label) => normalizeLabel(label)));
    return this.rows.filter((row) => wanted.has(normalizeLabel(row.label)));
  }

  findContaining(needles: string[]): SpecRow[] {
    const wanted = needles.map((needle) => normalizeLabel(needle));
    return this.rows.filter((row) => {
      const label = normalizeLabel(row.label);
      return wanted.some((needle) => label.includes(needle));
    });
  }

  first(labels: string[]): SpecRow | null {
    return this.find(labels)[0] ?? null;
  }

  firstContaining(needles: string[]): SpecRow | null {
    return this.findContaining(needles)[0] ?? null;
  }

  values(labels: string[]): string[] {
    return this.find(labels).map((row) => row.value);
  }
}

export function combinedProductText(snapshot: PageSnapshot, title: string | null): string {
  return [
    title,
    ...snapshot.bulletTexts,
    snapshot.descriptionText,
    ...snapshot.specRows.map((row) => `${row.label}: ${row.value}`),
  ]
    .filter(Boolean)
    .join("\n");
}
