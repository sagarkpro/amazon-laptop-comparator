import type {
  Offer,
  ProductRecord,
  Report,
  SpecField,
  TdpRange,
} from "../types.js";

function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined || value === "") {
    text = "unknown";
  } else {
    text = String(value).replace(/\r?\n/g, " ");
  }
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function fieldValue<T>(field: SpecField<T>): string {
  if (field.value === null) {
    return field.verification === "not_applicable" ? "not_applicable" : "unknown";
  }
  if (typeof field.value === "object" && field.value !== null) {
    const range = field.value as unknown as TdpRange;
    if (typeof range.min === "number" && typeof range.max === "number") {
      return `${range.min}-${range.max}`;
    }
    return JSON.stringify(field.value);
  }
  return String(field.value);
}

function fieldStatus<T>(field: SpecField<T>): string {
  return field.verification;
}

function fieldSource<T>(field: SpecField<T>): string {
  return field.source?.url ?? "unknown";
}

function joinOffers(offers: Offer[], type: Offer["type"]): string {
  return offers
    .filter((offer) => offer.type === type)
    .map((offer) => offer.rawText)
    .join(" | ");
}

function joinIssues(issues: Array<{ code: string; message: string }>): string {
  return issues.map((issue) => `${issue.code}: ${issue.message}`).join(" | ");
}

function productRow(product: ProductRecord): unknown[] {
  const coupon = joinOffers(product.price.offers, "coupon");
  const bank = joinOffers(product.price.offers, "bank_instant_discount");
  const other = product.price.offers
    .filter(
      (offer) =>
        offer.type === "exchange" ||
        offer.type === "cashback" ||
        offer.type === "no_cost_emi" ||
        offer.type === "membership" ||
        offer.type === "other",
    )
    .map((offer) => `[${offer.type}] ${offer.rawText}`)
    .join(" | ");

  return [
    product.inputUrl,
    product.productUrl ?? product.requestedUrl,
    product.imageUrl ?? "unknown",
    product.resolvedUrl ?? "unknown",
    product.asin ?? "unknown",
    product.title ?? "unknown",
    product.brand.value ?? "unknown",
    fieldStatus(product.brand),
    product.model.value ?? "unknown",
    fieldStatus(product.model),
    product.availability.value,
    product.gpu.model.value ?? "unknown",
    product.gpu.type,
    fieldStatus(product.gpu.model),
    fieldValue(product.gpu.vramGb),
    fieldStatus(product.gpu.vramGb),
    fieldValue(product.gpu.baseTgpW),
    fieldStatus(product.gpu.baseTgpW),
    fieldValue(product.gpu.maxGraphicsPowerW),
    fieldStatus(product.gpu.maxGraphicsPowerW),
    fieldValue(product.gpu.dynamicBoostW),
    fieldStatus(product.gpu.dynamicBoostW),
    product.gpu.powerQualification ?? "",
    fieldSource(product.gpu.model),
    product.cpu.model.value ?? "unknown",
    fieldStatus(product.cpu.model),
    fieldValue(product.cpu.baseTdpW),
    fieldStatus(product.cpu.baseTdpW),
    fieldValue(product.cpu.maxTurboPowerW),
    fieldStatus(product.cpu.maxTurboPowerW),
    fieldValue(product.cpu.configurableTdpW),
    fieldStatus(product.cpu.configurableTdpW),
    product.cpu.powerQualification ?? "",
    fieldSource(product.cpu.model),
    fieldValue(product.memory.installedGb),
    fieldStatus(product.memory.installedGb),
    product.memory.type.value ?? "unknown",
    fieldStatus(product.memory.type),
    fieldValue(product.memory.speedMhz),
    fieldStatus(product.memory.speedMhz),
    product.memory.upgradeability.value ?? "unknown",
    fieldStatus(product.memory.upgradeability),
    product.memory.upgradeNotes ?? "",
    fieldSource(product.memory.installedGb),
    fieldValue(product.storage),
    fieldStatus(product.storage),
    fieldValue(product.display),
    fieldStatus(product.display),
    fieldValue(product.weight),
    fieldStatus(product.weight),
    product.price.currency,
    product.price.listedPrice?.amount ?? "unknown",
    product.price.mrp?.amount ?? "unknown",
    coupon || "none",
    bank || "none",
    other || "none",
    product.price.priceWithoutConditionalOffers?.amount ?? "unknown",
    product.price.bestEffectivePrice?.amount ?? "unknown",
    product.price.conditionalBestPrice?.amount ?? "unknown",
    product.price.conditionalOfferId ?? "unknown",
    product.price.emiConditionalBestPrice?.amount ?? "unknown",
    product.price.emiConditionalOfferId ?? "unknown",
    product.price.offerEligibility.join(" | "),
    product.price.calculationNotes.join(" | "),
    product.price.source?.url ?? "unknown",
    product.price.timestamp,
    product.extraction.status,
    product.extraction.missingFields.join(", "),
    joinIssues(product.extraction.warnings),
    joinIssues(product.extraction.errors),
    product.extraction.finishedAt,
    String(product.extraction.durationMs),
  ];
}

const HEADERS = [
  "input_url",
  "product_url",
  "image_url",
  "resolved_url",
  "asin",
  "title",
  "brand",
  "brand_verification",
  "model_sku",
  "model_verification",
  "availability",
  "gpu_model",
  "gpu_type",
  "gpu_model_verification",
  "gpu_vram_gb",
  "gpu_vram_verification",
  "gpu_base_tgp_w",
  "gpu_base_tgp_verification",
  "gpu_max_graphics_power_w",
  "gpu_max_power_verification",
  "gpu_dynamic_boost_w",
  "gpu_dynamic_boost_verification",
  "gpu_power_qualification",
  "gpu_source_url",
  "cpu_model",
  "cpu_model_verification",
  "cpu_base_tdp_w",
  "cpu_base_tdp_verification",
  "cpu_max_turbo_w",
  "cpu_max_turbo_verification",
  "cpu_configurable_tdp_w",
  "cpu_configurable_tdp_verification",
  "cpu_power_qualification",
  "cpu_source_url",
  "ram_gb",
  "ram_gb_verification",
  "ram_type",
  "ram_type_verification",
  "ram_speed_mhz",
  "ram_speed_verification",
  "ram_upgradeable",
  "ram_upgrade_verification",
  "ram_upgrade_notes",
  "ram_source_url",
  "storage",
  "storage_verification",
  "display",
  "display_verification",
  "weight",
  "weight_verification",
  "currency",
  "listed_price_inr",
  "mrp_inr",
  "coupon_summary",
  "bank_offer_summary",
  "other_offer_summary",
  "price_without_conditional_offers_inr",
  "best_effective_price_inr",
  "full_payment_conditional_price_inr",
  "full_payment_conditional_offer_id",
  "emi_conditional_price_before_fees_inr",
  "emi_conditional_offer_id",
  "offer_eligibility",
  "price_calculation",
  "price_source_url",
  "price_timestamp",
  "extraction_status",
  "missing_fields",
  "warnings",
  "errors",
  "extraction_timestamp",
  "extraction_duration_ms",
] as const;

export function buildCsv(report: Report): string {
  const lines = [HEADERS.join(",")];
  for (const product of report.products) {
    const row = productRow(product);
    if (row.length !== HEADERS.length) {
      throw new Error(
        `CSV column count mismatch: expected ${HEADERS.length}, got ${row.length}`,
      );
    }
    lines.push(row.map(csvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
