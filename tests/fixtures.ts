import type {
  PageSnapshot,
  PriceSnapshot,
  ProductRecord,
  Report,
  SourceRef,
} from "../src/types.js";
import { fieldFrom, unknownField } from "../src/normalize/sources.js";

const baseSource: SourceRef = {
  type: "amazon_technical_specs",
  url: "https://www.amazon.in/dp/B0TEST0001",
  section: "technical specifications",
  retrievedAt: "2026-11-02T00:00:00.000Z",
};

type SnapshotOverrides = Omit<Partial<PageSnapshot>, "price"> & {
  price?: Partial<PriceSnapshot>;
};

export function makeSnapshot(overrides: SnapshotOverrides = {}): PageSnapshot {
  const defaultPrice: PriceSnapshot = {
    coreTexts: [],
    priceTexts: [],
    mrpTexts: [],
    couponTexts: [],
    bankOfferTexts: [],
    bankOfferDetails: [],
    otherOfferTexts: [],
    buyboxText: null,
  };
  const { price, ...rest } = overrides;
  return {
    requestedUrl: "https://www.amazon.in/dp/B0TEST0001",
    finalUrl: "https://www.amazon.in/dp/B0TEST0001",
    canonicalUrl: "https://www.amazon.in/dp/B0TEST0001",
    httpStatus: 200,
    documentTitle: "Test Laptop",
    lang: "en-IN",
    jsonLdTexts: [],
    asinInputs: ["B0TEST0001"],
    productTitle: "Test Laptop",
    heroImageUrl: "https://m.media-amazon.com/images/I/test.jpg",
    byline: "Visit the Test Store",
    availabilityText: "In stock",
    bulletTexts: [],
    descriptionText: null,
    specRows: [],
    signals: {
      captcha: false,
      signIn: false,
      notFound: false,
      robotCheck: false,
      unavailable: false,
    },
    bodyTextSample: "",
    extractedAt: "2026-11-02T00:00:00.000Z",
    ...rest,
    price: { ...defaultPrice, ...(price ?? {}) },
  };
}

function field<T>(value: T, unit: string | null = null) {
  return fieldFrom({
    value,
    unit,
    source: baseSource,
    verification: "unverified",
  });
}

export function makeProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  const listed = { amount: 100000, currency: "INR" as const };
  return {
    id: "B0TEST0001",
    inputUrl: "https://www.amazon.in/dp/B0TEST0001?tag=test",
    requestedUrl: "https://www.amazon.in/dp/B0TEST0001",
    resolvedUrl: "https://www.amazon.in/dp/B0TEST0001",
    productUrl: "https://www.amazon.in/dp/B0TEST0001",
    asin: "B0TEST0001",
    title: "Test Laptop RTX 4060",
    imageUrl: "https://m.media-amazon.com/images/I/test.jpg",
    titleSource: baseSource,
    brand: field("Lenovo"),
    model: field("TestSKU-15"),
    availability: {
      value: "in_stock",
      rawText: "In stock",
      source: baseSource,
      verification: "unverified",
    },
    gpu: {
      model: field("NVIDIA GeForce RTX 4060 Laptop GPU"),
      type: "discrete",
      vramGb: field(8, "GB"),
      baseTgpW: field(115, "W"),
      maxGraphicsPowerW: unknownField<number>(),
      dynamicBoostW: unknownField<number>(),
      powerQualification: "Test qualification.",
    },
    cpu: {
      model: field("Intel Core i7-13620H"),
      baseTdpW: field(45, "W"),
      maxTurboPowerW: field(115, "W"),
      configurableTdpW: unknownField<{ min: number; max: number }>(),
      powerQualification: null,
    },
    memory: {
      installedGb: field(16, "GB"),
      type: field("DDR5"),
      speedMhz: field(4800, "MHz"),
      upgradeability: field("yes" as const),
      upgradeNotes: "Test upgrade note.",
    },
    storage: field("512GB SSD"),
    display: field('15.6" FHD 144Hz IPS'),
    weight: field("1.8 kg"),
    price: {
      currency: "INR",
      listedPrice: listed,
      mrp: { amount: 120000, currency: "INR" },
      offers: [],
      priceWithoutConditionalOffers: listed,
      bestEffectivePrice: listed,
      conditionalBestPrice: null,
      conditionalOfferId: null,
      emiConditionalBestPrice: null,
      emiConditionalOfferId: null,
      offerEligibility: [],
      calculationNotes: ["Test calculation note."],
      timestamp: "2026-11-02T00:00:00.000Z",
      source: baseSource,
      rawPriceTexts: [],
    },
    sources: [baseSource],
    extraction: {
      status: "success",
      startedAt: "2026-11-02T00:00:00.000Z",
      finishedAt: "2026-11-02T00:00:01.000Z",
      durationMs: 1000,
      attempts: 1,
      httpStatus: 200,
      requestedUrl: "https://www.amazon.in/dp/B0TEST0001",
      finalUrl: "https://www.amazon.in/dp/B0TEST0001",
      errors: [],
      warnings: [],
      missingFields: [],
    },
    ...overrides,
  };
}

export function makeReport(products: ProductRecord[] = [makeProduct()]): Report {
  return {
    schemaVersion: 1,
    run: {
      id: "run-test",
      startedAt: "2026-11-02T00:00:00.000Z",
      finishedAt: "2026-11-02T00:00:02.000Z",
      durationMs: 2000,
      config: {
        headless: true,
        concurrency: 1,
        minDelayMs: 4000,
        maxDelayMs: 8000,
        navTimeoutMs: 45000,
        navRetries: 2,
        maxProducts: 30,
        respectRobots: true,
        manufacturerLookup: true,
        browserChannel: null,
        manualChallengeWait: true,
      },
      input: {
        file: "data/laptop-links.txt",
        totalLines: 1,
        validUrls: products.length,
        duplicates: 0,
        invalid: 0,
        truncated: 0,
        issues: [],
      },
    },
    summary: {
      total: products.length,
      success: products.length,
      partial: 0,
      failed: 0,
      blocked: 0,
      unavailable: 0,
      skipped: 0,
      lowestListedPrice: {
        asin: "B0TEST0001",
        title: "Test Laptop",
        amount: 100000,
      },
      lowestBestEffectivePrice: {
        asin: "B0TEST0001",
        title: "Test Laptop",
        amount: 100000,
      },
      lowestConditionalPrice: null,
      lowestEmiConditionalPrice: null,
    },
    products,
  };
}
