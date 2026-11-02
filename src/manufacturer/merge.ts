import type {
  ExtractedProduct,
  SourceRef,
  SpecCandidate,
  SpecField,
  VerificationStatus,
} from "../types.js";
import type { ExtractionContext } from "../extract/context.js";
import type {
  ManufacturerCpuSpec,
  ManufacturerEntry,
  ManufacturerGpuSpec,
  ManufacturerMemorySpec,
  ResolvedManufacturerEntry,
} from "./provider.js";
import { ManufacturerProvider } from "./provider.js";

function combineQualification(...values: Array<string | null | undefined>): string | null {
  const unique = Array.from(
    new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
  );
  return unique.join(" ") || null;
}

function sameValue<T>(left: T | null, right: T | null): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left === "string" && typeof right === "string") {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeField<T>(
  current: SpecField<T>,
  options: {
    externalValue: T | null;
    unit?: string | null;
    source: SourceRef;
    verification: VerificationStatus;
    qualification?: string | null;
    fieldName: string;
    ctx: ExtractionContext;
  },
): SpecField<T> {
  if (options.externalValue === null) return current;

  const externalCandidate: SpecCandidate<T> = {
    value: options.externalValue,
    unit: options.unit ?? current.unit ?? null,
    source: options.source,
    verification: options.verification,
    qualification: options.qualification ?? null,
    rawText: "Manufacturer specification override",
  };

  if (current.value === null || current.verification === "not_applicable") {
    return {
      value: options.externalValue,
      unit: externalCandidate.unit,
      source: options.source,
      verification: options.verification,
      qualification: combineQualification(options.qualification),
      rawText: externalCandidate.rawText,
      candidates: [...current.candidates, externalCandidate],
    };
  }

  if (sameValue(current.value, options.externalValue)) {
    return {
      ...current,
      source: options.source,
      verification: options.verification,
      qualification: combineQualification(
        current.qualification,
        options.qualification,
        "Cross-checked against a manufacturer source.",
      ),
      candidates: [...current.candidates, externalCandidate],
    };
  }

  options.ctx.warn(
    "manufacturer_conflict",
    `Manufacturer specification conflicts with the Amazon listing for ${options.fieldName}; the manufacturer value was used.`,
    `Amazon=${String(current.value)}; manufacturer=${String(options.externalValue)}; source=${options.source.url}`,
  );

  return {
    value: options.externalValue,
    unit: externalCandidate.unit,
    source: options.source,
    verification: options.verification,
    qualification: combineQualification(
      options.qualification,
      "Manufacturer official value used; the Amazon listing claim is preserved in candidates.",
    ),
    rawText: externalCandidate.rawText,
    candidates: [...current.candidates, externalCandidate],
  };
}

function applyGpu(
  product: ExtractedProduct,
  entry: ManufacturerEntry,
  gpu: ManufacturerGpuSpec,
  provider: ManufacturerProvider,
  ctx: ExtractionContext,
): void {
  const source = provider.sourceFor(entry, gpu.source);
  const verification = provider.verification(entry);
  if (gpu.model) {
    product.gpu.model = mergeField(product.gpu.model, {
      externalValue: gpu.model,
      source,
      verification,
      qualification: gpu.qualification ?? entry.notes ?? null,
      fieldName: "GPU model",
      ctx,
    });
  }
  if (gpu.type) {
    product.gpu.type = gpu.type;
  }
  if (gpu.vramGb !== undefined && gpu.vramGb !== null) {
    product.gpu.vramGb = mergeField(product.gpu.vramGb, {
      externalValue: gpu.vramGb,
      unit: "GB",
      source,
      verification,
      qualification: gpu.qualification ?? entry.notes ?? null,
      fieldName: "GPU VRAM",
      ctx,
    });
  }
  if (gpu.baseTgpW !== undefined && gpu.baseTgpW !== null) {
    product.gpu.baseTgpW = mergeField(product.gpu.baseTgpW, {
      externalValue: gpu.baseTgpW,
      unit: "W",
      source,
      verification,
      qualification: gpu.qualification ?? entry.notes ?? null,
      fieldName: "GPU base TGP",
      ctx,
    });
  }
  if (gpu.maxGraphicsPowerW !== undefined && gpu.maxGraphicsPowerW !== null) {
    product.gpu.maxGraphicsPowerW = mergeField(product.gpu.maxGraphicsPowerW, {
      externalValue: gpu.maxGraphicsPowerW,
      unit: "W",
      source,
      verification,
      qualification: gpu.qualification ?? entry.notes ?? null,
      fieldName: "GPU maximum graphics power",
      ctx,
    });
  }
  if (gpu.dynamicBoostW !== undefined && gpu.dynamicBoostW !== null) {
    product.gpu.dynamicBoostW = mergeField(product.gpu.dynamicBoostW, {
      externalValue: gpu.dynamicBoostW,
      unit: "W",
      source,
      verification,
      qualification: gpu.qualification ?? entry.notes ?? null,
      fieldName: "GPU Dynamic Boost",
      ctx,
    });
  }
  product.gpu.powerQualification = combineQualification(
    product.gpu.powerQualification,
    gpu.qualification,
    entry.notes,
  );
}

function applyCpu(
  product: ExtractedProduct,
  entry: ManufacturerEntry,
  cpu: ManufacturerCpuSpec,
  provider: ManufacturerProvider,
  ctx: ExtractionContext,
): void {
  const source = provider.sourceFor(entry, cpu.source);
  const verification = provider.verification(entry);
  if (cpu.model) {
    product.cpu.model = mergeField(product.cpu.model, {
      externalValue: cpu.model,
      source,
      verification,
      qualification: cpu.qualification ?? entry.notes ?? null,
      fieldName: "CPU model",
      ctx,
    });
  }
  if (cpu.baseTdpW !== undefined && cpu.baseTdpW !== null) {
    product.cpu.baseTdpW = mergeField(product.cpu.baseTdpW, {
      externalValue: cpu.baseTdpW,
      unit: "W",
      source,
      verification,
      qualification: cpu.qualification ?? entry.notes ?? null,
      fieldName: "CPU base TDP",
      ctx,
    });
  }
  if (cpu.maxTurboPowerW !== undefined && cpu.maxTurboPowerW !== null) {
    product.cpu.maxTurboPowerW = mergeField(product.cpu.maxTurboPowerW, {
      externalValue: cpu.maxTurboPowerW,
      unit: "W",
      source,
      verification,
      qualification: cpu.qualification ?? entry.notes ?? null,
      fieldName: "CPU maximum turbo power",
      ctx,
    });
  }
  if (cpu.configurableTdpW !== undefined && cpu.configurableTdpW !== null) {
    product.cpu.configurableTdpW = mergeField(product.cpu.configurableTdpW, {
      externalValue: cpu.configurableTdpW,
      unit: "W",
      source,
      verification,
      qualification: cpu.qualification ?? entry.notes ?? null,
      fieldName: "CPU configurable TDP",
      ctx,
    });
  }
  product.cpu.powerQualification = combineQualification(
    product.cpu.powerQualification,
    cpu.qualification,
    entry.notes,
  );
}

function applyMemory(
  product: ExtractedProduct,
  entry: ManufacturerEntry,
  memory: ManufacturerMemorySpec,
  provider: ManufacturerProvider,
  ctx: ExtractionContext,
): void {
  const source = provider.sourceFor(entry, memory.source);
  const verification = provider.verification(entry);
  if (memory.installedGb !== undefined && memory.installedGb !== null) {
    product.memory.installedGb = mergeField(product.memory.installedGb, {
      externalValue: memory.installedGb,
      unit: "GB",
      source,
      verification,
      qualification: memory.notes ?? entry.notes ?? null,
      fieldName: "installed RAM",
      ctx,
    });
  }
  if (memory.type) {
    product.memory.type = mergeField(product.memory.type, {
      externalValue: memory.type,
      source,
      verification,
      qualification: memory.notes ?? entry.notes ?? null,
      fieldName: "RAM type",
      ctx,
    });
  }
  if (memory.speedMhz !== undefined && memory.speedMhz !== null) {
    product.memory.speedMhz = mergeField(product.memory.speedMhz, {
      externalValue: memory.speedMhz,
      unit: "MHz",
      source,
      verification,
      qualification: memory.notes ?? entry.notes ?? null,
      fieldName: "RAM speed",
      ctx,
    });
  }
  if (memory.upgradeability !== undefined && memory.upgradeability !== null) {
    product.memory.upgradeability = mergeField(product.memory.upgradeability, {
      externalValue: memory.upgradeability,
      source,
      verification,
      qualification: memory.notes ?? entry.notes ?? null,
      fieldName: "RAM upgradeability",
      ctx,
    });
  }
  product.memory.upgradeNotes = combineQualification(
    product.memory.upgradeNotes,
    memory.notes,
    entry.notes,
  );
}

export function applyManufacturerSpecs(
  product: ExtractedProduct,
  resolved: ResolvedManufacturerEntry,
  provider: ManufacturerProvider,
  ctx: ExtractionContext,
): ExtractedProduct {
  const { entry } = resolved;
  const source = provider.sourceFor(entry);
  const verification = provider.verification(entry);
  const specs = entry.specs;

  if (specs?.brand) {
    product.brand = mergeField(product.brand, {
      externalValue: specs.brand,
      source,
      verification,
      qualification: entry.notes ?? null,
      fieldName: "brand",
      ctx,
    });
  }
  if (specs?.model) {
    product.model = mergeField(product.model, {
      externalValue: specs.model,
      source,
      verification,
      qualification: entry.notes ?? null,
      fieldName: "model/SKU",
      ctx,
    });
  }
  if (specs?.gpu) applyGpu(product, entry, specs.gpu, provider, ctx);
  if (specs?.cpu) applyCpu(product, entry, specs.cpu, provider, ctx);
  if (specs?.memory) applyMemory(product, entry, specs.memory, provider, ctx);

  return product;
}
