import type {
  MemorySpec,
  PageSnapshot,
  SpecCandidate,
  SpecField,
  Upgradeability,
} from "../types.js";
import type { ExtractionContext } from "./context.js";
import { SpecIndex } from "./specs.js";
import {
  normalizeRamType,
  normalizeUpgradeability,
  parseRamCapacity,
  parseRamSpeed,
} from "../normalize/hardware.js";
import { cleanText } from "../normalize/text.js";
import {
  candidateFrom,
  chooseField,
  conflictingCandidates,
  unknownField,
} from "../normalize/sources.js";

function memoryTexts(snapshot: PageSnapshot): string[] {
  return [
    ...snapshot.bulletTexts,
    snapshot.descriptionText ?? "",
    snapshot.productTitle ?? "",
  ].filter(Boolean);
}

export function extractMemory(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
  title: string | null,
): MemorySpec {
  const index = new SpecIndex(snapshot);

  const capacityRows = index.find([
    "ram",
    "ram size",
    "memory",
    "memory size",
    "system memory",
    "installed ram",
    "installed memory",
    "ram memory",
    "memory installed",
    "memory ram",
    "ram capacity",
    "memory capacity",
  ]);
  const typeRows = index.find([
    "ram type",
    "memory technology",
    "memory type",
    "ram technology",
    "memory standard",
    "ram standard",
    "system memory",
    "ram",
    "memory",
  ]);
  const speedRows = index.find([
    "ram speed",
    "memory speed",
    "memory clock speed",
    "ram frequency",
    "memory frequency",
    "memory standard",
    "ram standard",
    "ram",
    "memory",
    "ram size",
    "memory size",
    "system memory",
  ]);

  const capacityCandidates: SpecCandidate<number>[] = [];
  for (const row of capacityRows) {
    if (/GDDR/i.test(row.value)) continue;
    const value = parseRamCapacity(`${row.label}: ${row.value}`);
    if (value === null) continue;
    capacityCandidates.push(
      candidateFrom({
        value,
        unit: "GB",
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
      }),
    );
  }

  for (const text of memoryTexts(snapshot)) {
    const value = parseRamCapacity(text);
    if (value === null) continue;
    capacityCandidates.push(
      candidateFrom({
        value,
        unit: "GB",
        source:
          text === snapshot.productTitle
            ? ctx.source("amazon_title", "title")
            : ctx.source("amazon_listing_text", "bullets/description"),
        qualification:
          text === snapshot.productTitle
            ? "Derived from the listing title; unverified."
            : null,
        rawText: text,
      }),
    );
  }

  const typeCandidates: SpecCandidate<string>[] = [];
  for (const row of typeRows) {
    const value = normalizeRamType(row.value);
    if (!value) continue;
    typeCandidates.push(
      candidateFrom({
        value,
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
      }),
    );
  }
  for (const text of memoryTexts(snapshot)) {
    if (!/(?:ram|memory|ddr|lpddr)/i.test(text)) continue;
    const value = normalizeRamType(text);
    if (!value) continue;
    typeCandidates.push(
      candidateFrom({
        value,
        source:
          text === snapshot.productTitle
            ? ctx.source("amazon_title", "title")
            : ctx.source("amazon_listing_text", "bullets/description"),
        qualification:
          text === snapshot.productTitle
            ? "Derived from the listing title; unverified."
            : null,
        rawText: text,
      }),
    );
  }

  const speedCandidates: SpecCandidate<number>[] = [];
  for (const row of speedRows) {
    const value = parseRamSpeed(`${row.label}: ${row.value}`);
    if (value === null) continue;
    speedCandidates.push(
      candidateFrom({
        value,
        unit: "MHz",
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
      }),
    );
  }
  for (const text of memoryTexts(snapshot)) {
    if (!/(?:ddr|lpddr|ram|memory)/i.test(text)) continue;
    const value = parseRamSpeed(text);
    if (value === null) continue;
    speedCandidates.push(
      candidateFrom({
        value,
        unit: "MHz",
        source:
          text === snapshot.productTitle
            ? ctx.source("amazon_title", "title")
            : ctx.source("amazon_listing_text", "bullets/description"),
        rawText: text,
      }),
    );
  }

  const upgradeCandidates: SpecCandidate<Upgradeability>[] = [];
  const upgradeNotes: string[] = [];
  for (const row of index.rows) {
    if (
      !/(?:ram|memory|upgrade|expand|soldered|onboard|so[- ]?dimm|slot)/i.test(
        `${row.label} ${row.value}`,
      )
    ) {
      continue;
    }
    const normalized = normalizeUpgradeability(`${row.label}: ${row.value}`);
    if (!normalized) continue;
    upgradeCandidates.push(
      candidateFrom({
        value: normalized.value,
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: normalized.rawText,
        qualification: normalized.note,
      }),
    );
    if (normalized.note) upgradeNotes.push(normalized.note);
  }
  for (const text of snapshot.bulletTexts) {
    if (!/(?:ram|memory|upgrade|expand|soldered|onboard|so[- ]?dimm|slot)/i.test(text)) {
      continue;
    }
    const normalized = normalizeUpgradeability(text);
    if (!normalized) continue;
    upgradeCandidates.push(
      candidateFrom({
        value: normalized.value,
        source: ctx.source("amazon_listing_text", "#feature-bullets"),
        rawText: normalized.rawText,
        qualification: normalized.note,
      }),
    );
    if (normalized.note) upgradeNotes.push(normalized.note);
  }
  if (snapshot.descriptionText) {
    const chunks = snapshot.descriptionText.match(
      /[^.!?]{0,180}(?:ram|memory|upgrade|expand|soldered|onboard|so[- ]?dimm|slot)[^.!?]{0,180}/gi,
    );
    for (const chunk of chunks ?? []) {
      const normalized = normalizeUpgradeability(chunk);
      if (!normalized) continue;
      upgradeCandidates.push(
        candidateFrom({
          value: normalized.value,
          source: ctx.source("amazon_listing_text", "#productDescription"),
          rawText: normalized.rawText,
          qualification: normalized.note,
        }),
      );
      if (normalized.note) upgradeNotes.push(normalized.note);
    }
  }

  const capacityConflicts = conflictingCandidates(capacityCandidates);
  if (capacityConflicts.length > 1) {
    ctx.warn(
      "ram_capacity_conflict",
      "Conflicting installed RAM capacities were found; the highest-priority source was used.",
      capacityConflicts
        .map((candidate) => `${String(candidate.value)} GB (${candidate.source?.type ?? "unknown"})`)
        .join("; "),
    );
  }

  const installedGb: SpecField<number> = chooseField(capacityCandidates);
  const type: SpecField<string> = chooseField(typeCandidates);
  const speedMhz: SpecField<number> = chooseField(speedCandidates);

  let upgradeability: SpecField<Upgradeability>;
  if (upgradeCandidates.length > 0) {
    const noCandidate = upgradeCandidates.find((candidate) => candidate.value === "no");
    const selected = noCandidate ?? upgradeCandidates[0];
    upgradeability = selected
      ? {
          value: selected.value,
          unit: null,
          source: selected.source,
          verification: selected.verification,
          qualification: selected.qualification,
          rawText: selected.rawText,
          candidates: upgradeCandidates,
        }
      : unknownField<Upgradeability>("Memory upgradeability not stated.");
  } else {
    upgradeability = unknownField<Upgradeability>(
      "Memory upgradeability was not explicitly stated; not inferred from form factor.",
    );
  }

  if (installedGb.value === null) {
    ctx.warn("ram_capacity_missing", "Installed RAM capacity was not explicitly found.");
  }
  if (type.value === null) {
    ctx.warn("ram_type_missing", "RAM generation/type was not explicitly found.");
  }
  if (upgradeability.value === null) {
    ctx.warn(
      "ram_upgradeability_missing",
      "RAM upgradeability was not explicitly stated; left as unknown.",
    );
  }

  return {
    installedGb,
    type,
    speedMhz,
    upgradeability,
    upgradeNotes: Array.from(new Set(upgradeNotes)).join(" ").trim() || null,
  };
}
