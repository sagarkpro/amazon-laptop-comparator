import type { Money } from "../types.js";
import { cleanText } from "./text.js";

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseFirstNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = cleanText(text).match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!match?.[1]) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

export function parseRupeeAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = cleanText(text);

  const currencyMatch = cleaned.match(
    /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (currencyMatch?.[1]) {
    const value = Number(currencyMatch[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }

  const onlyNumber = cleaned.match(/^([\d,]+(?:\.\d{1,2})?)$/);
  if (onlyNumber?.[1]) {
    const value = Number(onlyNumber[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

export function parseMoney(text: string | null | undefined): Money | null {
  const amount = parseRupeeAmount(text);
  if (amount === null || amount <= 0) return null;
  return { amount: roundMoney(amount), currency: "INR" };
}

export function parsePercent(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = cleanText(text).match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

export function parseWattage(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = cleanText(text).match(/(\d{1,3}(?:\.\d+)?)\s*(?:W|watts?)\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseAllWattages(text: string | null | undefined): number[] {
  if (!text) return [];
  return Array.from(cleanText(text).matchAll(/(\d{1,3}(?:\.\d+)?)\s*(?:W|watts?)\b/gi))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

export function parseGb(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = cleanText(text).match(/(\d{1,3}(?:\.\d+)?)\s*GB\b/i);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function parseMhz(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = cleanText(text);
  const explicit = cleaned.match(/(\d{3,5})\s*MHz\b/i);
  if (explicit?.[1]) return Number(explicit[1]);
  const ddrSuffix = cleaned.match(/DDR[345](?:X)?-(\d{3,5})\b/i);
  if (ddrSuffix?.[1]) return Number(ddrSuffix[1]);
  return null;
}

export function formatInr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "unknown";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
