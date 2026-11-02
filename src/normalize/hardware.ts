import type { Availability, GpuType, Upgradeability } from "../types.js";
import { cleanText } from "./text.js";

export interface GpuModelMatch {
  model: string;
  type: GpuType;
  raw: string;
  index: number;
}

interface GpuPattern {
  regex: RegExp;
  type: GpuType;
  format: (match: RegExpMatchArray) => string;
}

const GPU_PATTERNS: GpuPattern[] = [
  {
    regex: /\b(?:NVIDIA\s+)?(?:GeForce\s+)?RTX\s+(\d{4})\s*(Ti|Super)?\b/i,
    type: "discrete",
    format: (match) =>
      `NVIDIA GeForce RTX ${match[1] ?? ""}${match[2] ? ` ${match[2]}` : ""} Laptop GPU`,
  },
  {
    regex: /\b(?:NVIDIA\s+)?(?:GeForce\s+)?GTX\s+(\d{3,4})\s*(Ti|Super)?\b/i,
    type: "discrete",
    format: (match) =>
      `NVIDIA GeForce GTX ${match[1] ?? ""}${match[2] ? ` ${match[2]}` : ""} Laptop GPU`,
  },
  {
    regex: /\b(?:AMD\s+)?Radeon\s+RX\s+(\d{3,4}[A-Z]{0,2})\b/i,
    type: "discrete",
    format: (match) => `AMD Radeon RX ${(match[1] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bIntel\s+Arc\s+([A-Z]\d{3}M?)\b/i,
    type: "discrete",
    format: (match) => `Intel Arc ${(match[1] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bArc\s+([A-Z]\d{3}M?)\b/i,
    type: "discrete",
    format: (match) => `Intel Arc ${(match[1] ?? "").toUpperCase()}`,
  },
  {
    regex: /\b(?:AMD\s+)?Radeon\s+(\d{3}M?)\b/i,
    type: "integrated",
    format: (match) => `AMD Radeon ${(match[1] ?? "").toUpperCase()}`,
  },
  {
    regex: /\b(?:AMD\s+)?Radeon\s+(Graphics)\b/i,
    type: "integrated",
    format: () => "AMD Radeon Graphics",
  },
  {
    regex: /\bIntel\s+Iris\s+Xe(?:\s+Graphics)?\b/i,
    type: "integrated",
    format: () => "Intel Iris Xe Graphics",
  },
  {
    regex: /\bIntel\s+UHD(?:\s+Graphics)?\b/i,
    type: "integrated",
    format: () => "Intel UHD Graphics",
  },
  {
    regex: /\bIntel\s+HD(?:\s+Graphics)?\b/i,
    type: "integrated",
    format: () => "Intel HD Graphics",
  },
  {
    regex: /\bIntel\s+Graphics\b/i,
    type: "integrated",
    format: () => "Intel Graphics",
  },
  {
    regex: /\bApple\s+M([1-4])\s*(Pro|Max|Ultra)?\b/i,
    type: "integrated",
    format: (match) =>
      `Apple M${match[1] ?? ""}${match[2] ? ` ${match[2]}` : ""} GPU`,
  },
  {
    regex: /\b(?:Qualcomm\s+)?Snapdragon\s+(X\s+(?:Elite|Plus)|8cx[^\s,]*)\b/i,
    type: "integrated",
    format: (match) => `Qualcomm Snapdragon ${match[1] ?? ""}`,
  },
  {
    regex: /\bIntegrated\s+Graphics\b/i,
    type: "integrated",
    format: () => "Integrated Graphics",
  },
];

export function extractGpuModel(text: string | null | undefined): GpuModelMatch | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  for (const pattern of GPU_PATTERNS) {
    const match = cleaned.match(pattern.regex);
    if (!match) continue;
    return {
      model: pattern.format(match),
      type: pattern.type,
      raw: match[0],
      index: match.index ?? 0,
    };
  }
  return null;
}

export function detectGpuType(text: string | null | undefined): GpuType {
  return extractGpuModel(text)?.type ?? "unknown";
}

interface CpuPattern {
  regex: RegExp;
  format: (match: RegExpMatchArray) => string;
}

const CPU_PATTERNS: CpuPattern[] = [
  {
    regex: /\bIntel\s+Core\s+Ultra\s+([3579])\s+(\d{3}[A-Z]{0,3})\b/i,
    format: (match) =>
      `Intel Core Ultra ${match[1] ?? ""} ${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bIntel\s+Core\s+i([3579])-(\d{4,5}[A-Z]{0,3})\b/i,
    format: (match) =>
      `Intel Core i${match[1] ?? ""}-${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bCore\s+i([3579])-(\d{4,5}[A-Z]{0,3})\b/i,
    format: (match) =>
      `Intel Core i${match[1] ?? ""}-${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bIntel\s+Core\s+([357])\s+(\d{3}[A-Z]{0,3})\b/i,
    format: (match) =>
      `Intel Core ${match[1] ?? ""} ${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bAMD\s+Ryzen\s+AI\s+([3579])\s+(HX\s+)?(\d{3}[A-Z]{0,3})\b/i,
    format: (match) =>
      `AMD Ryzen AI ${match[1] ?? ""} ${match[2] ? "HX " : ""}${(match[3] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bAMD\s+Ryzen\s+([3579])\s+(\d{4}[A-Z]{0,3})\b/i,
    format: (match) =>
      `AMD Ryzen ${match[1] ?? ""} ${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bRyzen\s+([3579])\s+(\d{4}[A-Z]{0,3})\b/i,
    format: (match) =>
      `AMD Ryzen ${match[1] ?? ""} ${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bApple\s+M([1-4])(?:\s+(Pro|Max|Ultra))?\b/i,
    format: (match) =>
      `Apple M${match[1] ?? ""}${match[2] ? ` ${match[2]}` : ""}`,
  },
  {
    regex: /\bIntel\s+Processor\s+(N\d{2,3})\b/i,
    format: (match) => `Intel Processor ${(match[1] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bIntel\s+(Celeron|Pentium)\s+([A-Z0-9-]+)\b/i,
    format: (match) =>
      `Intel ${(match[1] ?? "").charAt(0).toUpperCase()}${(match[1] ?? "").slice(1).toLowerCase()} ${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\bAMD\s+(Athlon)\s+([A-Z0-9-]+)\b/i,
    format: (match) => `AMD Athlon ${(match[2] ?? "").toUpperCase()}`,
  },
  {
    regex: /\b(?:Qualcomm\s+)?Snapdragon\s+(X\s+(?:Elite|Plus)|8cx[^\s,]*)\b/i,
    format: (match) => `Qualcomm Snapdragon ${match[1] ?? ""}`,
  },
];

export function extractCpuModel(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  for (const pattern of CPU_PATTERNS) {
    const match = cleaned.match(pattern.regex);
    if (match) return pattern.format(match);
  }
  return null;
}

const BRAND_PATTERNS: Array<{ canonical: string; regex: RegExp }> = [
  { canonical: "HP", regex: /\b(?:hp|hewlett[\s-]?packard)\b/i },
  { canonical: "Lenovo", regex: /\blenovo\b/i },
  { canonical: "ASUS", regex: /\basus\b/i },
  { canonical: "Acer", regex: /\bacer\b/i },
  { canonical: "Dell", regex: /\bdell\b/i },
  { canonical: "MSI", regex: /\bmsi\b/i },
  { canonical: "Apple", regex: /\bapple\b/i },
  { canonical: "Samsung", regex: /\bsamsung\b/i },
  { canonical: "Xiaomi", regex: /\b(?:xiaomi|mi)\b/i },
  { canonical: "Redmi", regex: /\bredmi\b/i },
  { canonical: "Realme", regex: /\brealme\b/i },
  { canonical: "Infinix", regex: /\binfinix\b/i },
  { canonical: "Honor", regex: /\bhonor\b/i },
  { canonical: "Gigabyte", regex: /\b(?:gigabyte|aorus)\b/i },
  { canonical: "Alienware", regex: /\balienware\b/i },
  { canonical: "Microsoft", regex: /\b(?:microsoft|surface)\b/i },
  { canonical: "LG", regex: /\blg\b/i },
  { canonical: "Fujitsu", regex: /\bfujitsu\b/i },
  { canonical: "Dynabook", regex: /\b(?:dynabook|toshiba)\b/i },
  { canonical: "Vaio", regex: /\bvaio\b/i },
  { canonical: "Chuwi", regex: /\bchuwi\b/i },
  { canonical: "Avita", regex: /\bavita\b/i },
  { canonical: "Primebook", regex: /\bprimebook\b/i },
  { canonical: "Ultimus", regex: /\bultimus\b/i },
  { canonical: "Thomson", regex: /\bthomson\b/i },
  { canonical: "iBall", regex: /\biball\b/i },
  { canonical: "Panasonic", regex: /\bpanasonic\b/i },
  { canonical: "NEC", regex: /\bnec\b/i },
];

export function canonicalBrand(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const brand of BRAND_PATTERNS) {
    if (brand.regex.test(text)) return brand.canonical;
  }
  const cleaned = cleanText(text)
    .replace(/^visit\s+the\s+/i, "")
    .replace(/\s+store$/i, "")
    .replace(/^brand\s*:\s*/i, "");
  return cleaned || null;
}

export function normalizeRamType(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = cleanText(text).match(
    /\b(LPDDR5X|LPDDR5|LPDDR4X|LPDDR4|DDR5|DDR4|DDR3)\b/i,
  );
  return match?.[1] ? match[1].toUpperCase() : null;
}

export interface VramMatch {
  gb: number;
  qualification: string;
  raw: string;
}

export function parseVramFromGpuText(text: string | null | undefined): VramMatch | null {
  if (!text) return null;
  const cleaned = cleanText(text);

  const gddr = cleaned.match(/(\d{1,2})\s*GB\s*(GDDR6X|GDDR6|GDDR5X|GDDR5)\b/i);
  if (gddr?.[1]) {
    const gb = Number(gddr[1]);
    if (gb > 0 && gb <= 48) {
      return {
        gb,
        qualification: `Explicit ${gddr[2] ?? "GDDR"} graphics memory.`,
        raw: gddr[0],
      };
    }
  }

  const labelled = cleaned.match(
    /(?:VRAM|Video\s+Memory|Graphics\s+Memory|Dedicated\s+Graphics\s+Memory|GPU\s+Memory)[^\d]{0,25}(\d{1,2})\s*GB\b/i,
  );
  if (labelled?.[1]) {
    const gb = Number(labelled[1]);
    if (gb > 0 && gb <= 48) {
      return {
        gb,
        qualification: "Explicit VRAM/graphics-memory label.",
        raw: labelled[0],
      };
    }
  }

  const reverse = cleaned.match(
    /(\d{1,2})\s*GB\s*(?:VRAM|Video\s+Memory|Graphics\s+Memory|Dedicated\s+Graphics\s+Memory)\b/i,
  );
  if (reverse?.[1]) {
    const gb = Number(reverse[1]);
    if (gb > 0 && gb <= 48) {
      return {
        gb,
        qualification: "Explicit VRAM/graphics-memory label.",
        raw: reverse[0],
      };
    }
  }

  const gpu = extractGpuModel(cleaned);
  if (gpu) {
    const afterModel = cleaned.slice(gpu.index, gpu.index + 100);
    const adjacent = afterModel.match(/\b(\d{1,2})\s*GB\b/i);
    if (adjacent?.[1] && adjacent.index !== undefined) {
      const gb = Number(adjacent[1]);
      const suffix = afterModel
        .slice(adjacent.index + adjacent[0].length, adjacent.index + adjacent[0].length + 35)
        .toLowerCase();
      // "RTX 4060 16GB RAM" is system memory, not VRAM. Without an explicit
      // graphics-memory marker, refuse to assign an adjacent capacity when it
      // is followed by a RAM/storage qualifier.
      const looksLikeSystemMemory = /\b(?:ram|ddr[345]|lpddr[45]x?|ssd|hdd|storage)\b/i.test(
        suffix,
      );
      if (!looksLikeSystemMemory && gb > 0 && gb <= 48) {
        return {
          gb,
          qualification:
            "Capacity stated next to the GPU model; memory type not stated. Verify against the manufacturer configuration.",
          raw: adjacent[0],
        };
      }
    }
  }

  return null;
}

export function parseRamCapacity(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  const lower = cleaned.toLowerCase();
  const storageOnly =
    /(?:ssd|hdd|emmc|storage|pcie|nvme|hard\s+drive)/i.test(lower) &&
    !/(?:ram|memory|ddr[345]|lpddr)/i.test(lower);
  if (storageOnly) return null;

  const graphicsOnly =
    /\bGDDR\d/i.test(cleaned) &&
    !/(?:ram|system\s+memory|installed\s+ram|ddr[345]|lpddr)/i.test(cleaned);
  if (graphicsOnly) return null;

  const patterns = [
    /(\d{1,3})\s*GB\s*(?:of\s+)?(?:LPDDR5X|LPDDR5|LPDDR4X|LPDDR4|DDR5|DDR4|DDR3)?\s*(?:RAM|Memory)\b/i,
    /(?:RAM|Memory|System\s+Memory|Installed\s+Memory|Memory\s+Size|Installed\s+RAM)[^\d]{0,25}(\d{1,3})\s*GB\b/i,
    /(\d{1,3})\s*GB\s*(?:LPDDR5X|LPDDR5|LPDDR4X|LPDDR4|DDR5|DDR4|DDR3)\b/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match?.[1]) continue;
    const gb = Number(match[1]);
    if (gb > 0 && gb <= 256) return gb;
  }
  return null;
}

export function parseRamSpeed(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = cleanText(text);

  const ddrSuffix = cleaned.match(
    /\b(?:LPDDR5X|LPDDR5|LPDDR4X|LPDDR4|DDR5|DDR4|DDR3)\s*[- ]?(\d{3,5})\b/i,
  );
  if (ddrSuffix?.[1]) return Number(ddrSuffix[1]);

  const labelledMhz = cleaned.match(
    /(?:RAM|Memory)[^.]{0,45}?(\d{3,5})\s*MHz\b/i,
  );
  if (labelledMhz?.[1]) return Number(labelledMhz[1]);

  // Do not treat GPU boost clocks or GDDR memory as system RAM.
  if (!/(?:^|[^G])DDR[345]|LPDDR[45]X?|\bRAM\b|\bMemory\b/i.test(cleaned)) {
    return null;
  }
  const explicitMhz = cleaned.match(/(\d{3,5})\s*MHz\b/i);
  return explicitMhz?.[1] ? Number(explicitMhz[1]) : null;
}

export function normalizeAvailability(text: string | null | undefined): Availability {
  if (!text) return "unknown";
  const lower = cleanText(text).toLowerCase();
  if (
    lower.includes("currently unavailable") ||
    lower.includes("temporarily out of stock") ||
    lower.includes("out of stock") ||
    lower.includes("unavailable")
  ) {
    return "out_of_stock";
  }
  if (lower.includes("only") && lower.includes("left")) return "limited_stock";
  if (lower.includes("limited stock") || lower.includes("few left")) return "limited_stock";
  if (lower.includes("in stock") || lower.includes("available")) return "in_stock";
  return "unknown";
}

export function normalizeSchemaAvailability(value: string | null | undefined): Availability {
  if (!value) return "unknown";
  const lower = value.toLowerCase();
  if (lower.includes("outofstock") || lower.includes("soldout")) return "out_of_stock";
  if (lower.includes("limitedavailability")) return "limited_stock";
  if (lower.includes("instock") || lower.includes("onlineonly")) return "in_stock";
  return "unknown";
}

export function normalizeUpgradeability(
  text: string | null | undefined,
): { value: Upgradeability; rawText: string | null; note: string | null } | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  const lower = cleaned.toLowerCase();

  if (/(?:non[- ]?upgradeable|not\s+upgradeable|soldered|onboard\s+memory)/i.test(lower)) {
    return {
      value: "no",
      rawText: cleaned,
      note: "Listing explicitly indicates soldered/onboard or non-upgradeable memory.",
    };
  }
  if (
    /(?:upgradeable|expandable|upgrade\s+to|max(?:imum)?\s+memory|2\s*x\s*so[- ]?dimm|so[- ]?dimm|memory\s+slots?)/i.test(
      lower,
    )
  ) {
    return {
      value: "yes",
      rawText: cleaned,
      note:
        "Listing explicitly mentions upgradeability, a memory slot, or a maximum memory capacity. Check the exact slot/capacity limit.",
    };
  }
  return null;
}
