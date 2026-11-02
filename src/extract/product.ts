import type {
  AvailabilityInfo,
  PageSnapshot,
  SourceRef,
  SpecCandidate,
  SpecField,
} from "../types.js";
import type { ExtractionContext } from "./context.js";
import { SpecIndex } from "./specs.js";
import {
  canonicalBrand,
  normalizeAvailability,
  normalizeSchemaAvailability,
} from "../normalize/hardware.js";
import { cleanText } from "../normalize/text.js";
import {
  candidateFrom,
  chooseField,
  conflictingCandidates,
} from "../normalize/sources.js";
import {
  canonicalProductUrl,
  extractAsinFromUrl,
  isValidAsin,
} from "../input/url.js";

export interface JsonLdProduct {
  name?: unknown;
  brand?: unknown;
  sku?: unknown;
  mpn?: unknown;
  offers?: unknown;
  image?: unknown;
}

export interface IdentityResult {
  title: string | null;
  imageUrl: string | null;
  titleSource: SourceRef | null;
  asin: string | null;
  canonicalUrl: string | null;
  brand: SpecField<string>;
  model: SpecField<string>;
  availability: AvailabilityInfo;
}

function flattenJsonLd(value: unknown, output: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  output.push(record);
  if (record["@graph"]) flattenJsonLd(record["@graph"], output);
}

export function parseJsonLd(snapshot: PageSnapshot): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const text of snapshot.jsonLdTexts) {
    try {
      flattenJsonLd(JSON.parse(text), nodes);
    } catch {
      // Invalid JSON-LD is common; structured DOM parsing remains available.
    }
  }
  return nodes;
}

export function findJsonLdProduct(snapshot: PageSnapshot): JsonLdProduct | null {
  const product = parseJsonLd(snapshot).find((node) => {
    const type = node["@type"];
    if (typeof type === "string") return type.toLowerCase() === "product";
    if (Array.isArray(type)) {
      return type.some(
        (item) => typeof item === "string" && item.toLowerCase() === "product",
      );
    }
    return false;
  });
  return (product as JsonLdProduct | undefined) ?? null;
}

function brandName(value: unknown): string | null {
  if (typeof value === "string") return cleanText(value) || null;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return cleanText(record.name) || null;
  }
  return null;
}

function offerRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object",
    );
  }
  if (value && typeof value === "object") {
    return [value as Record<string, unknown>];
  }
  return [];
}

function jsonLdOffer(snapshot: PageSnapshot): Record<string, unknown> | null {
  const product = findJsonLdProduct(snapshot);
  return offerRecords(product?.offers)[0] ?? null;
}

function titleFallback(documentTitle: string | null): string | null {
  if (!documentTitle) return null;
  const withoutAmazon = documentTitle
    .replace(/\s*[:|-]\s*Amazon\.in.*$/i, "")
    .replace(/\s*[:|-]\s*Amazon.*$/i, "")
    .trim();
  return withoutAmazon || null;
}

function specCandidates(
  index: SpecIndex,
  labels: string[],
  ctx: ExtractionContext,
  qualification: string | null = null,
): SpecCandidate<string>[] {
  return index.find(labels).map((row) =>
    candidateFrom({
      value: row.value,
      source: ctx.sourceForSection(row.section, row.sourceType),
      qualification,
      rawText: `${row.label}: ${row.value}`,
    }),
  );
}

function addConflictWarning(
  ctx: ExtractionContext,
  fieldName: string,
  candidates: SpecCandidate<string>[],
): void {
  const conflicts = conflictingCandidates(candidates);
  if (conflicts.length > 1) {
    if (fieldName === "model") {
      ctx.warn(
        "model_identifiers",
        "Multiple model identifiers were found; the most specific labelled value was selected.",
        conflicts
          .map(
            (candidate) =>
              `${String(candidate.value)} (${candidate.source?.type ?? "unknown"})`,
          )
          .join("; "),
      );
      return;
    }
    ctx.warn(
      `${fieldName}_conflict`,
      `Conflicting ${fieldName} values were found; the highest-priority source was used.`,
      conflicts
        .map(
          (candidate) =>
            `${String(candidate.value)} (${candidate.source?.type ?? "unknown"})`,
        )
        .join("; "),
    );
  }
}

function deriveModelFromTitle(title: string | null): string | null {
  if (!title) return null;
  const series =
    /\b(LOQ(?:\s+Essential)?|Legion|IdeaPad|ThinkPad|Victus|Omen|Pavilion|Nitro|Predator|Aspire|TUF(?:\s+Gaming)?|ROG(?:\s+Strix)?|Katana|Cyborg|Raider|Stealth|Alienware|MacBook(?:\s+(?:Air|Pro))?|Inspiron|XPS|VivoBook|Zenbook|Gram|Galaxy\s+Book|Surface\s+Laptop)\b/i.exec(
      title,
    )?.[0];
  const codeMatches = Array.from(
    title.matchAll(/\b(?:[A-Z]{1,4}\d{2,}[A-Z0-9-]*|\d{2}[A-Z]{2,}\d{2,}[A-Z0-9-]*)\b/gi),
  )
    .map((match) => match[0])
    .filter(
      (value) =>
        !/^(?:RTX|GTX|RX|DDR|LPDDR|USB|HDMI|FHD|QHD|UHD|SSD|HDD|GB|TB|WIFI|BT)/i.test(
          value,
        ) &&
        !/^\d+(?:GB|TB)$/i.test(value) &&
        !/^i[3579]-/i.test(value),
    );
  const code = codeMatches[0] ?? null;
  if (!series && !code) return null;
  return cleanText([series, code].filter(Boolean).join(" ")) || null;
}

function extractAsin(
  snapshot: PageSnapshot,
  canonicalUrl: string | null,
  jsonLd: JsonLdProduct | null,
): string | null {
  const fromCanonical = canonicalUrl ? extractAsinFromUrl(canonicalUrl) : null;
  if (fromCanonical) return fromCanonical;
  const fromFinal = extractAsinFromUrl(snapshot.finalUrl);
  if (fromFinal) return fromFinal;
  for (const value of snapshot.asinInputs) {
    if (isValidAsin(value)) return value.toUpperCase();
  }
  const sku = typeof jsonLd?.sku === "string" ? jsonLd.sku.toUpperCase() : null;
  if (sku && isValidAsin(sku)) return sku;
  return null;
}

function extractAvailability(
  snapshot: PageSnapshot,
  jsonLd: JsonLdProduct | null,
  ctx: ExtractionContext,
): AvailabilityInfo {
  const raw = snapshot.availabilityText;
  if (raw) {
    const value = normalizeAvailability(raw);
    return {
      value,
      rawText: raw,
      source: ctx.source("amazon_listing_text", "#availability"),
      verification: value === "unknown" ? "unknown" : "unverified",
    };
  }

  const offer = jsonLdOffer(snapshot);
  const availability = offer?.availability;
  if (typeof availability === "string") {
    const value = normalizeSchemaAvailability(availability);
    return {
      value,
      rawText: availability,
      source: ctx.source("amazon_structured_data", "JSON-LD offers.availability"),
      verification: value === "unknown" ? "unknown" : "unverified",
    };
  }

  if (snapshot.signals.unavailable) {
    return {
      value: "out_of_stock",
      rawText: "Unavailable signal found on the page.",
      source: ctx.source("amazon_listing_text", "#outOfStock"),
      verification: "unverified",
    };
  }

  ctx.warn("availability_missing", "Availability was not found on the product page.");
  return {
    value: "unknown",
    rawText: null,
    source: null,
    verification: "unknown",
  };
}

export function extractIdentity(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
): IdentityResult {
  const index = new SpecIndex(snapshot);
  const jsonLd = findJsonLdProduct(snapshot);

  const jsonLdName =
    typeof jsonLd?.name === "string" ? cleanText(jsonLd.name) : null;
  const domTitle = cleanText(snapshot.productTitle);
  const fallbackTitle = titleFallback(snapshot.documentTitle);

  let title: string | null = null;
  let titleSource: SourceRef | null = null;
  if (domTitle) {
    title = domTitle;
    titleSource = ctx.source("amazon_listing_text", "#productTitle");
  } else if (jsonLdName) {
    title = jsonLdName;
    titleSource = ctx.source("amazon_structured_data", "JSON-LD Product.name");
  } else if (fallbackTitle) {
    title = fallbackTitle;
    titleSource = ctx.source("amazon_title", "document.title");
    ctx.warn(
      "title_from_document",
      "Product title was derived from document.title because #productTitle was missing.",
    );
  }

  const canonicalUrl =
    canonicalProductUrl(snapshot.canonicalUrl ?? "") ??
    canonicalProductUrl(snapshot.finalUrl);
  const asin = extractAsin(snapshot, canonicalUrl, jsonLd);

  const brandCandidates: SpecCandidate<string>[] = [];

  for (const row of index.find(["brand", "brand name", "manufacturer"])) {
    const normalized = canonicalBrand(row.value);
    if (!normalized) continue;
    brandCandidates.push(
      candidateFrom({
        value: normalized,
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
      }),
    );
  }

  const structuredBrand = brandName(jsonLd?.brand);
  if (structuredBrand) {
    brandCandidates.push(
      candidateFrom({
        value: canonicalBrand(structuredBrand) ?? structuredBrand,
        source: ctx.source("amazon_structured_data", "JSON-LD Product.brand"),
        rawText: structuredBrand,
      }),
    );
  }

  const bylineBrand = canonicalBrand(snapshot.byline);
  if (bylineBrand) {
    brandCandidates.push(
      candidateFrom({
        value: bylineBrand,
        source: ctx.source("amazon_listing_text", "#bylineInfo"),
        rawText: snapshot.byline,
      }),
    );
  }

  if (brandCandidates.length === 0 && title) {
    const titleBrand = canonicalBrand(title);
    if (titleBrand) {
      brandCandidates.push(
        candidateFrom({
          value: titleBrand,
          source: ctx.source("amazon_title", "title"),
          qualification: "Derived from the listing title; unverified.",
          rawText: title,
        }),
      );
    }
  }

  addConflictWarning(ctx, "brand", brandCandidates);
  const brand = chooseField(brandCandidates);

  const modelCandidates: SpecCandidate<string>[] = [];
  const modelLabels = [
    "manufacturer part number",
    "item model number",
    "model number",
    "part number",
    "product model",
    "model name",
    "laptop model",
    "series",
    "sku",
  ];
  for (const label of modelLabels) {
    for (const row of index.find([label])) {
      const value = cleanText(row.value);
      if (!value || value.length < 2) continue;
      if (asin && value.toUpperCase() === asin) continue;
      modelCandidates.push(
        candidateFrom({
          value,
          source: ctx.sourceForSection(row.section, row.sourceType),
          rawText: `${row.label}: ${row.value}`,
        }),
      );
    }
  }

  if (typeof jsonLd?.mpn === "string" && cleanText(jsonLd.mpn)) {
    modelCandidates.push(
      candidateFrom({
        value: cleanText(jsonLd.mpn),
        source: ctx.source("amazon_structured_data", "JSON-LD Product.mpn"),
        rawText: jsonLd.mpn,
      }),
    );
  }
  if (typeof jsonLd?.sku === "string" && cleanText(jsonLd.sku) && jsonLd.sku.toUpperCase() !== asin) {
    modelCandidates.push(
      candidateFrom({
        value: cleanText(jsonLd.sku),
        source: ctx.source("amazon_structured_data", "JSON-LD Product.sku"),
        rawText: jsonLd.sku,
      }),
    );
  }

  if (modelCandidates.length === 0 && title) {
    const derived = deriveModelFromTitle(title);
    if (derived) {
      modelCandidates.push(
        candidateFrom({
          value: derived,
          source: ctx.source("amazon_title", "title"),
          qualification:
            "Derived from the listing title; exact model/SKU not found in structured specifications.",
          rawText: title,
        }),
      );
      ctx.warn(
        "model_derived_from_title",
        "Laptop model/SKU was derived from the title and is unverified.",
      );
    }
  }

  addConflictWarning(ctx, "model", modelCandidates);
  const model = chooseField(modelCandidates);
  const availability = extractAvailability(snapshot, jsonLd, ctx);

  const jsonLdImage = (() => {
    const image = jsonLd?.image;
    if (typeof image === "string") return image;
    if (Array.isArray(image)) {
      const first = image.find((value) => typeof value === "string");
      return typeof first === "string" ? first : null;
    }
    if (image && typeof image === "object") {
      const record = image as Record<string, unknown>;
      if (typeof record.url === "string") return record.url;
    }
    return null;
  })();

  return {
    title,
    imageUrl: snapshot.heroImageUrl ?? jsonLdImage,
    titleSource,
    asin,
    canonicalUrl,
    brand,
    model,
    availability,
  };
}
