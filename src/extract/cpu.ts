import type {
  CpuSpec,
  PageSnapshot,
  SpecCandidate,
  SpecField,
  TdpRange,
} from "../types.js";
import type { ExtractionContext } from "./context.js";
import { SpecIndex } from "./specs.js";
import { extractCpuModel } from "../normalize/hardware.js";
import { cleanText } from "../normalize/text.js";
import {
  candidateFrom,
  chooseField,
  conflictingCandidates,
  unknownField,
} from "../normalize/sources.js";
import { parseWattage } from "../normalize/numbers.js";

export interface CpuPowerParse {
  baseTdpW: number | null;
  maxTurboPowerW: number | null;
  configurableTdpW: TdpRange | null;
  qualification: string;
  rawText: string;
}

function validCpuWatts(value: number | null): number | null {
  return value !== null && value >= 3 && value <= 250 ? value : null;
}

export function parseCpuPower(
  text: string | null | undefined,
  label: string | null = null,
): CpuPowerParse | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  const normalizedLabel = (label ?? "").toLowerCase();
  const qualifications: string[] = [];

  let baseTdpW: number | null = null;
  let maxTurboPowerW: number | null = null;
  let configurableTdpW: TdpRange | null = null;

  const range = cleaned.match(
    /(?:Configurable\s+TDP|cTDP|TDP\s+range|TDP|Processor\s+Power)[^\d]{0,25}(\d{1,3})\s*[-–]\s*(\d{1,3})\s*W/i,
  );
  if (range?.[1] && range[2]) {
    const min = validCpuWatts(Number(range[1]));
    const max = validCpuWatts(Number(range[2]));
    if (min !== null && max !== null && min <= max) {
      configurableTdpW = { min, max };
      qualifications.push("Explicit configurable TDP range.");
    }
  }
  const hasTdpRange = configurableTdpW !== null;

  const turbo = cleaned.match(
    /(?:Maximum\s+Turbo\s+Power|Max\.?\s+Turbo\s+Power|Turbo\s+Power|MTP)[^\d]{0,25}(\d{1,3}(?:\.\d+)?)\s*W/i,
  );
  if (turbo?.[1]) {
    maxTurboPowerW = validCpuWatts(Number(turbo[1]));
    qualifications.push("Explicitly labelled maximum turbo power.");
  }

  const hasConfigurableLabel =
    /configurable\s+tdp|ctdp/i.test(normalizedLabel) ||
    /configurable\s+tdp|ctdp/i.test(cleaned);

  if (!hasConfigurableLabel && !hasTdpRange) {
    const base = cleaned.match(
      /(?:Processor\s+Base\s+Power|Base\s+Power|Thermal\s+Design\s+Power|TDP)[^\d]{0,25}(\d{1,3}(?:\.\d+)?)\s*W/i,
    );
    if (base?.[1]) {
      baseTdpW = validCpuWatts(Number(base[1]));
      qualifications.push("Explicitly labelled TDP/processor base power.");
    }
  }

  if (maxTurboPowerW === null && /turbo|mtp/i.test(normalizedLabel)) {
    maxTurboPowerW = validCpuWatts(parseWattage(cleaned));
    if (maxTurboPowerW !== null) {
      qualifications.push("Maximum turbo power parsed from its labelled specification row.");
    }
  }
  if (
    baseTdpW === null &&
    configurableTdpW === null &&
    !hasConfigurableLabel &&
    !/\d\s*[-–]\s*\d/.test(cleaned) &&
    /(?:^|\b)(?:tdp|base\s+power|processor\s+power|thermal\s+design)/i.test(normalizedLabel)
  ) {
    baseTdpW = validCpuWatts(parseWattage(cleaned));
    if (baseTdpW !== null) {
      qualifications.push("TDP/base power parsed from its labelled specification row.");
    }
  }
  if (
    configurableTdpW === null &&
    /configurable|ctdp|(?:^|\b)tdp\b|processor\s+power/i.test(normalizedLabel)
  ) {
    const pair = cleaned.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})/);
    if (pair?.[1] && pair[2]) {
      const min = validCpuWatts(Number(pair[1]));
      const max = validCpuWatts(Number(pair[2]));
      if (min !== null && max !== null && min <= max) {
        configurableTdpW = { min, max };
        qualifications.push("Explicit configurable TDP range.");
      }
    }
  }

  if (baseTdpW === null && maxTurboPowerW === null && configurableTdpW === null) {
    if (/(?:tdp|power|watt)/i.test(`${normalizedLabel} ${cleaned}`)) {
      return {
        baseTdpW: null,
        maxTurboPowerW: null,
        configurableTdpW: null,
        qualification: "CPU power text found but no explicitly labelled wattage could be parsed.",
        rawText: cleaned,
      };
    }
    return null;
  }

  return {
    baseTdpW,
    maxTurboPowerW,
    configurableTdpW,
    qualification: Array.from(new Set(qualifications)).join(" "),
    rawText: cleaned,
  };
}

function addCpuPower(
  parsed: CpuPowerParse | null,
  source: ReturnType<ExtractionContext["source"]>,
  rawText: string,
  baseCandidates: SpecCandidate<number>[],
  turboCandidates: SpecCandidate<number>[],
  rangeCandidates: SpecCandidate<TdpRange>[],
  qualifications: string[],
): void {
  if (!parsed) return;
  if (parsed.baseTdpW !== null) {
    baseCandidates.push(
      candidateFrom({
        value: parsed.baseTdpW,
        unit: "W",
        source,
        rawText,
        qualification: parsed.qualification,
      }),
    );
  }
  if (parsed.maxTurboPowerW !== null) {
    turboCandidates.push(
      candidateFrom({
        value: parsed.maxTurboPowerW,
        unit: "W",
        source,
        rawText,
        qualification: parsed.qualification,
      }),
    );
  }
  if (parsed.configurableTdpW !== null) {
    rangeCandidates.push(
      candidateFrom({
        value: parsed.configurableTdpW,
        unit: "W",
        source,
        rawText,
        qualification: parsed.qualification,
      }),
    );
  }
  if (parsed.qualification) qualifications.push(parsed.qualification);
}

export function extractCpu(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
  title: string | null,
): CpuSpec {
  const index = new SpecIndex(snapshot);

  const modelCandidates: SpecCandidate<string>[] = [];
  for (const row of index.find([
    "processor",
    "processor model",
    "processor type",
    "cpu",
    "cpu model",
    "processor name",
    "processor series",
  ])) {
    const model = extractCpuModel(row.value);
    if (!model) continue;
    modelCandidates.push(
      candidateFrom({
        value: model,
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
      }),
    );
  }

  for (const text of snapshot.bulletTexts) {
    const model = extractCpuModel(text);
    if (!model) continue;
    modelCandidates.push(
      candidateFrom({
        value: model,
        source: ctx.source("amazon_listing_text", "#feature-bullets"),
        rawText: text,
      }),
    );
  }

  if (snapshot.descriptionText) {
    const model = extractCpuModel(snapshot.descriptionText);
    if (model) {
      modelCandidates.push(
        candidateFrom({
          value: model,
          source: ctx.source("amazon_listing_text", "#productDescription"),
          rawText: snapshot.descriptionText.slice(0, 500),
        }),
      );
    }
  }

  if (title) {
    const model = extractCpuModel(title);
    if (model) {
      modelCandidates.push(
        candidateFrom({
          value: model,
          source: ctx.source("amazon_title", "title"),
          qualification: "CPU model derived from the listing title; unverified.",
          rawText: title,
        }),
      );
    }
  }

  const conflicts = conflictingCandidates(modelCandidates);
  if (conflicts.length > 1) {
    ctx.warn(
      "cpu_model_conflict",
      "Conflicting CPU models were found; the highest-priority source was used.",
      conflicts
        .map((candidate) => `${String(candidate.value)} (${candidate.source?.type ?? "unknown"})`)
        .join("; "),
    );
  }

  const model = chooseField(modelCandidates);

  const baseCandidates: SpecCandidate<number>[] = [];
  const turboCandidates: SpecCandidate<number>[] = [];
  const rangeCandidates: SpecCandidate<TdpRange>[] = [];
  const powerQualifications: string[] = [];

  const powerRows = index.find([
    "tdp",
    "thermal design power",
    "processor base power",
    "base power",
    "processor power",
    "cpu power",
    "cpu tdp",
    "maximum turbo power",
    "max turbo power",
    "turbo power",
    "maximum turbo",
    "mtp",
    "configurable tdp",
    "ctdp",
    "configurable tdp range",
    "tdp range",
  ]);

  for (const row of powerRows) {
    addCpuPower(
      parseCpuPower(row.value, row.label),
      ctx.sourceForSection(row.section, row.sourceType),
      `${row.label}: ${row.value}`,
      baseCandidates,
      turboCandidates,
      rangeCandidates,
      powerQualifications,
    );
  }

  for (const text of snapshot.bulletTexts) {
    if (!/(?:tdp|base\s+power|turbo\s+power|configurable\s+tdp|ctdp|processor\s+power)/i.test(text)) {
      continue;
    }
    addCpuPower(
      parseCpuPower(text),
      ctx.source("amazon_listing_text", "#feature-bullets"),
      text,
      baseCandidates,
      turboCandidates,
      rangeCandidates,
      powerQualifications,
    );
  }

  if (snapshot.descriptionText) {
    const chunks = snapshot.descriptionText.match(
      /[^.!?]{0,180}(?:tdp|base\s+power|turbo\s+power|configurable\s+tdp|ctdp|processor\s+power)[^.!?]{0,180}/gi,
    );
    for (const chunk of chunks ?? []) {
      addCpuPower(
        parseCpuPower(chunk),
        ctx.source("amazon_listing_text", "#productDescription"),
        chunk,
        baseCandidates,
        turboCandidates,
        rangeCandidates,
        powerQualifications,
      );
    }
  }

  const baseTdpW: SpecField<number> = chooseField(baseCandidates);
  const maxTurboPowerW: SpecField<number> = chooseField(turboCandidates);
  const configurableTdpW: SpecField<TdpRange> = chooseField(rangeCandidates);

  if (
    model.value !== null &&
    baseTdpW.value === null &&
    maxTurboPowerW.value === null &&
    configurableTdpW.value === null
  ) {
    ctx.warn(
      "cpu_power_missing",
      "CPU model was found but its TDP/base power was not explicitly stated; left as unknown.",
    );
  }

  if (model.value === null) {
    ctx.warn("cpu_model_missing", "CPU model could not be extracted from the listing.");
    return {
      model: unknownField<string>("CPU model not found."),
      baseTdpW,
      maxTurboPowerW,
      configurableTdpW,
      powerQualification: powerQualifications.join(" ").trim() || null,
    };
  }

  return {
    model,
    baseTdpW,
    maxTurboPowerW,
    configurableTdpW,
    powerQualification:
      Array.from(new Set(powerQualifications)).join(" ").trim() || null,
  };
}
