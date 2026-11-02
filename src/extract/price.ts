import type {
  Money,
  Offer,
  OfferComponent,
  OfferType,
  PageSnapshot,
  PriceInfo,
  SourceRef,
} from "../types.js";
import type { ExtractionContext } from "./context.js";
import { findJsonLdProduct } from "./product.js";
import { cleanText, uniqueStrings } from "../normalize/text.js";
import { formatInr, parseMoney, parsePercent, roundMoney } from "../normalize/numbers.js";

interface PriceMention {
  amount: number;
  raw: string;
  start: number;
  end: number;
  isMrp: boolean;
  isEmi: boolean;
}

interface PriceCandidate {
  money: Money;
  rawText: string;
  source: SourceRef;
}

interface OfferEconomics {
  percent: number | null;
  flat: Money | null;
  cap: Money | null;
  minSpend: Money | null;
  discount: Money | null;
  cashback: Money | null;
  discountKind: "flat" | "percent" | "unknown";
  stackable: "yes" | "no" | "unknown";
}

function moneyMentions(text: string): PriceMention[] {
  const mentions: PriceMention[] = [];
  const regex = /(?:₹|Rs\.?\s*|INR\s*)([\d,]+(?:\.\d{1,2})?)/gi;
  for (const match of text.matchAll(regex)) {
    const raw = match[0];
    const amountText = match[1];
    if (!amountText || match.index === undefined) continue;
    const amount = Number(amountText.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 100 || amount > 10_000_000) continue;
    const start = match.index;
    const end = start + raw.length;
    const before = text.slice(Math.max(0, start - 34), start).toLowerCase();
    const after = text.slice(end, end + 26).toLowerCase();
    mentions.push({
      amount,
      raw,
      start,
      end,
      isMrp: /m\.?\s*r\.?\s*p\.?|maximum\s+retail|list\s+price|\bwas\b/.test(before),
      isEmi: /\bemi\b|per\s+month|monthly/.test(before) || /\/\s*month|per\s+month|monthly/.test(after),
    });
  }
  return mentions;
}

function toMoney(amount: number): Money {
  return { amount: roundMoney(amount), currency: "INR" };
}

function domPriceCandidates(snapshot: PageSnapshot): {
  listed: PriceCandidate[];
  mrp: PriceCandidate[];
} {
  const listed: PriceCandidate[] = [];
  const mrp: PriceCandidate[] = [];
  const source = (section: string): SourceRef => ({
    type: "amazon_listing_text",
    url: snapshot.canonicalUrl ?? snapshot.finalUrl,
    section,
    retrievedAt: snapshot.extractedAt,
  });

  for (const text of snapshot.price.priceTexts) {
    for (const mention of moneyMentions(text)) {
      if (mention.isMrp || mention.isEmi) continue;
      listed.push({
        money: toMoney(mention.amount),
        rawText: text,
        source: source("#corePriceDisplay_desktop_feature_div"),
      });
    }
  }
  if (listed.length === 0) {
    for (const text of snapshot.price.coreTexts) {
      for (const mention of moneyMentions(text)) {
        if (mention.isMrp || mention.isEmi) continue;
        listed.push({
          money: toMoney(mention.amount),
          rawText: text,
          source: source("#corePriceDisplay_desktop_feature_div"),
        });
      }
    }
  }

  for (const text of snapshot.price.mrpTexts) {
    for (const mention of moneyMentions(text)) {
      if (mention.isEmi) continue;
      mrp.push({
        money: toMoney(mention.amount),
        rawText: text,
        source: source(".basisPrice / list price"),
      });
    }
  }
  for (const text of snapshot.price.coreTexts) {
    for (const mention of moneyMentions(text)) {
      if (!mention.isMrp || mention.isEmi) continue;
      mrp.push({
        money: toMoney(mention.amount),
        rawText: text,
        source: source(".basisPrice / M.R.P."),
      });
    }
  }

  // A struck-through MRP can appear inside an .a-price container. Exclude
  // values that are clearly the MRP when a separate selling price exists.
  const mrpAmounts = new Set(mrp.map((candidate) => candidate.money.amount));
  const withoutMrp = listed.filter(
    (candidate) => !mrpAmounts.has(candidate.money.amount),
  );
  return { listed: withoutMrp.length > 0 ? withoutMrp : listed, mrp };
}

function firstJsonLdOffer(snapshot: PageSnapshot): Record<string, unknown> | null {
  const product = findJsonLdProduct(snapshot);
  const offers = product?.offers;
  if (Array.isArray(offers)) {
    return (
      (offers.find(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      ) as Record<string, unknown> | undefined) ?? null
    );
  }
  if (offers && typeof offers === "object") {
    return offers as Record<string, unknown>;
  }
  return null;
}

function jsonLdPrice(snapshot: PageSnapshot): Money | null {
  const offer = firstJsonLdOffer(snapshot);
  if (!offer) return null;
  const priceRaw = offer.price;
  const price =
    typeof priceRaw === "number"
      ? priceRaw
      : typeof priceRaw === "string"
        ? Number(priceRaw.replace(/,/g, ""))
        : null;
  if (price === null || !Number.isFinite(price) || price < 100 || price > 10_000_000) {
    return null;
  }
  const currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency.toUpperCase() : null;
  if (currency && currency !== "INR") return null;
  return toMoney(price);
}

function parseMinSpend(text: string): Money | null {
  const patterns = [
    /(?:minimum|min\.?)\s*(?:purchase|order|transaction|cart)?\s*(?:value|of|above)?[^\d₹]{0,25}(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:on\s+orders?\s+(?:above|of)|on\s+purchase\s+of|orders?\s+above)\s*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)\s*(?:and\s+above|minimum)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const amount = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(amount) && amount > 0) return toMoney(amount);
    }
  }
  return null;
}

function parseCap(text: string): Money | null {
  const match = text.match(
    /(?:up\s+to|upto|max(?:imum)?(?:\s+of)?)\s*(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (!match?.[1]) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? toMoney(amount) : null;
}

function parseFlatDiscount(text: string): Money | null {
  const mentions = moneyMentions(text);
  for (const mention of mentions) {
    const before = text.slice(Math.max(0, mention.start - 36), mention.start).toLowerCase();
    const after = text.slice(mention.end, mention.end + 36).toLowerCase();
    if (
      /minimum|min\.|purchase\s+value|orders?\s+above|and\s+above/.test(before) ||
      /up\s+to|upto/.test(before)
    ) {
      continue;
    }
    if (
      /(?:save|saving|discount|off|coupon|instant|value|flat)\b/.test(after) ||
      /(?:save|saving|discount|off|coupon|flat)\b/.test(before)
    ) {
      return toMoney(mention.amount);
    }
  }
  if (mentions.length === 1 && parsePercent(text) === null && parseCap(text) === null) {
    const only = mentions[0];
    if (only) return toMoney(only.amount);
  }
  return null;
}

function parseStackable(text: string): "yes" | "no" | "unknown" {
  if (/(?:cannot|can't|not)\s+(?:be\s+)?(?:clubbed|combined|stacked)/i.test(text)) {
    return "no";
  }
  if (/(?:can\s+be\s+clubbed|combinable|stackable|can\s+be\s+combined)/i.test(text)) {
    return "yes";
  }
  return "unknown";
}

function parseOfferEconomics(text: string, listed: Money | null): OfferEconomics {
  const percent = parsePercent(text);
  const cap = parseCap(text);
  const minSpend = parseMinSpend(text);
  const flat = parseFlatDiscount(text);
  const stackable = parseStackable(text);

  let discount: Money | null = null;
  let discountKind: "flat" | "percent" | "unknown" = "unknown";
  let cashback: Money | null = null;

  if (percent !== null) {
    discountKind = "percent";
    if (listed && cap) {
      discount = toMoney(Math.min((listed.amount * percent) / 100, cap.amount));
    }
  } else if (flat) {
    discountKind = "flat";
    discount = listed
      ? toMoney(Math.min(flat.amount, listed.amount))
      : flat;
  }

  if (/\bcashback\b|\breward\s+points?\b/i.test(text)) {
    if (percent !== null && listed) {
      cashback = toMoney(
        cap ? Math.min((listed.amount * percent) / 100, cap.amount) : (listed.amount * percent) / 100,
      );
    } else if (flat) {
      cashback = flat;
    } else if (cap) {
      cashback = cap;
    }
  }

  return {
    percent,
    flat,
    cap,
    minSpend,
    discount,
    cashback,
    discountKind,
    stackable,
  };
}

function issuer(text: string): string | null {
  const known = [
    "SBI",
    "HDFC",
    "ICICI",
    "Axis",
    "Kotak",
    "IndusInd",
    "Federal",
    "RBL",
    "IDBI",
    "Yes Bank",
    "HSBC",
    "Standard Chartered",
    "American Express",
    "Amex",
    "OneCard",
    "Bank of Baroda",
    "AU Bank",
    "DBS",
    "Citibank",
    "Citi",
  ];
  const match = known.find((name) => new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
  return match ?? null;
}

interface BankComponent {
  rawText: string;
  issuer: string;
  cardType: string;
  mode: "non_emi" | "emi";
  requiredMonths: number | null;
  discount: number;
  minSpend: Money | null;
  additional: boolean;
  percent: number | null;
  cap: Money | null;
}

interface BankStack {
  total: number;
  included: BankComponent[];
  tier: number | null;
}

function parseBankComponent(text: string, listed: Money | null): BankComponent | null {
  const cleaned = cleanText(text)
    .replace(/\s*See details.*$/i, "")
    .replace(/\s*Shop items.*$/i, "")
    .trim();
  if (!cleaned) return null;

  const issuerName = issuer(cleaned) ?? "Bank";
  const hasCreditCard = /credit\s+card/i.test(cleaned);
  const hasDebitCard = /debit\s+card/i.test(cleaned);
  const cardType =
    hasCreditCard && hasDebitCard
      ? "Credit/Debit Card"
      : hasDebitCard
        ? "Debit Card"
        : hasCreditCard
          ? "Credit Card"
          : "Card";
  const isNonEmi = /non[-\s]?emi/i.test(cleaned);
  const isEmi = /\bemi\b/i.test(cleaned) && !isNonEmi;
  const mode: "non_emi" | "emi" = isEmi ? "emi" : "non_emi";
  const monthsMatch = cleaned.match(
    /(\d{1,2})\s*month(?:s)?\s+and\s+above/i,
  );
  const requiredMonths = monthsMatch?.[1] ? Number(monthsMatch[1]) : null;
  const minSpend = parseMinSpend(cleaned);

  if (minSpend && listed && listed.amount < minSpend.amount) {
    return null;
  }

  let percent: number | null = null;
  let cap: Money | null = null;
  let discount: number | null = null;

  const percentMatch = cleaned.match(
    /(\d{1,2}(?:\.\d+)?)\s*%\s+Instant\s+Discount\s+up\s+to\s+(?:INR|₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (percentMatch?.[1] && percentMatch[2]) {
    percent = Number(percentMatch[1]);
    cap = toMoney(Number(percentMatch[2].replace(/,/g, "")));
    if (listed) {
      discount = Math.min((listed.amount * percent) / 100, cap.amount);
    }
  } else {
    const flatMatch = cleaned.match(
      /(?:Additional\s+)?(?:Flat\s+)?(?:INR|₹|Rs\.?)\s*([\d,]+(?:\.\d{1,2})?)\s+Instant\s+Discount/i,
    );
    if (flatMatch?.[1]) {
      discount = Number(flatMatch[1].replace(/,/g, ""));
    }
  }

  if (discount === null || !Number.isFinite(discount) || discount <= 0) {
    return null;
  }

  return {
    rawText: cleaned,
    issuer: issuerName,
    cardType,
    mode,
    requiredMonths,
    discount,
    minSpend,
    additional: /\badditional\b/i.test(cleaned),
    percent,
    cap,
  };
}

function buildBankStack(
  components: BankComponent[],
  tier: number | null,
): BankStack | null {
  const applicable = components.filter(
    (component) =>
      component.requiredMonths === null ||
      tier === null ||
      component.requiredMonths <= tier,
  );
  if (applicable.length === 0) return null;

  const bases = applicable
    .filter((component) => !component.additional)
    .sort((left, right) => right.discount - left.discount);
  const base = bases[0] ?? null;
  const additions = applicable.filter((component) => component.additional);
  const included = [...(base ? [base] : []), ...additions];
  const total = included.reduce((sum, component) => sum + component.discount, 0);
  if (total <= 0) return null;
  return { total, included, tier };
}

function bankStackOffer(
  components: BankComponent[],
  stack: BankStack,
  listed: Money | null,
): Offer {
  const first = components[0];
  if (!first) {
    throw new Error("Cannot build a bank offer stack without components.");
  }
  const modeLabel =
    first.mode === "non_emi"
      ? "non-EMI"
      : stack.tier
        ? `${stack.tier}+ month EMI`
        : "EMI";
  const minSpend = stack.included.reduce<Money | null>((max, component) => {
    if (!component.minSpend) return max;
    if (!max || component.minSpend.amount > max.amount) return component.minSpend;
    return max;
  }, null);

  const parts = stack.included.map((component) => {
    if (component.percent !== null) {
      return `${component.percent}% up to ${formatInr(component.cap?.amount ?? null)} (${formatInr(component.discount)})`;
    }
    return `${formatInr(component.discount)}${component.additional ? " additional" : ""}`;
  });

  const eligibility = `${first.issuer} ${first.cardType}; ${modeLabel}; select an eligible card at checkout; no promo code.${minSpend ? ` Minimum purchase ${formatInr(minSpend.amount)}.` : ""} Stacking and final eligibility are subject to Amazon's terms and checkout.`;

  const offerComponents: OfferComponent[] = stack.included.map((component) => ({
    rawText: component.rawText,
    discount: component.discount,
    minSpend: component.minSpend?.amount ?? null,
  }));

  return {
    id: `bank-stack-${first.issuer}-${first.cardType}-${first.mode}-${stack.tier ?? "all"}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-"),
    type: "bank_instant_discount",
    rawText: `${first.issuer} ${first.cardType} — ${modeLabel} bank offer stack (${stack.included.length} offers)`,
    components: offerComponents,
    instant: true,
    paymentMode: first.mode === "emi" ? "emi" : "full",
    requiresEligibility: true,
    eligibility,
    discount: toMoney(stack.total),
    discountKind: "flat",
    percent: null,
    cap: null,
    minSpend,
    cashback: null,
    stackable: "yes",
    applicable: true,
    appliedIn: "none",
    calculation: `${parts.join(" + ")} = ${formatInr(stack.total)}.${listed ? ` Buy for ${formatInr(Math.max(0, listed.amount - stack.total))}.` : ""} Aggregated from Amazon's listed offers for the same card and payment mode; credits are applied at checkout.`,
  };
}

export function parseBankOfferDetails(
  texts: string[],
  listed: Money | null,
  ctx: ExtractionContext,
): Offer[] {
  if (texts.length === 0) return [];

  const components: BankComponent[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const component = parseBankComponent(text, listed);
    if (!component) continue;
    const key = `${component.rawText.toLowerCase()}|${component.discount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    components.push(component);
  }
  if (components.length === 0) return [];

  const groups = new Map<string, BankComponent[]>();
  for (const component of components) {
    const key = `${component.issuer}|${component.cardType}|${component.mode}`;
    const group = groups.get(key) ?? [];
    group.push(component);
    groups.set(key, group);
  }

  const offers: Offer[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    if (first.mode === "non_emi") {
      const stack = buildBankStack(group, null);
      if (stack) offers.push(bankStackOffer(group, stack, listed));
      continue;
    }

    const tiers = Array.from(
      new Set(
        group
          .map((component) => component.requiredMonths)
          .filter((months): months is number => months !== null),
      ),
    ).sort((left, right) => left - right);

    const candidates = (tiers.length > 0 ? tiers : [null])
      .map((tier) => buildBankStack(group, tier))
      .filter((stack): stack is BankStack => stack !== null)
      .sort((left, right) => right.total - left.total);

    const best = candidates[0];
    if (best) offers.push(bankStackOffer(group, best, listed));
  }

  if (offers.length === 0) {
    ctx.warn(
      "bank_offers_not_calculable",
      "Bank offer details were found, but no stack had a reliably calculable discount.",
    );
  }
  return offers;
}

function offerCalculation(
  type: OfferType,
  discount: Money | null,
  listed: Money | null,
  economics: OfferEconomics,
  eligibility: string | null,
): string | null {
  if (discount && listed) {
    const after = Math.max(0, listed.amount - discount.amount);
    return `${formatInr(listed.amount)} − ${formatInr(discount.amount)} = ${formatInr(after)} (${type}${eligibility ? "; eligibility required" : ""})`;
  }
  if (economics.percent !== null && economics.cap === null && listed) {
    return `${economics.percent}% ${type}; no cap stated, so the price cannot be reliably calculated.`;
  }
  if (type === "cashback") {
    return "Cashback/reward is recorded separately and is not subtracted from the selling price.";
  }
  if (type === "exchange") {
    return "Exchange value depends on the old device and is not reliably calculable.";
  }
  if (type === "no_cost_emi") {
    return "No-cost EMI is a payment option, not a price reduction.";
  }
  return null;
}

function buildOffer(
  type: OfferType,
  rawText: string,
  listed: Money | null,
  economics: OfferEconomics,
  eligibility: string | null,
  options: {
    instant: boolean;
    requiresEligibility: boolean;
    discount?: Money | null;
    cashback?: Money | null;
    applicable?: boolean | null;
    id: string;
    paymentMode?: "full" | "emi" | "unknown";
  },
): Offer {
  const discount = options.discount ?? economics.discount;
  const paymentMode =
    options.paymentMode ??
    (type === "no_cost_emi"
      ? "emi"
      : type === "cashback" || type === "exchange"
        ? "unknown"
        : "full");
  return {
    id: options.id,
    type,
    rawText,
    instant: options.instant,
    paymentMode,
    requiresEligibility: options.requiresEligibility,
    eligibility,
    discount,
    discountKind: economics.discountKind,
    percent: economics.percent,
    cap: economics.cap,
    minSpend: economics.minSpend,
    cashback: options.cashback ?? economics.cashback,
    stackable: economics.stackable,
    applicable:
      options.applicable ??
      (economics.minSpend && listed
        ? listed.amount >= economics.minSpend.amount
        : economics.minSpend && !listed
          ? null
          : null),
    appliedIn: "none",
    calculation: offerCalculation(type, discount, listed, economics, eligibility),
  };
}

function offerTexts(snapshot: PageSnapshot): string[] {
  const candidates = uniqueStrings([
    ...snapshot.price.couponTexts,
    ...snapshot.price.bankOfferTexts,
    ...snapshot.price.otherOfferTexts,
    ...(snapshot.price.buyboxText?.split(/\n+/) ?? []),
  ]);
  return candidates.filter(
    (text) =>
      text.length >= 10 &&
      /(?:coupon|bank|credit|debit|card|emi|exchange|cashback|reward|offer|discount|save|saving|instant|prime|gst|invoice|no cost)/i.test(
        text,
      ) &&
      !/^(?:bank offer|offers?|coupon|save|bank)$/i.test(text) &&
      !/^(?:with|without)\s+exchange$/i.test(text),
  );
}

function classifyOffer(text: string, listed: Money | null, index: number): Offer[] {
  const lower = text.toLowerCase();
  const economics = parseOfferEconomics(text, listed);
  const offers: Offer[] = [];

  const isCashback = /cashback|reward\s+points?/i.test(text);
  const isExchange = /\bexchange\b/i.test(text);
  const isNoCostEmi =
    /no[\s-]?cost\s+emi|emi\s+interest\s+savings/i.test(text);
  const isCoupon = /\bcoupon\b/i.test(text);
  const isBank =
    /(?:bank|credit\s+card|debit\s+card|card\s+emi|emi\s+transaction|instant\s+discount)/i.test(
      text,
    ) &&
    !(isCashback && !/instant\s+discount/i.test(text)) &&
    !(isNoCostEmi && economics.discount === null && !/instant\s+discount/i.test(text));
  const isMembership = /\bprime\b|\bmember(?:ship)?\b/i.test(text);
  const hasDiscountSignal =
    economics.percent !== null ||
    economics.flat !== null ||
    /instant\s+discount|save|saving|discount|coupon|\boff\b/i.test(text);

  const stackNote = economics.stackable;

  if (isCashback) {
    const eligibility =
      "Cashback/reward is credited after purchase; account/card eligibility and terms are not verified.";
    offers.push(
      buildOffer("cashback", text, listed, economics, eligibility, {
        instant: false,
        requiresEligibility: true,
        discount: null,
        id: `offer-${index}-cashback`,
        applicable: null,
      }),
    );
  }

  if (isExchange) {
    const eligibility =
      "Exchange requires an eligible old device; device valuation is not accounted for.";
    offers.push(
      buildOffer("exchange", text, listed, economics, eligibility, {
        instant: true,
        requiresEligibility: true,
        discount: null,
        id: `offer-${index}-exchange`,
        applicable: null,
      }),
    );
  }

  if (isNoCostEmi) {
    const eligibility =
      "No-cost EMI requires a participating bank/card and tenure; this is not treated as a price reduction.";
    offers.push(
      buildOffer("no_cost_emi", text, listed, economics, eligibility, {
        instant: false,
        requiresEligibility: true,
        discount: null,
        id: `offer-${index}-emi`,
        applicable: null,
      }),
    );
  }

  if (isCoupon) {
    const eligibility =
      "Coupon must be clipped/claimed; account eligibility and stacking are not verified.";
    offers.push(
      buildOffer("coupon", text, listed, economics, eligibility, {
        instant: true,
        requiresEligibility: true,
        discount: economics.discount,
        id: `offer-${index}-coupon`,
      }),
    );
  }

  if (isBank) {
    const bankName = issuer(text);
    const cardType =
      /credit\s+card/i.test(text) && /debit\s+card/i.test(text)
        ? "credit/debit card"
        : /debit\s+card/i.test(text)
          ? "debit card"
          : /emi/i.test(text)
            ? "card EMI"
            : "credit card";
    const minSpendText = economics.minSpend
      ? ` Minimum spend ${formatInr(economics.minSpend.amount)}.`
      : "";
    const eligibility = `${bankName ? `${bankName} ` : ""}${cardType} eligibility and offer terms are not verified.${minSpendText}`.trim();
    const isEmiOffer =
      /\bemi\b/i.test(text) && !/non[-\s]?emi/i.test(text);
    offers.push(
      buildOffer("bank_instant_discount", text, listed, economics, eligibility, {
        instant: true,
        requiresEligibility: true,
        discount: economics.discount,
        id: `offer-${index}-bank`,
        paymentMode: isEmiOffer ? "emi" : "full",
      }),
    );
  }

  if (isMembership && !isCoupon && !isBank && hasDiscountSignal) {
    const eligibility = "Prime/membership eligibility is required and not verified.";
    offers.push(
      buildOffer("membership", text, listed, economics, eligibility, {
        instant: true,
        requiresEligibility: true,
        discount: economics.discount,
        id: `offer-${index}-membership`,
      }),
    );
  }

  if (offers.length === 0 && /offer|discount|save|saving|\boff\b|gst|invoice|buy\s+\d/i.test(lower)) {
    const eligibility =
      "Offer conditions are unclear; it was recorded but not applied to the calculated price.";
    offers.push(
      buildOffer("other", text, listed, economics, eligibility, {
        instant: false,
        requiresEligibility: true,
        discount: null,
        id: `offer-${index}-other`,
        applicable: null,
      }),
    );
  }

  for (const offer of offers) {
    if (offer.stackable !== stackNote) offer.stackable = stackNote;
  }
  return offers;
}

function exchangeOfferFromBuybox(
  text: string | null,
  listed: Money | null,
  index: number,
): Offer | null {
  if (!text) return null;
  const match = text.match(
    /with\s+exchange[\s\S]{0,120}?up\s+to\s*(?:₹|Rs\.?\s*|INR\s*)?([\d,]+(?:\.\d{1,2})?)\s*off/i,
  );
  if (!match?.[1]) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    id: `offer-${index}-exchange`,
    type: "exchange",
    rawText: match[0],
    instant: true,
    paymentMode: "unknown",
    requiresEligibility: true,
    eligibility:
      "Exchange requires an eligible old device; the upfront value depends on device valuation.",
    discount: null,
    discountKind: "unknown",
    percent: null,
    cap: toMoney(amount),
    minSpend: null,
    cashback: null,
    stackable: "unknown",
    applicable: null,
    appliedIn: "none",
    calculation:
      listed === null
        ? "Exchange discount is capped by the advertised amount but the old-device valuation is unknown."
        : `Advertised exchange cap ${formatInr(amount)}; the actual reduction depends on the old-device valuation and is not subtracted from the listed price.`,
  };
}

function dedupeOffers(offers: Offer[]): Offer[] {
  const seen = new Set<string>();
  const result: Offer[] = [];
  for (const offer of offers) {
    const key = `${offer.type}|${offer.rawText.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(offer);
  }
  return result;
}

function computePrices(
  listed: Money | null,
  offers: Offer[],
  ctx: ExtractionContext,
): {
  priceWithoutConditionalOffers: Money | null;
  bestEffectivePrice: Money | null;
  conditionalBestPrice: Money | null;
  conditionalOfferId: string | null;
  emiConditionalBestPrice: Money | null;
  emiConditionalOfferId: string | null;
  notes: string[];
} {
  const notes: string[] = [];
  if (!listed) {
    return {
      priceWithoutConditionalOffers: null,
      bestEffectivePrice: null,
      conditionalBestPrice: null,
      conditionalOfferId: null,
      emiConditionalBestPrice: null,
      emiConditionalOfferId: null,
      notes: ["Listed price could not be determined; no price arithmetic was attempted."],
    };
  }

  const unconditional = offers.filter(
    (offer) =>
      offer.instant &&
      !offer.requiresEligibility &&
      offer.discount !== null &&
      offer.applicable !== false &&
      offer.stackable !== "no",
  );
  let bestEffective = listed;
  if (unconditional.length > 0) {
    const selected = unconditional.reduce((best, offer) =>
      (offer.discount?.amount ?? 0) > (best.discount?.amount ?? 0) ? offer : best,
    );
    selected.appliedIn = "best_effective";
    bestEffective = toMoney(
      Math.max(0, listed.amount - (selected.discount?.amount ?? 0)),
    );
    notes.push(
      `Unconditional offer applied alone: ${formatInr(listed.amount)} − ${formatInr(selected.discount?.amount ?? 0)} = ${formatInr(bestEffective.amount)}. Stacking was not assumed.`,
    );
  } else {
    notes.push(
      "No unconditional, reliably stackable discount was detected; best effective price equals the listed price.",
    );
  }

  const conditionalBase = offers.filter(
    (offer) =>
      offer.instant &&
      offer.requiresEligibility &&
      offer.discount !== null &&
      offer.applicable !== false &&
      offer.type !== "cashback" &&
      offer.type !== "exchange" &&
      offer.type !== "no_cost_emi",
  );
  const fullPaymentConditional = conditionalBase.filter(
    (offer) => offer.paymentMode !== "emi",
  );
  const emiConditional = conditionalBase.filter(
    (offer) => offer.paymentMode === "emi",
  );

  const selectBest = (candidates: Offer[]): Offer | null =>
    candidates.length === 0
      ? null
      : candidates.reduce((best, offer) =>
          (offer.discount?.amount ?? 0) > (best.discount?.amount ?? 0)
            ? offer
            : best,
        );

  const fullSelected = selectBest(fullPaymentConditional);
  const emiSelected = selectBest(emiConditional);

  let conditionalBest: Money | null = null;
  let conditionalOfferId: string | null = null;
  if (fullSelected) {
    fullSelected.appliedIn = "conditional_best";
    conditionalBest = toMoney(
      Math.max(0, listed.amount - (fullSelected.discount?.amount ?? 0)),
    );
    conditionalOfferId = fullSelected.id;
    if (fullSelected.components && fullSelected.components.length > 1) {
      notes.push(
        `Full-payment conditional price uses one bank offer stack (${fullSelected.components.length} explicitly listed components): ${formatInr(listed.amount)} − ${formatInr(fullSelected.discount?.amount ?? 0)} = ${formatInr(conditionalBest.amount)}. Separate offer groups were not stacked; eligibility and minimum-spend conditions must be checked.`,
      );
    } else {
      notes.push(
        `Full-payment conditional price uses one offer: ${formatInr(listed.amount)} − ${formatInr(fullSelected.discount?.amount ?? 0)} = ${formatInr(conditionalBest.amount)}. Eligibility and minimum-spend conditions must be checked; other offers were not stacked.`,
      );
    }
  } else if (conditionalBase.length > 0) {
    notes.push(
      "No full-payment conditional offer was reliably calculable; the full-payment conditional price is unknown. EMI offers are shown separately.",
    );
  }

  let emiBest: Money | null = null;
  let emiOfferId: string | null = null;
  if (emiSelected) {
    emiSelected.appliedIn = "emi_conditional";
    emiBest = toMoney(
      Math.max(0, listed.amount - (emiSelected.discount?.amount ?? 0)),
    );
    emiOfferId = emiSelected.id;
    notes.push(
      `EMI conditional price (${emiSelected.rawText}): ${formatInr(listed.amount)} − ${formatInr(emiSelected.discount?.amount ?? 0)} = ${formatInr(emiBest.amount)} before processing fees/interest. This is shown separately and is not treated as the overall lowest price because EMI fees and eligibility can erase the difference.`,
    );
  } else if (conditionalBase.length > 0) {
    notes.push("No EMI-only conditional offer was reliably calculable.");
  }

  if (offers.some((offer) => offer.type === "cashback")) {
    notes.push(
      "Cashback/reward amounts are kept separate and are never subtracted from the price.",
    );
  }
  if (offers.some((offer) => offer.type === "exchange")) {
    notes.push(
      "Exchange offers are not subtracted because the old-device valuation is unknown.",
    );
  }

  if (fullPaymentConditional.length + emiConditional.length > 1) {
    ctx.warn(
      "conditional_offers_not_stacked",
      "Multiple conditional offer groups were found; the best full-payment offer/stack and the best EMI offer/stack are kept separate. Separate offer groups were not stacked.",
    );
  }

  if (offers.some((offer) => offer.type === "no_cost_emi")) {
    notes.push(
      "No-cost EMI interest savings are not treated as a price reduction and are not included in either conditional price.",
    );
  }

  return {
    priceWithoutConditionalOffers: bestEffective,
    bestEffectivePrice: bestEffective,
    conditionalBestPrice: conditionalBest,
    conditionalOfferId,
    emiConditionalBestPrice: emiBest,
    emiConditionalOfferId: emiOfferId,
    notes,
  };
}

export function extractPrice(
  snapshot: PageSnapshot,
  ctx: ExtractionContext,
): PriceInfo {
  const dom = domPriceCandidates(snapshot);
  const structured = jsonLdPrice(snapshot);

  let listedCandidate = dom.listed[0] ?? null;
  if (!listedCandidate && structured) {
    listedCandidate = {
      money: structured,
      rawText: "JSON-LD Product.offers.price",
      source: ctx.source("amazon_structured_data", "JSON-LD Product.offers"),
    };
    ctx.warn(
      "price_from_json_ld",
      "Listed price came from JSON-LD because no visible DOM price was found.",
    );
  }

  if (listedCandidate) {
    const distinct = new Set(dom.listed.map((candidate) => candidate.money.amount));
    if (distinct.size > 1) {
      ctx.warn(
        "multiple_listed_prices",
        "Multiple price-like values were found; the first visible selling price was used.",
        [...distinct].map((amount) => formatInr(amount)).join("; "),
      );
    }
    if (structured && Math.abs(structured.amount - listedCandidate.money.amount) > 1) {
      ctx.warn(
        "price_source_conflict",
        "Visible price and JSON-LD offer price differ; the visible selling price was used.",
        `visible=${formatInr(listedCandidate.money.amount)}; JSON-LD=${formatInr(structured.amount)}`,
      );
    }
  } else {
    ctx.warn(
      "listed_price_missing",
      "Listed/selling price could not be determined from the page.",
    );
  }

  const listed = listedCandidate?.money ?? null;

  const mrpValues = dom.mrp
    .map((candidate) => candidate.money)
    .filter((money) => money.amount > 0);
  let mrp: Money | null = null;
  if (mrpValues.length > 0) {
    const max = mrpValues.reduce((best, money) =>
      money.amount > best.amount ? money : best,
    );
    if (listed && max.amount < listed.amount) {
      ctx.warn(
        "mrp_lower_than_listed",
        "The detected MRP/list price is lower than the selling price; it was discarded.",
        `MRP=${formatInr(max.amount)}; listed=${formatInr(listed.amount)}`,
      );
    } else {
      mrp = max;
    }
  }

  let offers: Offer[] = [];
  let offerIndex = 0;
  for (const text of offerTexts(snapshot)) {
    offerIndex += 1;
    offers.push(...classifyOffer(text, listed, offerIndex));
  }
  const exchangeOffer = exchangeOfferFromBuybox(
    snapshot.price.buyboxText,
    listed,
    offerIndex + 1,
  );
  if (exchangeOffer) offers.push(exchangeOffer);

  const detailedBankOffers = parseBankOfferDetails(
    snapshot.price.bankOfferDetails,
    listed,
    ctx,
  );
  if (detailedBankOffers.length > 0) {
    // The summary tile only shows "up to" values. When the full bank offer
    // sheet is available, replace summary bank offers with calculated stacks.
    offers = offers.filter((offer) => offer.type !== "bank_instant_discount");
    offers.push(...detailedBankOffers);
  }

  const uniqueOffers = dedupeOffers(offers).map((offer, index) => ({
    ...offer,
    id: `offer-${index + 1}-${offer.type}`,
  }));

  const pricing = computePrices(listed, uniqueOffers, ctx);
  const source = listedCandidate?.source ?? null;

  const eligibility = uniqueStrings(
    uniqueOffers.map((offer) => offer.eligibility),
  );

  const rawPriceTexts = uniqueStrings([
    ...snapshot.price.coreTexts,
    ...snapshot.price.priceTexts,
    ...snapshot.price.mrpTexts,
    ...snapshot.price.couponTexts,
    ...snapshot.price.bankOfferTexts,
    ...snapshot.price.bankOfferDetails,
    ...snapshot.price.otherOfferTexts,
  ]).slice(0, 120);

  return {
    currency: "INR",
    listedPrice: listed,
    mrp,
    offers: uniqueOffers,
    priceWithoutConditionalOffers: pricing.priceWithoutConditionalOffers,
    bestEffectivePrice: pricing.bestEffectivePrice,
    conditionalBestPrice: pricing.conditionalBestPrice,
    conditionalOfferId: pricing.conditionalOfferId,
    emiConditionalBestPrice: pricing.emiConditionalBestPrice,
    emiConditionalOfferId: pricing.emiConditionalOfferId,
    offerEligibility: eligibility,
    calculationNotes: pricing.notes,
    timestamp: snapshot.extractedAt,
    source,
    rawPriceTexts,
  };
}
