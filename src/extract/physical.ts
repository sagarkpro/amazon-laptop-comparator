import type { PageSnapshot, SpecCandidate, SpecField } from "../types.js";
import type { ExtractionContext } from "./context.js";
import { SpecIndex } from "./specs.js";
import { cleanText } from "../normalize/text.js";
import {
  candidateFrom,
  chooseField,
  unknownField,
} from "../normalize/sources.js";

function parseStorage(
  text: string,
  label: string,
  typeHint: string | null,
): { value: string; rawText: string } | null {
  const context = `${label} ${text}`;
  if (
    /\b(?:ram|memory|ddr|lpddr)\b/i.test(context) &&
    !/(?:storage|ssd|hdd|nvme|emmc|hard\s+disk|hard\s+drive)/i.test(context)
  ) {
    return null;
  }
  if (!/(?:storage|ssd|hdd|nvme|emmc|hard\s+disk|hard\s+drive)/i.test(context)) {
    return null;
  }

  const cleaned = cleanText(text);
  const adjacent =
    cleaned.match(/(\d{1,3}(?:\.\d+)?)\s*(TB|GB)\s*(SSD|HDD|NVMe|eMMC)\b/i) ??
    cleaned.match(/\b(SSD|HDD|NVMe|eMMC)\s*(\d{1,3}(?:\.\d+)?)\s*(TB|GB)\b/i);

  let sizeValue: string | null = null;
  let unit: string | null = null;
  let type: string | null = null;

  if (adjacent?.[1] && adjacent[2] && adjacent[3]) {
    if (/^\d/.test(adjacent[1])) {
      sizeValue = adjacent[1];
      unit = adjacent[2];
      type = adjacent[3].toUpperCase();
    } else {
      type = adjacent[1].toUpperCase();
      sizeValue = adjacent[2];
      unit = adjacent[3];
    }
  } else {
    const labelIsStorageSpecific =
      /(?:storage|hard\s+disk|hard\s+drive|ssd|nvme|emmc)/i.test(label);
    if (!labelIsStorageSpecific) return null;
    const size = cleaned.match(/(\d{1,3}(?:\.\d+)?)\s*(TB|GB)\b/i);
    if (!size?.[1] || !size[2]) return null;
    sizeValue = size[1];
    unit = size[2];
    type = typeHint;
  }

  return {
    value: `${sizeValue}${unit?.toUpperCase() ?? ""}${type ? ` ${type}` : ""}`,
    rawText: `${label}: ${text}`,
  };
}

export function extractStorage(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
  title: string | null,
): SpecField<string> {
  const index = new SpecIndex(snapshot);
  const typeHint =
    index
      .find([
        "hard disk description",
        "storage type",
        "hard disk technology",
        "hard drive interface",
      ])
      .map((row) => row.value.match(/\b(SSD|HDD|NVMe|eMMC)\b/i)?.[1]?.toUpperCase())
      .find(Boolean) ?? null;

  const candidates: SpecCandidate<string>[] = [];
  for (const row of index.find([
    "storage capacity",
    "storage",
    "hard disk size",
    "hard disk capacity",
    "hard drive size",
    "ssd capacity",
    "total storage capacity",
    "memory storage capacity",
    "flash memory size",
    "hard disk",
  ])) {
    const parsed = parseStorage(row.value, row.label, typeHint);
    if (!parsed) continue;
    candidates.push(
      candidateFrom({
        value: parsed.value,
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: parsed.rawText,
      }),
    );
  }

  for (const text of [...snapshot.bulletTexts, snapshot.descriptionText ?? ""]) {
    if (!text) continue;
    const parsed = parseStorage(text, "", typeHint);
    if (!parsed) continue;
    candidates.push(
      candidateFrom({
        value: parsed.value,
        source: ctx.source("amazon_listing_text", "bullets/description"),
        rawText: parsed.rawText,
      }),
    );
  }

  if (title) {
    const parsed = parseStorage(title, "", typeHint);
    if (parsed) {
      candidates.push(
        candidateFrom({
          value: parsed.value,
          source: ctx.source("amazon_title", "title"),
          qualification: "Derived from the listing title; unverified.",
          rawText: title,
        }),
      );
    }
  }

  return chooseField(candidates) ?? unknownField<string>("Storage capacity not found.");
}

function displaySize(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:inch|inches|"|”)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function displayRefresh(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d{2,3})\s*Hz\b/i);
  return match?.[1] ? Number(match[1]) : null;
}

function displayResolution(text: string | null): string | null {
  if (!text) return null;
  const keyword = text.match(/\b(WUXGA|WQXGA|QHD|UHD|FHD|Full\s+HD|HD\+?)\b/i);
  if (keyword?.[1]) {
    return keyword[1].toUpperCase().replace(/\s+/g, "");
  }
  const numeric = text.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  return numeric?.[1] && numeric[2] ? `${numeric[1]}x${numeric[2]}` : null;
}

function displayPanel(text: string | null): string | null {
  if (!text) return null;
  return text.match(/\b(IPS|OLED|VA|TN)\b/i)?.[1]?.toUpperCase() ?? null;
}

export function extractDisplay(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
  title: string | null,
): SpecField<string> {
  const index = new SpecIndex(snapshot);

  const sizeRow =
    index.first(["screen size", "display size", "standing screen display size", "screen diameter"]) ??
    null;
  const refreshRow =
    index.first(["refresh rate", "display refresh rate", "screen refresh rate"]) ?? null;
  const resolutionRow =
    index.first([
      "resolution",
      "maximum display resolution",
      "display resolution",
      "screen resolution",
    ]) ?? null;
  const panelRow =
    index.first(["display technology", "panel type", "display type"]) ?? null;

  const sizeFromRow = displaySize(sizeRow?.value ?? null);
  const refreshFromRow = displayRefresh(refreshRow?.value ?? null);
  const resolutionFromRow = displayResolution(resolutionRow?.value ?? null);
  const panelFromRow = displayPanel(panelRow?.value ?? null);
  const size = sizeFromRow ?? displaySize(title);
  const refresh = refreshFromRow ?? displayRefresh(title);
  const resolution = resolutionFromRow ?? displayResolution(title);
  const panel = panelFromRow ?? displayPanel(title);
  const sizeFromTitle = size !== null && sizeFromRow === null;
  const refreshFromTitle = refresh !== null && refreshFromRow === null;
  const resolutionFromTitle = resolution !== null && resolutionFromRow === null;
  const panelFromTitle = panel !== null && panelFromRow === null;

  const parts: string[] = [];
  if (size !== null) parts.push(`${size}"`);
  if (resolution) parts.push(resolution);
  if (refresh !== null) parts.push(`${refresh}Hz`);
  if (panel) parts.push(panel);

  if (parts.length === 0) {
    return unknownField<string>("Display information not found.");
  }

  const primaryRow = sizeRow ?? refreshRow ?? resolutionRow ?? panelRow;
  const source = primaryRow
    ? ctx.sourceForSection(primaryRow.section, primaryRow.sourceType)
    : ctx.source("amazon_title", "title");
  const derivedFromTitle =
    !primaryRow ||
    sizeFromTitle ||
    refreshFromTitle ||
    resolutionFromTitle ||
    panelFromTitle;

  return {
    value: parts.join(" "),
    unit: null,
    source,
    verification: "unverified",
    qualification: derivedFromTitle
      ? "Display string may combine structured fields with title-derived details; verify the exact panel specification."
      : null,
    rawText: primaryRow ? `${primaryRow.label}: ${primaryRow.value}` : title,
    candidates: [
      candidateFrom({
        value: parts.join(" "),
        source,
        qualification: derivedFromTitle
          ? "Display string may combine structured fields with title-derived details."
          : null,
        rawText: primaryRow ? `${primaryRow.label}: ${primaryRow.value}` : title,
      }),
    ],
  };
}

function parseWeightValue(text: string): string | null {
  const match = cleanText(text).match(/(\d{1,3}(?:\.\d{1,2})?)\s*(kg|kilograms?|g|grams?|lb|lbs)\b/i);
  if (!match?.[1] || !match[2]) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount)) return null;
  if (unit.startsWith("kg") || unit.startsWith("kilo")) return `${amount} kg`;
  if (unit === "g" || unit.startsWith("gram")) return `${(amount / 1000).toFixed(2)} kg`;
  return `${(amount * 0.453592).toFixed(2)} kg`;
}

export function extractWeight(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
  title: string | null,
): SpecField<string> {
  const index = new SpecIndex(snapshot);
  const candidates: SpecCandidate<string>[] = [];

  for (const row of index.find(["item weight", "weight", "product weight"])) {
    const value = parseWeightValue(row.value);
    if (!value) continue;
    candidates.push(
      candidateFrom({
        value,
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
      }),
    );
  }
  if (title) {
    const value = parseWeightValue(title);
    if (value) {
      candidates.push(
        candidateFrom({
          value,
          source: ctx.source("amazon_title", "title"),
          qualification: "Derived from the listing title; unverified.",
          rawText: title,
        }),
      );
    }
  }
  return chooseField(candidates) ?? unknownField<string>("Weight not found.");
}
