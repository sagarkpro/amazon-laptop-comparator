export type VerificationStatus =
  | "verified"
  | "unverified"
  | "unknown"
  | "not_applicable";

export type SourceType =
  | "amazon_structured_data"
  | "amazon_technical_specs"
  | "amazon_listing_text"
  | "amazon_title"
  | "manufacturer_official"
  | "derived"
  | "unknown";

export interface SourceRef {
  type: SourceType;
  url: string;
  section: string | null;
  retrievedAt: string;
}

export interface SpecCandidate<T> {
  value: T | null;
  unit: string | null;
  source: SourceRef | null;
  verification: VerificationStatus;
  qualification: string | null;
  rawText: string | null;
}

/**
 * A specification value always carries its unit, source, and verification
 * state. A missing value is represented by value=null and verification=unknown.
 */
export interface SpecField<T> {
  value: T | null;
  unit: string | null;
  source: SourceRef | null;
  verification: VerificationStatus;
  qualification: string | null;
  rawText: string | null;
  candidates: SpecCandidate<T>[];
}

export type GpuType = "discrete" | "integrated" | "unknown";

export interface GpuSpec {
  model: SpecField<string>;
  type: GpuType;
  vramGb: SpecField<number>;
  /** Base TGP explicitly labelled as TGP. */
  baseTgpW: SpecField<number>;
  /** Explicit "maximum graphics power" / "up to" wattage. */
  maxGraphicsPowerW: SpecField<number>;
  /** Explicit Dynamic Boost wattage. */
  dynamicBoostW: SpecField<number>;
  powerQualification: string | null;
}

export interface TdpRange {
  min: number;
  max: number;
}

export interface CpuSpec {
  model: SpecField<string>;
  /** TDP / processor base power. */
  baseTdpW: SpecField<number>;
  /** Maximum turbo power. */
  maxTurboPowerW: SpecField<number>;
  /** Configurable TDP / cTDP range, when explicitly stated. */
  configurableTdpW: SpecField<TdpRange>;
  powerQualification: string | null;
}

export type Upgradeability = "yes" | "no" | "unknown";

export interface MemorySpec {
  installedGb: SpecField<number>;
  type: SpecField<string>;
  speedMhz: SpecField<number>;
  upgradeability: SpecField<Upgradeability>;
  upgradeNotes: string | null;
}

export type Availability =
  | "in_stock"
  | "limited_stock"
  | "out_of_stock"
  | "unavailable"
  | "unknown";

export interface AvailabilityInfo {
  value: Availability;
  rawText: string | null;
  source: SourceRef | null;
  verification: VerificationStatus;
}

export interface Money {
  amount: number;
  currency: "INR";
}

export type OfferType =
  | "coupon"
  | "bank_instant_discount"
  | "exchange"
  | "cashback"
  | "no_cost_emi"
  | "membership"
  | "other";

export interface OfferComponent {
  rawText: string;
  discount: number;
  minSpend: number | null;
}

export interface Offer {
  id: string;
  type: OfferType;
  rawText: string;
  /** Component offers when several explicitly stackable offers are aggregated. */
  components?: OfferComponent[];
  /** True when the benefit is applied at checkout / reduces the payable price. */
  instant: boolean;
  /** Payment mode this offer applies to. EMI prices are never treated as the overall lowest. */
  paymentMode?: "full" | "emi" | "unknown";
  requiresEligibility: boolean;
  eligibility: string | null;
  /** Only set when the discount is reliably calculable from explicit text. */
  discount: Money | null;
  discountKind: "flat" | "percent" | "unknown";
  percent: number | null;
  cap: Money | null;
  minSpend: Money | null;
  /** Cashback/reward value. Never deducted from the product price. */
  cashback: Money | null;
  stackable: "yes" | "no" | "unknown";
  applicable: boolean | null;
  appliedIn: "none" | "best_effective" | "conditional_best" | "emi_conditional";
  calculation: string | null;
}

export interface PriceInfo {
  currency: "INR";
  listedPrice: Money | null;
  mrp: Money | null;
  offers: Offer[];
  priceWithoutConditionalOffers: Money | null;
  bestEffectivePrice: Money | null;
  /** Lowest conditional price using full-payment (non-EMI) offers only. */
  conditionalBestPrice: Money | null;
  conditionalOfferId: string | null;
  /** EMI-only conditional price before processing fees/interest. Never the overall lowest. */
  emiConditionalBestPrice: Money | null;
  emiConditionalOfferId: string | null;
  offerEligibility: string[];
  calculationNotes: string[];
  timestamp: string;
  source: SourceRef | null;
  rawPriceTexts: string[];
}

export type ExtractionStatus =
  | "success"
  | "partial"
  | "failed"
  | "blocked"
  | "unavailable"
  | "skipped";

export interface Issue {
  code: string;
  message: string;
  detail?: string;
}

export interface ExtractionMeta {
  status: ExtractionStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  attempts: number;
  httpStatus: number | null;
  requestedUrl: string;
  finalUrl: string | null;
  errors: Issue[];
  warnings: Issue[];
  missingFields: string[];
}

export interface ProductRecord {
  id: string;
  inputUrl: string;
  requestedUrl: string;
  resolvedUrl: string | null;
  productUrl: string | null;
  asin: string | null;
  title: string | null;
  imageUrl: string | null;
  titleSource: SourceRef | null;
  brand: SpecField<string>;
  model: SpecField<string>;
  availability: AvailabilityInfo;
  gpu: GpuSpec;
  cpu: CpuSpec;
  memory: MemorySpec;
  storage: SpecField<string>;
  display: SpecField<string>;
  weight: SpecField<string>;
  price: PriceInfo;
  sources: SourceRef[];
  extraction: ExtractionMeta;
}

export interface InputIssue {
  line: number;
  value: string;
  code: string;
  message: string;
}

export interface InputSummary {
  file: string;
  totalLines: number;
  validUrls: number;
  duplicates: number;
  invalid: number;
  truncated: number;
  issues: InputIssue[];
}

export interface LowestPriceSummary {
  asin: string | null;
  title: string | null;
  amount: number;
}

export interface RunSummary {
  total: number;
  success: number;
  partial: number;
  failed: number;
  blocked: number;
  unavailable: number;
  skipped: number;
  lowestListedPrice: LowestPriceSummary | null;
  lowestBestEffectivePrice: LowestPriceSummary | null;
  lowestConditionalPrice: LowestPriceSummary | null;
  lowestEmiConditionalPrice: LowestPriceSummary | null;
}

export interface PublicConfig {
  headless: boolean;
  concurrency: number;
  minDelayMs: number;
  maxDelayMs: number;
  navTimeoutMs: number;
  navRetries: number;
  maxProducts: number;
  respectRobots: boolean;
  manufacturerLookup: boolean;
  browserChannel: string | null;
  manualChallengeWait: boolean;
}

export interface Report {
  schemaVersion: 1;
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    config: PublicConfig;
    input: InputSummary;
  };
  summary: RunSummary;
  products: ProductRecord[];
}

export interface SpecRow {
  label: string;
  value: string;
  section: string;
  sourceType: SourceType;
}

export interface PriceSnapshot {
  coreTexts: string[];
  priceTexts: string[];
  mrpTexts: string[];
  couponTexts: string[];
  bankOfferTexts: string[];
  bankOfferDetails: string[];
  otherOfferTexts: string[];
  buyboxText: string | null;
}

export interface PageSignals {
  captcha: boolean;
  signIn: boolean;
  notFound: boolean;
  robotCheck: boolean;
  unavailable: boolean;
}

export interface PageSnapshot {
  requestedUrl: string;
  finalUrl: string;
  canonicalUrl: string | null;
  httpStatus: number | null;
  documentTitle: string | null;
  lang: string | null;
  jsonLdTexts: string[];
  asinInputs: string[];
  productTitle: string | null;
  heroImageUrl: string | null;
  byline: string | null;
  availabilityText: string | null;
  bulletTexts: string[];
  descriptionText: string | null;
  specRows: SpecRow[];
  price: PriceSnapshot;
  signals: PageSignals;
  bodyTextSample: string;
  extractedAt: string;
}

export interface ExtractedProduct {
  title: string | null;
  imageUrl: string | null;
  titleSource: SourceRef | null;
  asin: string | null;
  canonicalUrl: string | null;
  brand: SpecField<string>;
  model: SpecField<string>;
  availability: AvailabilityInfo;
  gpu: GpuSpec;
  cpu: CpuSpec;
  memory: MemorySpec;
  storage: SpecField<string>;
  display: SpecField<string>;
  weight: SpecField<string>;
  price: PriceInfo;
}
