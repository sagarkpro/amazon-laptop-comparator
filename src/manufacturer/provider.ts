import { existsSync, readFileSync } from "node:fs";
import type { GpuType, SourceRef, Upgradeability } from "../types.js";
import type { Logger } from "../logger.js";
import { cleanText } from "../normalize/text.js";

export interface ManufacturerSourceConfig {
  type?: string;
  url: string;
  retrievedAt?: string;
  section?: string;
}

export interface ManufacturerGpuSpec {
  source?: ManufacturerSourceConfig;
  model?: string | null;
  type?: GpuType;
  vramGb?: number | null;
  baseTgpW?: number | null;
  maxGraphicsPowerW?: number | null;
  dynamicBoostW?: number | null;
  qualification?: string | null;
}

export interface ManufacturerCpuSpec {
  source?: ManufacturerSourceConfig;
  model?: string | null;
  baseTdpW?: number | null;
  maxTurboPowerW?: number | null;
  configurableTdpW?: { min: number; max: number } | null;
  qualification?: string | null;
}

export interface ManufacturerMemorySpec {
  source?: ManufacturerSourceConfig;
  installedGb?: number | null;
  type?: string | null;
  speedMhz?: number | null;
  upgradeability?: Upgradeability | null;
  notes?: string | null;
}

export interface ManufacturerSpecs {
  brand?: string | null;
  model?: string | null;
  gpu?: ManufacturerGpuSpec;
  cpu?: ManufacturerCpuSpec;
  memory?: ManufacturerMemorySpec;
}

export interface ManufacturerEntry {
  asin?: string;
  modelPattern?: string;
  verified?: boolean;
  source?: ManufacturerSourceConfig;
  specs?: ManufacturerSpecs;
  notes?: string;
}

interface ManufacturerFile {
  version?: number;
  entries?: ManufacturerEntry[];
}

export interface ResolvedManufacturerEntry {
  entry: ManufacturerEntry;
  source: SourceRef;
  matchedBy: "asin" | "model_pattern";
}

export class ManufacturerProvider {
  private constructor(
    private readonly entries: ManufacturerEntry[],
    private readonly logger: Logger,
  ) {}

  static load(
    filePath: string,
    enabled: boolean,
    logger: Logger,
  ): ManufacturerProvider {
    if (!enabled) {
      logger.info("Manufacturer overrides disabled");
      return new ManufacturerProvider([], logger);
    }
    if (!existsSync(filePath)) {
      logger.info(
        "No manufacturer specification file found; Amazon listing data will be unverified",
        filePath,
      );
      return new ManufacturerProvider([], logger);
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ManufacturerFile;
      const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      const valid = entries.filter((entry) => {
        if (!entry.source?.url) {
          logger.warn(
            "Manufacturer entry skipped: missing source URL",
            entry.asin ?? entry.modelPattern ?? "unknown entry",
          );
          return false;
        }
        return true;
      });
      logger.info(
        "Manufacturer specification overrides loaded",
        `${valid.length} valid entries`,
      );
      return new ManufacturerProvider(valid, logger);
    } catch (error) {
      logger.warn(
        "Could not parse manufacturer specification file; continuing without overrides",
        error instanceof Error ? error.message : String(error),
      );
      return new ManufacturerProvider([], logger);
    }
  }

  find(asin: string | null, title: string | null, model: string | null): ResolvedManufacturerEntry | null {
    if (asin) {
      const byAsin = this.entries.find(
        (entry) => entry.asin?.trim().toUpperCase() === asin.toUpperCase(),
      );
      if (byAsin) {
        return {
          entry: byAsin,
          source: this.sourceFor(byAsin),
          matchedBy: "asin",
        };
      }
    }

    const haystack = cleanText([title, model].filter(Boolean).join(" "));
    if (!haystack) return null;

    const matches: ManufacturerEntry[] = [];
    for (const entry of this.entries) {
      if (!entry.modelPattern) continue;
      try {
        if (new RegExp(entry.modelPattern, "i").test(haystack)) {
          matches.push(entry);
        }
      } catch {
        this.logger.warn(
          "Invalid modelPattern in manufacturer entry",
          entry.modelPattern,
        );
      }
    }

    if (matches.length > 1) {
      this.logger.warn(
        "Multiple manufacturer entries matched; no override applied",
        matches
          .map((entry) => entry.asin ?? entry.modelPattern ?? "unknown")
          .join(", "),
      );
      return null;
    }
    const match = matches[0];
    if (!match) return null;
    return {
      entry: match,
      source: this.sourceFor(match),
      matchedBy: "model_pattern",
    };
  }

  sourceFor(
    entry: ManufacturerEntry,
    sectionSource?: ManufacturerSourceConfig,
  ): SourceRef {
    const source = sectionSource ?? entry.source;
    return {
      type: "manufacturer_official",
      url: source?.url ?? entry.source?.url ?? "",
      section: source?.section ?? null,
      retrievedAt:
        source?.retrievedAt ??
        entry.source?.retrievedAt ??
        new Date().toISOString(),
    };
  }

  verification(entry: ManufacturerEntry): "verified" | "unverified" {
    return entry.verified === true ? "verified" : "unverified";
  }
}
