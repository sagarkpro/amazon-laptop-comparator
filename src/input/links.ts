import type { InputIssue, InputSummary } from "../types.js";
import {
  normalizeAmazonProductUrl,
  type NormalizedLink,
} from "./url.js";

export interface ParsedLinks {
  links: NormalizedLink[];
  summary: InputSummary;
}

export function parseLinksFile(
  content: string,
  maxProducts: number,
  file = "data/laptop-links.txt",
): ParsedLinks {
  const lines = content.split(/\r?\n/);
  const issues: InputIssue[] = [];
  const unique: NormalizedLink[] = [];
  const seen = new Map<string, number>();
  let invalid = 0;
  let duplicates = 0;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;

    const result = normalizeAmazonProductUrl(line);
    if (!result.ok) {
      invalid += 1;
      issues.push({
        line: lineNumber,
        value: line,
        code: result.code,
        message: result.message,
      });
      return;
    }

    const key = result.link.asin ?? result.link.canonicalUrl;
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      duplicates += 1;
      issues.push({
        line: lineNumber,
        value: line,
        code: "duplicate",
        message: `Duplicate of the product on line ${firstLine}; skipped.`,
      });
      return;
    }

    seen.set(key, lineNumber);
    unique.push(result.link);
  });

  let truncated = 0;
  let links = unique;
  if (unique.length > maxProducts) {
    truncated = unique.length - maxProducts;
    links = unique.slice(0, maxProducts);
    issues.push({
      line: 0,
      value: "",
      code: "truncated",
      message: `Only the first ${maxProducts} unique products will be processed (${truncated} skipped by MAX_PRODUCTS).`,
    });
  }

  return {
    links,
    summary: {
      file,
      totalLines: lines.length,
      validUrls: links.length,
      duplicates,
      invalid,
      truncated,
      issues,
    },
  };
}
