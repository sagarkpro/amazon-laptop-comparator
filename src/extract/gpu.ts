import type { GpuSpec, PageSnapshot, SpecCandidate, SpecField } from "../types.js";
import type { ExtractionContext } from "./context.js";
import { SpecIndex } from "./specs.js";
import {
  extractGpuModel,
  parseVramFromGpuText,
  type GpuModelMatch,
} from "../normalize/hardware.js";
import { cleanText } from "../normalize/text.js";
import {
  candidateFrom,
  chooseField,
  conflictingCandidates,
  notApplicableField,
  unknownField,
} from "../normalize/sources.js";
import { parseWattage } from "../normalize/numbers.js";

export interface GpuPowerParse {
  baseTgpW: number | null;
  maxGraphicsPowerW: number | null;
  dynamicBoostW: number | null;
  qualification: string;
  rawText: string;
}

function validWattage(value: number | null, min = 10, max = 300): number | null {
  return value !== null && value >= min && value <= max ? value : null;
}

export function parseGpuPower(
  text: string | null | undefined,
  label: string | null = null,
): GpuPowerParse | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  const lower = cleaned.toLowerCase();
  const normalizedLabel = (label ?? "").toLowerCase();
  const qualifications: string[] = [];

  let baseTgpW: number | null = null;
  let maxGraphicsPowerW: number | null = null;
  let dynamicBoostW: number | null = null;

  const explicitSum = cleaned.match(
    /(\d{2,3})\s*W\s*\+\s*(\d{1,2})\s*W\s*(?:Dynamic Boost|dynamic boost)/i,
  );
  if (explicitSum?.[1] && explicitSum[2]) {
    baseTgpW = validWattage(Number(explicitSum[1]));
    dynamicBoostW = validWattage(Number(explicitSum[2]), 1, 100);
    if (baseTgpW !== null && dynamicBoostW !== null) {
      maxGraphicsPowerW = validWattage(baseTgpW + dynamicBoostW);
      qualifications.push(
        "Explicit base TGP plus Dynamic Boost; maximum graphics power is the stated sum. Verify the vendor's interpretation.",
      );
    }
  }

  const includingBoost = cleaned.match(
    /(\d{2,3})\s*W[^.]{0,50}(?:including|with)\s+(?:Dynamic Boost|dynamic boost)/i,
  );
  if (includingBoost?.[1]) {
    maxGraphicsPowerW =
      validWattage(Number(includingBoost[1])) ?? maxGraphicsPowerW;
    qualifications.push(
      "Wattage explicitly includes Dynamic Boost; base TGP is not stated.",
    );
  }

  const tgpBefore = cleaned.match(
    /(?:TGP|Total\s+Graphics\s+Power)[^\d]{0,25}(\d{2,3})\s*W/i,
  );
  if (tgpBefore?.[1]) {
    baseTgpW = validWattage(Number(tgpBefore[1])) ?? baseTgpW;
    qualifications.push("Explicitly labelled TGP.");
  }
  const tgpAfter = cleaned.match(
    /(\d{2,3})\s*W\s*(?:TGP|Total\s+Graphics\s+Power)/i,
  );
  if (tgpAfter?.[1]) {
    baseTgpW = validWattage(Number(tgpAfter[1])) ?? baseTgpW;
    qualifications.push("Explicitly labelled TGP.");
  }

  const maxBefore = cleaned.match(
    /(?:Maximum\s+Graphics\s+Power|Max\.?\s+Graphics\s+Power)[^\d]{0,25}(\d{2,3})\s*W/i,
  );
  if (maxBefore?.[1]) {
    maxGraphicsPowerW =
      validWattage(Number(maxBefore[1])) ?? maxGraphicsPowerW;
    qualifications.push("Explicitly labelled maximum graphics power.");
  }
  const maxAfter = cleaned.match(
    /(\d{2,3})\s*W\s*(?:Maximum\s+Graphics\s+Power|Max\.?\s+Graphics\s+Power)/i,
  );
  if (maxAfter?.[1]) {
    maxGraphicsPowerW =
      validWattage(Number(maxAfter[1])) ?? maxGraphicsPowerW;
    qualifications.push("Explicitly labelled maximum graphics power.");
  }

  const boostBefore = cleaned.match(
    /(?:Dynamic\s+Boost)[^\d]{0,25}(\d{1,2})\s*W/i,
  );
  if (boostBefore?.[1]) {
    dynamicBoostW = validWattage(Number(boostBefore[1]), 1, 100) ?? dynamicBoostW;
    qualifications.push("Explicit Dynamic Boost wattage.");
  }
  const boostAfter = cleaned.match(
    /(\d{1,2})\s*W\s*(?:Dynamic\s+Boost)/i,
  );
  if (boostAfter?.[1]) {
    dynamicBoostW = validWattage(Number(boostAfter[1]), 1, 100) ?? dynamicBoostW;
    qualifications.push("Explicit Dynamic Boost wattage.");
  }

  const upTo = cleaned.match(
    /(?:up\s+to|upto|max(?:imum)?)[^\d]{0,15}(\d{2,3})\s*W/i,
  );
  if (upTo?.[1] && /(?:gpu|graphics|tgp)/i.test(cleaned)) {
    maxGraphicsPowerW =
      validWattage(Number(upTo[1])) ?? maxGraphicsPowerW;
    qualifications.push(
      "Listing says 'up to' this wattage; it is treated as maximum graphics power, not base TGP.",
    );
  }

  if (
    maxGraphicsPowerW === null &&
    /(?:maximum\s+graphics|max\.?\s+graphics|graphics\s+power|gpu\s+power)/i.test(
      normalizedLabel,
    )
  ) {
    const value = parseWattage(cleaned);
    maxGraphicsPowerW = validWattage(value);
    if (maxGraphicsPowerW !== null) {
      qualifications.push(
        /maximum|max\.?\s+graphics/i.test(normalizedLabel)
          ? "Explicitly labelled maximum graphics power."
          : "Ambiguous label 'graphics power' recorded as maximum graphics power, not base TGP.",
      );
    }
  }

  if (baseTgpW === null && /(?:^|\b)tgp\b|total\s+graphics\s+power/i.test(normalizedLabel)) {
    baseTgpW = validWattage(parseWattage(cleaned));
  }
  if (dynamicBoostW === null && /dynamic\s+boost/i.test(normalizedLabel)) {
    dynamicBoostW = validWattage(parseWattage(cleaned), 1, 100);
  }

  if (baseTgpW === null && maxGraphicsPowerW === null && dynamicBoostW === null) {
    if (/(?:gpu|graphics|tgp|watt|power)/i.test(lower)) {
      return {
        baseTgpW: null,
        maxGraphicsPowerW: null,
        dynamicBoostW: null,
        qualification: "GPU power text found but no explicit wattage could be parsed.",
        rawText: cleaned,
      };
    }
    return null;
  }

  return {
    baseTgpW,
    maxGraphicsPowerW,
    dynamicBoostW,
    qualification: Array.from(new Set(qualifications)).join(" "),
    rawText: cleaned,
  };
}

function gpuTextSources(
  snapshot: PageSnapshot,
  index: SpecIndex,
  ctx: ExtractionContext,
  title: string | null,
): Array<{ text: string; source: ReturnType<ExtractionContext["source"]>; label: string | null }> {
  const sources: Array<{
    text: string;
    source: ReturnType<ExtractionContext["source"]>;
    label: string | null;
  }> = [];

  for (const row of index.find([
    "graphics",
    "graphics processor",
    "gpu",
    "gpu model",
    "graphics card",
    "dedicated graphics",
    "graphics type",
    "display graphics",
    "video graphics",
    "graphics processing unit",
    "graphics memory",
    "video memory",
    "gpu memory",
    "vram",
    "graphics ram",
    "dedicated graphic memory capacity",
    "dedicated graphics memory",
  ])) {
    sources.push({
      text: row.value,
      source: ctx.sourceForSection(row.section, row.sourceType),
      label: row.label,
    });
  }

  for (const text of snapshot.bulletTexts) {
    if (/(?:nvidia|geforce|rtx|gtx|radeon|intel\s+(?:arc|iris|uhd|graphics)|gpu|graphics)/i.test(text)) {
      sources.push({
        text,
        source: ctx.source("amazon_listing_text", "#feature-bullets"),
        label: "bullets",
      });
    }
  }

  if (snapshot.descriptionText) {
    const chunks = snapshot.descriptionText.match(/[^.!?]{0,220}(?:nvidia|geforce|rtx|gtx|radeon|intel\s+(?:arc|iris|uhd|graphics)|gpu|graphics)[^.!?]{0,220}/gi);
    for (const chunk of chunks ?? []) {
      sources.push({
        text: chunk,
        source: ctx.source("amazon_listing_text", "#productDescription"),
        label: "description",
      });
    }
  }

  if (title && /(?:nvidia|geforce|rtx|gtx|radeon|intel\s+(?:arc|iris|uhd|graphics)|gpu|graphics)/i.test(title)) {
    sources.push({
      text: title,
      source: ctx.source("amazon_title", "title"),
      label: "title",
    });
  }

  return sources;
}

export function extractGpu(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
  title: string | null,
): GpuSpec {
  const index = new SpecIndex(snapshot);
  const texts = gpuTextSources(snapshot, index, ctx, title);

  const modelCandidates: Array<SpecCandidate<string> & { gpuType: GpuSpec["type"] }> = [];
  const seenModels = new Set<string>();
  for (const item of texts) {
    const match: GpuModelMatch | null = extractGpuModel(item.text);
    if (!match) continue;
    const key = `${match.model}|${match.type}`;
    if (seenModels.has(key)) continue;
    seenModels.add(key);
    modelCandidates.push({
      ...candidateFrom({
        value: match.model,
        source: item.source,
        rawText: item.text,
        qualification:
          match.type === "discrete"
            ? "Normalized to laptop GPU naming; verify exact laptop TGP/VRAM configuration."
            : "Integrated GPU model.",
      }),
      gpuType: match.type,
    });
  }

  if (title) {
    const titleMatch = extractGpuModel(title);
    if (titleMatch) {
      const key = `${titleMatch.model}|${titleMatch.type}`;
      if (!seenModels.has(key)) {
        seenModels.add(key);
        modelCandidates.push({
          ...candidateFrom({
            value: titleMatch.model,
            source: ctx.source("amazon_title", "title"),
            rawText: title,
            qualification: "GPU model derived from the listing title; unverified.",
          }),
          gpuType: titleMatch.type,
        });
      }
    }
  }

  const hasDiscrete = modelCandidates.some((candidate) => candidate.gpuType === "discrete");
  const selectedCandidates = hasDiscrete
    ? modelCandidates.filter((candidate) => candidate.gpuType === "discrete")
    : modelCandidates;
  if (hasDiscrete && modelCandidates.some((candidate) => candidate.gpuType === "integrated")) {
    ctx.warn(
      "hybrid_graphics",
      "Both discrete and integrated graphics were found; the discrete GPU is used for comparison.",
    );
  }

  const conflicts = conflictingCandidates(selectedCandidates);
  if (conflicts.length > 1) {
    ctx.warn(
      "gpu_model_conflict",
      "Conflicting GPU models were found; the highest-priority source was used.",
      conflicts
        .map((candidate) => `${String(candidate.value)} (${candidate.source?.type ?? "unknown"})`)
        .join("; "),
    );
  }

  const model = chooseField(
    selectedCandidates.map(({ gpuType: _gpuType, ...candidate }) => candidate),
    hasDiscrete
      ? "Multiple GPU entries may indicate hybrid graphics; the discrete GPU is shown."
      : null,
  );
  const gpuType = model.value
    ? (hasDiscrete ? "discrete" : (modelCandidates[0]?.gpuType ?? "unknown"))
    : "unknown";

  const vramCandidates: SpecCandidate<number>[] = [];
  const vramRows = index.find([
    "graphics memory",
    "video memory",
    "gpu memory",
    "vram",
    "graphics ram",
    "dedicated graphic memory capacity",
    "dedicated graphics memory",
  ]);
  for (const row of vramRows) {
    const parsed = parseVramFromGpuText(row.value);
    if (!parsed) continue;
    vramCandidates.push(
      candidateFrom({
        value: parsed.gb,
        unit: "GB",
        source: ctx.sourceForSection(row.section, row.sourceType),
        rawText: `${row.label}: ${row.value}`,
        qualification: parsed.qualification,
      }),
    );
  }

  for (const item of texts) {
    if (!/(?:vram|video\s+memory|graphics\s+memory|gddr|gpu\s+memory)/i.test(item.text)) continue;
    const parsed = parseVramFromGpuText(item.text);
    if (!parsed) continue;
    vramCandidates.push(
      candidateFrom({
        value: parsed.gb,
        unit: "GB",
        source: item.source,
        rawText: item.text,
        qualification: parsed.qualification,
      }),
    );
  }

  let vramGb: SpecField<number>;
  if (vramCandidates.length > 0) {
    vramGb = chooseField(vramCandidates);
  } else if (gpuType === "integrated") {
    vramGb = notApplicableField<number>(
      "Integrated GPU uses shared system memory; dedicated VRAM is not applicable.",
      model.source,
      model.rawText,
    );
  } else {
    vramGb = unknownField<number>(
      "VRAM capacity was not explicitly stated. It was not inferred from the GPU model name.",
    );
    if (gpuType === "discrete") {
      ctx.warn(
        "gpu_vram_missing",
        "Discrete GPU found but VRAM was not explicitly stated; left as unknown.",
      );
    }
  }

  const powerRows = index.find([
    "maximum graphics power",
    "max graphics power",
    "graphics power",
    "gpu power",
    "tgp",
    "total graphics power",
    "dynamic boost",
    "max tgp",
    "gpu tgp",
  ]);

  const baseCandidates: SpecCandidate<number>[] = [];
  const maxCandidates: SpecCandidate<number>[] = [];
  const boostCandidates: SpecCandidate<number>[] = [];
  const powerQualifications: string[] = [];

  const addPower = (
    parsed: GpuPowerParse | null,
    source: ReturnType<ExtractionContext["source"]>,
    rawText: string,
  ): void => {
    if (!parsed) return;
    if (parsed.baseTgpW !== null) {
      baseCandidates.push(
        candidateFrom({
          value: parsed.baseTgpW,
          unit: "W",
          source,
          rawText,
          qualification: parsed.qualification,
        }),
      );
    }
    if (parsed.maxGraphicsPowerW !== null) {
      maxCandidates.push(
        candidateFrom({
          value: parsed.maxGraphicsPowerW,
          unit: "W",
          source,
          rawText,
          qualification: parsed.qualification,
        }),
      );
    }
    if (parsed.dynamicBoostW !== null) {
      boostCandidates.push(
        candidateFrom({
          value: parsed.dynamicBoostW,
          unit: "W",
          source,
          rawText,
          qualification: parsed.qualification,
        }),
      );
    }
    if (parsed.qualification) powerQualifications.push(parsed.qualification);
  };

  for (const row of powerRows) {
    addPower(
      parseGpuPower(row.value, row.label),
      ctx.sourceForSection(row.section, row.sourceType),
      `${row.label}: ${row.value}`,
    );
  }

  for (const item of texts) {
    if (!/(?:tgp|graphics\s+power|gpu\s+power|dynamic\s+boost|maximum\s+graphics)/i.test(item.text)) {
      continue;
    }
    addPower(parseGpuPower(item.text, item.label), item.source, item.text);
  }

  const baseTgpW = chooseField(baseCandidates);
  const maxGraphicsPowerW = chooseField(maxCandidates);
  const dynamicBoostW = chooseField(boostCandidates);

  if (
    gpuType === "discrete" &&
    baseTgpW.value === null &&
    maxGraphicsPowerW.value === null
  ) {
    ctx.warn(
      "gpu_power_missing",
      "GPU wattage was not explicitly stated; TGP/maximum graphics power left as unknown.",
    );
  }

  return {
    model,
    type: gpuType,
    vramGb,
    baseTgpW,
    maxGraphicsPowerW,
    dynamicBoostW,
    powerQualification:
      Array.from(new Set(powerQualifications)).join(" ").trim() || null,
  };
}
