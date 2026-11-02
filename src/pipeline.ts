import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { relative, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";
import type {
  AvailabilityInfo,
  CpuSpec,
  ExtractionStatus,
  GpuSpec,
  InputSummary,
  Issue,
  MemorySpec,
  PageSnapshot,
  PriceInfo,
  ProductRecord,
  Report,
  SourceRef,
  SpecField,
} from "./types.js";
import type { AppConfig } from "./config.js";
import { publicConfig } from "./config.js";
import { Logger, describeError } from "./logger.js";
import { parseLinksFile } from "./input/links.js";
import { extractAmazonProduct } from "./extract/amazon.js";
import { ExtractionContext } from "./extract/context.js";
import { applyManufacturerSpecs } from "./manufacturer/merge.js";
import { ManufacturerProvider } from "./manufacturer/provider.js";
import {
  createContext,
  createWorkerPage,
  launchBrowser,
  closeQuietly,
} from "./browser/browser.js";
import { gotoWithRetry, sleep, type NavigationResult } from "./browser/navigation.js";
import { captureSnapshot } from "./browser/snapshot.js";
import { waitForManualChallenge } from "./browser/challenge.js";
import { loadRobotsRules, type RobotsRules } from "./browser/robots.js";
import {
  removePartialReport,
  writePartialReport,
  writeReportOutputs,
  type OutputPaths,
} from "./output.js";
import type { NormalizedLink } from "./input/url.js";
import { unknownField } from "./normalize/sources.js";
import { canonicalProductUrl } from "./input/url.js";

interface RunContext {
  config: AppConfig;
  logger: Logger;
  runId: string;
  startedAt: string;
  inputSummary: InputSummary;
  provider: ManufacturerProvider;
  robots: RobotsRules;
}

export interface RunResult {
  report: Report;
  paths: OutputPaths;
  fatalError?: string;
}

function emptyGpu(): GpuSpec {
  return {
    model: unknownField<string>("GPU model not extracted."),
    type: "unknown",
    vramGb: unknownField<number>("VRAM not extracted."),
    baseTgpW: unknownField<number>("Base TGP not extracted."),
    maxGraphicsPowerW: unknownField<number>("Maximum graphics power not extracted."),
    dynamicBoostW: unknownField<number>("Dynamic Boost not extracted."),
    powerQualification: null,
  };
}

function emptyCpu(): CpuSpec {
  return {
    model: unknownField<string>("CPU model not extracted."),
    baseTdpW: unknownField<number>("CPU base TDP not extracted."),
    maxTurboPowerW: unknownField<number>("CPU maximum turbo power not extracted."),
    configurableTdpW: unknownField<{ min: number; max: number }>(
      "Configurable TDP not extracted.",
    ),
    powerQualification: null,
  };
}

function emptyMemory(): MemorySpec {
  return {
    installedGb: unknownField<number>("Installed RAM not extracted."),
    type: unknownField<string>("RAM type not extracted."),
    speedMhz: unknownField<number>("RAM speed not extracted."),
    upgradeability: unknownField<"yes" | "no" | "unknown">(
      "RAM upgradeability not extracted.",
    ),
    upgradeNotes: null,
  };
}

function emptyAvailability(): AvailabilityInfo {
  return {
    value: "unknown",
    rawText: null,
    source: null,
    verification: "unknown",
  };
}

function emptyPrice(timestamp: string, note = "No price extraction was performed."): PriceInfo {
  return {
    currency: "INR",
    listedPrice: null,
    mrp: null,
    offers: [],
    priceWithoutConditionalOffers: null,
    bestEffectivePrice: null,
    conditionalBestPrice: null,
    conditionalOfferId: null,
    emiConditionalBestPrice: null,
    emiConditionalOfferId: null,
    offerEligibility: [],
    calculationNotes: [note],
    timestamp,
    source: null,
    rawPriceTexts: [],
  };
}

function baseRecord(
  link: NormalizedLink,
  startedAt: string,
  status: ExtractionStatus,
  options: {
    title?: string | null;
    titleSource?: SourceRef | null;
    asin?: string | null;
    productUrl?: string | null;
    resolvedUrl?: string | null;
    httpStatus?: number | null;
    attempts?: number;
    errors?: Issue[];
    warnings?: Issue[];
    missingFields?: string[];
    availability?: AvailabilityInfo;
    price?: PriceInfo;
    snapshot?: PageSnapshot | null;
    durationMs?: number;
  } = {},
): ProductRecord {
  const finishedAt = new Date().toISOString();
  return {
    id: options.asin ?? link.asin ?? link.canonicalUrl,
    inputUrl: link.input,
    requestedUrl: link.canonicalUrl,
    resolvedUrl: options.resolvedUrl ?? options.snapshot?.finalUrl ?? null,
    productUrl: options.productUrl ?? link.canonicalUrl,
    asin: options.asin ?? link.asin,
    title: options.title ?? options.snapshot?.productTitle ?? null,
    imageUrl: options.snapshot?.heroImageUrl ?? null,
    titleSource: options.titleSource ?? null,
    brand: unknownField<string>("Brand not extracted."),
    model: unknownField<string>("Model/SKU not extracted."),
    availability: options.availability ?? emptyAvailability(),
    gpu: emptyGpu(),
    cpu: emptyCpu(),
    memory: emptyMemory(),
    storage: unknownField<string>("Storage not extracted."),
    display: unknownField<string>("Display not extracted."),
    weight: unknownField<string>("Weight not extracted."),
    price: options.price ?? emptyPrice(finishedAt),
    sources: [],
    extraction: {
      status,
      startedAt,
      finishedAt,
      durationMs: options.durationMs ?? 0,
      attempts: options.attempts ?? 0,
      httpStatus: options.httpStatus ?? options.snapshot?.httpStatus ?? null,
      requestedUrl: link.canonicalUrl,
      finalUrl: options.resolvedUrl ?? options.snapshot?.finalUrl ?? null,
      errors: options.errors ?? [],
      warnings: options.warnings ?? [],
      missingFields: options.missingFields ?? [],
    },
  };
}

function makeBlockedRecord(
  link: NormalizedLink,
  startedAt: string,
  code: string,
  message: string,
  snapshot: PageSnapshot | null,
  nav: NavigationResult | null,
): ProductRecord {
  return baseRecord(link, startedAt, "blocked", {
    title: snapshot?.productTitle ?? null,
    asin: link.asin,
    productUrl: link.canonicalUrl,
    resolvedUrl: snapshot?.finalUrl ?? nav?.finalUrl ?? null,
    httpStatus: nav?.status ?? snapshot?.httpStatus ?? null,
    attempts: nav?.attempts ?? 0,
    errors: [{ code, message }],
    warnings: [
      {
        code: "access_not_bypassed",
        message:
          "Amazon access restrictions were encountered. The script did not attempt to bypass CAPTCHA, authentication, or anti-bot controls.",
      },
    ],
    snapshot,
  });
}

function makeUnavailableRecord(
  link: NormalizedLink,
  startedAt: string,
  message: string,
  snapshot: PageSnapshot | null,
  nav: NavigationResult | null,
): ProductRecord {
  return baseRecord(link, startedAt, "unavailable", {
    title: snapshot?.productTitle ?? null,
    asin: link.asin,
    productUrl: link.canonicalUrl,
    resolvedUrl: snapshot?.finalUrl ?? nav?.finalUrl ?? null,
    httpStatus: nav?.status ?? snapshot?.httpStatus ?? null,
    attempts: nav?.attempts ?? 0,
    errors: [{ code: "product_unavailable", message }],
    availability: {
      value: "unavailable",
      rawText: message,
      source: null,
      verification: "unverified",
    },
    snapshot,
  });
}

function makeSkippedRecord(
  link: NormalizedLink,
  startedAt: string,
  code: string,
  message: string,
): ProductRecord {
  return baseRecord(link, startedAt, "skipped", {
    warnings: [{ code, message }],
    attempts: 0,
  });
}

function pruneStaleWarnings(
  warnings: Issue[],
  product: ReturnType<typeof extractAmazonProduct>["product"],
): Issue[] {
  return warnings.filter((warning) => {
    switch (warning.code) {
      case "cpu_model_missing":
        return product.cpu.model.value === null;
      case "cpu_power_missing":
        return (
          product.cpu.baseTdpW.value === null &&
          product.cpu.maxTurboPowerW.value === null &&
          product.cpu.configurableTdpW.value === null
        );
      case "gpu_vram_missing":
        return product.gpu.type === "discrete" && product.gpu.vramGb.value === null;
      case "gpu_power_missing":
        return (
          product.gpu.type === "discrete" &&
          product.gpu.baseTgpW.value === null &&
          product.gpu.maxGraphicsPowerW.value === null
        );
      case "ram_capacity_missing":
        return product.memory.installedGb.value === null;
      case "ram_type_missing":
        return product.memory.type.value === null;
      case "ram_upgradeability_missing":
        return product.memory.upgradeability.value === null;
      case "availability_missing":
        return product.availability.value === "unknown";
      default:
        return true;
    }
  });
}

function missingFieldsFor(product: ReturnType<typeof extractAmazonProduct>["product"]): string[] {
  const missing: string[] = [];
  if (product.brand.value === null) missing.push("brand");
  if (product.model.value === null) missing.push("model");
  if (product.gpu.model.value === null) missing.push("gpu.model");
  if (product.gpu.type === "discrete") {
    if (product.gpu.vramGb.value === null) missing.push("gpu.vramGb");
    if (
      product.gpu.baseTgpW.value === null &&
      product.gpu.maxGraphicsPowerW.value === null
    ) {
      missing.push("gpu.power");
    }
  }
  if (product.cpu.model.value === null) missing.push("cpu.model");
  if (
    product.cpu.baseTdpW.value === null &&
    product.cpu.maxTurboPowerW.value === null &&
    product.cpu.configurableTdpW.value === null
  ) {
    missing.push("cpu.power");
  }
  if (product.memory.installedGb.value === null) missing.push("memory.installedGb");
  if (product.memory.type.value === null) missing.push("memory.type");
  if (product.memory.upgradeability.value === null) {
    missing.push("memory.upgradeability");
  }
  if (product.price.listedPrice === null) missing.push("price.listedPrice");
  if (product.availability.value === "unknown") missing.push("availability");
  if (product.title === null) missing.push("title");
  if (product.asin === null) missing.push("asin");
  return missing;
}

function sourcesFor(product: ReturnType<typeof extractAmazonProduct>["product"]): SourceRef[] {
  const fields: Array<SpecField<unknown> | null | undefined> = [
    product.brand,
    product.model,
    product.gpu.model,
    product.gpu.vramGb,
    product.gpu.baseTgpW,
    product.gpu.maxGraphicsPowerW,
    product.gpu.dynamicBoostW,
    product.cpu.model,
    product.cpu.baseTdpW,
    product.cpu.maxTurboPowerW,
    product.cpu.configurableTdpW,
    product.memory.installedGb,
    product.memory.type,
    product.memory.speedMhz,
    product.memory.upgradeability,
    product.storage,
    product.display,
    product.weight,
  ];
  const sources: SourceRef[] = [];
  if (product.titleSource) sources.push(product.titleSource);
  for (const field of fields) {
    if (field?.source) sources.push(field.source);
  }
  if (product.price.source) sources.push(product.price.source);
  if (product.availability.source) sources.push(product.availability.source);

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.type}|${source.url}|${source.section ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function determineStatus(
  product: ReturnType<typeof extractAmazonProduct>["product"],
  missingFields: string[],
  forcePartial: boolean,
  errors: Issue[],
): ExtractionStatus {
  if (errors.length > 0) return "failed";
  if (product.title === null && product.asin === null) return "failed";
  if (
    product.title === null ||
    product.asin === null ||
    product.price.listedPrice === null ||
    (product.gpu.model.value === null && product.cpu.model.value === null)
  ) {
    return "partial";
  }
  if (forcePartial || missingFields.length > 0) return "partial";
  return "success";
}

async function saveDebugArtifacts(
  page: Page,
  link: NormalizedLink,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  if (!config.debug) return;
  try {
    const directory = join(config.outputDir, "debug");
    await mkdir(directory, { recursive: true });
    const safe = (link.asin ?? "unknown").replace(/[^a-z0-9_-]/gi, "_");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = join(directory, `${safe}-${stamp}`);
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => undefined);
    const html = await page.content().catch(() => "");
    if (html) await writeFile(`${base}.html`, html, "utf8");
    logger.warn("Debug artifacts saved", base);
  } catch (error) {
    logger.warn("Could not save debug artifacts", describeError(error));
  }
}

async function processProduct(
  page: Page,
  link: NormalizedLink,
  index: number,
  total: number,
  run: RunContext,
): Promise<ProductRecord> {
  const { config, logger, provider, robots } = run;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  if (!robots.allowed(link.canonicalUrl)) {
    logger.warn(`[${index}/${total}] Blocked by robots.txt`, link.asin ?? link.input);
    return makeBlockedRecord(
      link,
      startedAt,
      "blocked_by_robots",
      "The canonical product URL is disallowed by Amazon India's robots.txt rules.",
      null,
      null,
    );
  }

  let nav: NavigationResult | null = null;
  let snapshot: PageSnapshot | null = null;

  try {
    logger.info(`[${index}/${total}] Fetching`, link.asin ?? link.canonicalUrl);
    nav = await gotoWithRetry(page, link.canonicalUrl, config, logger);

    if (nav.blocked) {
      logger.warn(`[${index}/${total}] Blocked`, nav.blockedReason ?? "access restriction");
      await saveDebugArtifacts(page, link, config, logger);
      return makeBlockedRecord(
        link,
        startedAt,
        nav.blockedReason ?? "access_blocked",
        `Amazon did not allow access: ${nav.blockedReason ?? "unknown restriction"}.`,
        null,
        nav,
      );
    }

    if (nav.unavailable) {
      logger.warn(`[${index}/${total}] Unavailable`, link.asin ?? link.input);
      return makeUnavailableRecord(
        link,
        startedAt,
        "Amazon returned a 404 or page-not-found response.",
        null,
        nav,
      );
    }

    snapshot = await captureSnapshot(page, link.canonicalUrl, nav.status);

    const challengeReason =
      snapshot.signals.captcha || snapshot.signals.robotCheck
        ? "captcha_or_robot_check"
        : snapshot.signals.signIn
          ? "sign_in_required"
          : null;

    if (challengeReason) {
      const solved = await waitForManualChallenge(
        page,
        config,
        logger,
        challengeReason,
        link.canonicalUrl,
      );
      if (solved) {
        snapshot = await captureSnapshot(page, link.canonicalUrl, nav.status);
      }

      if (
        snapshot.signals.captcha ||
        snapshot.signals.robotCheck ||
        snapshot.signals.signIn
      ) {
        logger.warn(
          `[${index}/${total}] Access restriction remains`,
          "not bypassing",
        );
        await saveDebugArtifacts(page, link, config, logger);
        return makeBlockedRecord(
          link,
          startedAt,
          challengeReason,
          challengeReason === "sign_in_required"
            ? "Amazon required sign-in and the challenge was not completed. The script does not bypass authentication."
            : "Amazon presented a CAPTCHA or robot check and it was not completed. The script does not bypass it.",
          snapshot,
          nav,
        );
      }
    }

    if (snapshot.signals.notFound && !snapshot.productTitle) {
      return makeUnavailableRecord(
        link,
        startedAt,
        "Amazon returned a page-not-found response.",
        snapshot,
        nav,
      );
    }

    if (!snapshot.productTitle && snapshot.asinInputs.length === 0) {
      errors.push({
        code: "product_page_not_recognized",
        message:
          "The page did not contain a recognizable product title or ASIN. It may be an interstitial, a changed layout, or a blocked page.",
      });
      await saveDebugArtifacts(page, link, config, logger);
    }

    const extracted = extractAmazonProduct(snapshot);
    const product = extracted.product;

    let mergedProduct = product;
    const resolvedManufacturer = provider.find(
      product.asin,
      product.title,
      product.model.value,
    );
    if (resolvedManufacturer) {
      mergedProduct = applyManufacturerSpecs(
        product,
        resolvedManufacturer,
        provider,
        extracted.context,
      );
    }
    warnings.push(
      ...pruneStaleWarnings(extracted.context.warnings, mergedProduct),
    );

    if (
      mergedProduct.asin &&
      link.asin &&
      mergedProduct.asin.toUpperCase() !== link.asin.toUpperCase()
    ) {
      warnings.push({
        code: "resolved_different_asin",
        message: "Amazon resolved the URL to a different ASIN than the input URL.",
        detail: `input=${link.asin}; resolved=${mergedProduct.asin}`,
      });
    }

    if (mergedProduct.availability.value === "out_of_stock") {
      warnings.push({
        code: "out_of_stock",
        message: "The listing reports the product as out of stock/unavailable.",
        detail: mergedProduct.availability.rawText ?? undefined,
      });
    }

    if (!nav.ok) {
      warnings.push({
        code: "navigation_error_partial",
        message:
          "Navigation did not complete cleanly, but a partial product DOM was extracted.",
        detail: nav.error ?? undefined,
      });
    }

    const missingFields = missingFieldsFor(mergedProduct);
    const status = determineStatus(
      mergedProduct,
      missingFields,
      !nav.ok,
      errors,
    );

    if (status === "failed") {
      await saveDebugArtifacts(page, link, config, logger);
    }

    const canonical =
      canonicalProductUrl(mergedProduct.canonicalUrl ?? "") ??
      canonicalProductUrl(snapshot.canonicalUrl ?? "") ??
      link.canonicalUrl;

    const finishedAt = new Date().toISOString();
    const record: ProductRecord = {
      id: mergedProduct.asin ?? link.asin ?? canonical,
      inputUrl: link.input,
      requestedUrl: link.canonicalUrl,
      resolvedUrl: snapshot.finalUrl,
      productUrl: canonical,
      asin: mergedProduct.asin ?? link.asin,
      title: mergedProduct.title,
      imageUrl: mergedProduct.imageUrl,
      titleSource: mergedProduct.titleSource,
      brand: mergedProduct.brand,
      model: mergedProduct.model,
      availability: mergedProduct.availability,
      gpu: mergedProduct.gpu,
      cpu: mergedProduct.cpu,
      memory: mergedProduct.memory,
      storage: mergedProduct.storage,
      display: mergedProduct.display,
      weight: mergedProduct.weight,
      price: mergedProduct.price,
      sources: sourcesFor(mergedProduct),
      extraction: {
        status,
        startedAt,
        finishedAt,
        durationMs: Date.now() - started,
        attempts: nav.attempts,
        httpStatus: snapshot.httpStatus ?? nav.status,
        requestedUrl: link.canonicalUrl,
        finalUrl: snapshot.finalUrl,
        errors,
        warnings,
        missingFields,
      },
    };

    if (status === "success") {
      logger.info(
        `[${index}/${total}] Extracted`,
        `${mergedProduct.price.listedPrice ? `₹${mergedProduct.price.listedPrice.amount}` : "price unknown"} · ${mergedProduct.gpu.model.value ?? "GPU unknown"}`,
      );
    } else if (status === "partial") {
      logger.warn(
        `[${index}/${total}] Partial extraction`,
        `${missingFields.length} missing field(s)`,
      );
    } else {
      logger.error(`[${index}/${total}] Extraction failed`, errors[0]?.message);
    }
    return record;
  } catch (error) {
    const message = describeError(error);
    errors.push({ code: "extraction_failed", message });
    logger.error(`[${index}/${total}] Failed`, message);
    await saveDebugArtifacts(page, link, config, logger);
    return baseRecord(link, startedAt, "failed", {
      title: snapshot?.productTitle ?? null,
      asin: link.asin,
      productUrl: link.canonicalUrl,
      resolvedUrl: snapshot?.finalUrl ?? nav?.finalUrl ?? null,
      httpStatus: snapshot?.httpStatus ?? nav?.status ?? null,
      attempts: nav?.attempts ?? 0,
      errors,
      warnings,
      snapshot,
      durationMs: Date.now() - started,
    });
  }
}

function lowestPrice(
  products: ProductRecord[],
  getter: (product: ProductRecord) => number | null,
): { asin: string | null; title: string | null; amount: number } | null {
  let best: { asin: string | null; title: string | null; amount: number } | null = null;
  for (const product of products) {
    if (product.extraction.status !== "success" && product.extraction.status !== "partial") {
      continue;
    }
    const amount = getter(product);
    if (amount === null) continue;
    if (best === null || amount < best.amount) {
      best = {
        asin: product.asin,
        title: product.title,
        amount,
      };
    }
  }
  return best;
}

export function buildReport(
  products: ProductRecord[],
  input: InputSummary,
  config: AppConfig,
  runId: string,
  startedAt: string,
): Report {
  const counts = {
    success: 0,
    partial: 0,
    failed: 0,
    blocked: 0,
    unavailable: 0,
    skipped: 0,
  };
  for (const product of products) counts[product.extraction.status] += 1;

  return {
    schemaVersion: 1,
    run: {
      id: runId,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - new Date(startedAt).getTime()),
      config: publicConfig(config),
      input,
    },
    summary: {
      total: products.length,
      ...counts,
      lowestListedPrice: lowestPrice(
        products,
        (product) => product.price.listedPrice?.amount ?? null,
      ),
      lowestBestEffectivePrice: lowestPrice(
        products,
        (product) => product.price.bestEffectivePrice?.amount ?? null,
      ),
      lowestConditionalPrice: lowestPrice(
        products,
        (product) => product.price.conditionalBestPrice?.amount ?? null,
      ),
      lowestEmiConditionalPrice: lowestPrice(
        products,
        (product) => product.price.emiConditionalBestPrice?.amount ?? null,
      ),
    },
    products,
  };
}

function randomBetween(min: number, max: number): number {
  if (max <= min) return min;
  return Math.floor(min + Math.random() * (max - min + 1));
}

export async function runCompare(
  config: AppConfig,
  logger: Logger,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const inputFile = relative(config.cwd, config.linksFile) || config.linksFile;

  let content: string;
  try {
    content = await readFile(config.linksFile, "utf8");
  } catch (error) {
    throw new Error(
      `Could not read links file ${config.linksFile}: ${describeError(error)}`,
    );
  }

  const parsed = parseLinksFile(content, config.maxProducts, inputFile);
  const links =
    config.limit !== null ? parsed.links.slice(0, config.limit) : parsed.links;
  const inputSummary = { ...parsed.summary, validUrls: links.length };

  // A checkpoint from an earlier interrupted run should not be mistaken for
  // the current run's partial output.
  await removePartialReport(config.outputDir);

  for (const issue of parsed.summary.issues) {
    if (issue.code === "truncated") {
      logger.warn(issue.message);
    } else {
      logger.warn(`Input line ${issue.line}: ${issue.message}`, issue.value);
    }
  }

  logger.info(
    "Input parsed",
    `${links.length} unique product(s)${parsed.summary.duplicates ? `, ${parsed.summary.duplicates} duplicate(s)` : ""}${parsed.summary.invalid ? `, ${parsed.summary.invalid} invalid line(s)` : ""}`,
  );

  if (links.length === 0) {
    logger.warn("No valid Amazon India product URLs found; generating an empty report.");
    const report = buildReport([], inputSummary, config, runId, startedAt);
    const paths = await writeReportOutputs(report, config.outputDir, logger);
    return { report, paths };
  }

  if (config.limit !== null && parsed.links.length > config.limit) {
    logger.info("Limit applied", `processing ${config.limit} of ${parsed.links.length}`);
  }

  const provider = ManufacturerProvider.load(
    config.manufacturerSpecsFile,
    config.manufacturerLookup,
    logger,
  );
  const robots = await loadRobotsRules(config.respectRobots, logger);

  const records: Array<ProductRecord | undefined> = new Array(links.length);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let consecutiveBlocks = 0;
  let stop = false;
  let stopReason: "circuit_breaker" | "interrupted" | null = null;
  let interrupted = false;
  let nextIndex = 0;
  let checkpointGate: Promise<void> = Promise.resolve();

  const onSigint = (): void => {
    if (interrupted) {
      logger.warn("Second interrupt received; exiting immediately.");
      process.exit(130);
    }
    interrupted = true;
    stop = true;
    stopReason = "interrupted";
    logger.warn(
      "Interrupt received; finishing the current product and writing partial results. Press Ctrl+C again to exit immediately.",
    );
  };
  process.on("SIGINT", onSigint);

  const runContext: RunContext = {
    config,
    logger,
    runId,
    startedAt,
    inputSummary,
    provider,
    robots,
  };

  let throttleGate: Promise<void> = Promise.resolve();
  let requestCount = 0;
  const throttle = (): Promise<void> => {
    const turn = throttleGate.then(async () => {
      if (requestCount > 0) {
        await sleep(randomBetween(config.minDelayMs, config.maxDelayMs));
      }
      requestCount += 1;
    });
    throttleGate = turn.catch(() => undefined);
    return turn;
  };

  const checkpoint = (): Promise<void> => {
    const current = records.filter((record): record is ProductRecord => Boolean(record));
    checkpointGate = checkpointGate
      .then(() =>
        writePartialReport(
          buildReport(current, inputSummary, config, runId, startedAt),
          config.outputDir,
        ),
      )
      .catch((error) => {
        logger.warn("Could not write partial checkpoint", describeError(error));
      });
    return checkpointGate;
  };

  try {
    browser = await launchBrowser(config, logger);
    context = await createContext(browser, config);

    const worker = async (workerId: number): Promise<void> => {
      let page: Page | null = null;
      try {
        page = await createWorkerPage(context as BrowserContext, config);
        while (!stop) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= links.length) break;

          const link = links[index];
          if (!link) break;

          await throttle();
          if (stop) break;

          logger.debug(`Worker ${workerId + 1} starting product ${index + 1}`);
          const record = await processProduct(
            page,
            link,
            index + 1,
            links.length,
            runContext,
          );
          records[index] = record;

          if (record.extraction.status === "blocked") {
            consecutiveBlocks += 1;
            if (consecutiveBlocks >= config.blockThreshold) {
              stop = true;
              stopReason = "circuit_breaker";
              logger.warn(
                "Stopping run after repeated access restrictions",
                `${consecutiveBlocks} blocked product(s); remaining products will be marked skipped.`,
              );
            }
          } else {
            consecutiveBlocks = 0;
          }

          await checkpoint();
        }
      } catch (error) {
        logger.error(`Worker ${workerId + 1} failed`, describeError(error));
      } finally {
        await closeQuietly(page);
      }
    };

    const workerCount = Math.min(config.concurrency, links.length);
    const results = await Promise.allSettled(
      Array.from({ length: workerCount }, (_, workerId) => worker(workerId)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        logger.error("Worker rejected unexpectedly", describeError(result.reason));
      }
    }
  } catch (error) {
    const message = describeError(error);
    logger.error("Browser setup failed", message);
    const allProducts = links.map(
      (link, index) =>
        records[index] ??
        baseRecord(link, startedAt, "failed", {
          errors: [{ code: "browser_setup_failed", message }],
          warnings: [],
        }),
    );
    const report = buildReport(allProducts, inputSummary, config, runId, startedAt);
    const paths = await writeReportOutputs(report, config.outputDir, logger);
    return { report, paths, fatalError: message };
  } finally {
    process.off("SIGINT", onSigint);
    await closeQuietly(context);
    await closeQuietly(browser);
  }

  const skipCode =
    stopReason === "circuit_breaker"
      ? "skipped_after_repeated_blocks"
      : stopReason === "interrupted"
        ? "skipped_after_interrupt"
        : "skipped_not_processed";
  const skipMessage =
    stopReason === "circuit_breaker"
      ? "Skipped after repeated Amazon access restrictions; the run stopped to avoid further requests."
      : stopReason === "interrupted"
        ? "Skipped because the run was interrupted."
        : "Not processed because a worker stopped before reaching this product.";

  const finalProducts = links.map(
    (link, index) =>
      records[index] ??
      makeSkippedRecord(link, startedAt, skipCode, skipMessage),
  );

  for (const product of finalProducts) {
    if (product.extraction.status === "skipped") {
      logger.warn("Skipped", `${product.asin ?? product.inputUrl}: ${skipMessage}`);
    }
  }

  const report = buildReport(finalProducts, inputSummary, config, runId, startedAt);
  const paths = await writeReportOutputs(report, config.outputDir, logger);
  await removePartialReport(config.outputDir);

  logger.info(
    "Run complete",
    `${report.summary.success} complete, ${report.summary.partial} partial, ${report.summary.failed} failed, ${report.summary.blocked} blocked, ${report.summary.unavailable} unavailable, ${report.summary.skipped} skipped`,
  );
  return { report, paths };
}
