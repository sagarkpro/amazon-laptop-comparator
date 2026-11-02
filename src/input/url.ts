const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const ASIN_PATH_PATTERN =
  /(?:^|\/)(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:\/|$)/i;

export interface NormalizedLink {
  input: string;
  asin: string | null;
  canonicalUrl: string;
}

export type NormalizeLinkResult =
  | { ok: true; link: NormalizedLink }
  | { ok: false; code: string; message: string };

function isAmazonIndiaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "amazon.in" || host === "www.amazon.in" || host === "m.amazon.in";
}

export function isValidAsin(value: string): boolean {
  return ASIN_PATTERN.test(value.trim().toUpperCase());
}

export function extractAsinFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const pathMatch = url.pathname.match(ASIN_PATH_PATTERN);
    if (pathMatch?.[1]) {
      const asin = pathMatch[1].toUpperCase();
      return isValidAsin(asin) ? asin : null;
    }
    for (const key of ["asin", "ASIN"]) {
      const query = url.searchParams.get(key);
      if (query && isValidAsin(query)) return query.toUpperCase();
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeAmazonProductUrl(raw: string): NormalizeLinkResult {
  const input = raw.trim();
  if (input === "") {
    return { ok: false, code: "empty", message: "Empty URL." };
  }

  let candidate = input;
  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (/^(?:www\.|m\.)?amazon\.in(?:\/|$)/i.test(candidate)) {
      candidate = `https://${candidate}`;
    }
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, code: "invalid_url", message: "Not a valid absolute URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      code: "unsupported_protocol",
      message: "Only http(s) Amazon India product URLs are supported.",
    };
  }

  const host = url.hostname.toLowerCase();
  if (host === "amzn.to" || host === "amzn.in" || host === "www.amzn.in") {
    return {
      ok: false,
      code: "short_link",
      message: "Short links are not supported. Use the full amazon.in/dp/ASIN URL.",
    };
  }
  if (!isAmazonIndiaHost(host)) {
    return {
      ok: false,
      code: "unsupported_host",
      message: "Only amazon.in product URLs are supported.",
    };
  }

  const asinFromPath = url.pathname.match(ASIN_PATH_PATTERN)?.[1]?.toUpperCase() ?? null;
  const asinFromQuery =
    url.searchParams.get("asin")?.toUpperCase() ??
    url.searchParams.get("ASIN")?.toUpperCase() ??
    null;
  const asinCandidate = asinFromPath ?? asinFromQuery;

  if (!asinCandidate || !isValidAsin(asinCandidate)) {
    return {
      ok: false,
      code: "asin_not_found",
      message:
        "Could not find a valid 10-character ASIN in the URL. Use a /dp/ASIN product URL.",
    };
  }

  return {
    ok: true,
    link: {
      input,
      asin: asinCandidate,
      canonicalUrl: `https://www.amazon.in/dp/${asinCandidate}`,
    },
  };
}

/** Canonical URL for an Amazon product URL discovered on a page. */
export function canonicalProductUrl(value: string): string | null {
  const result = normalizeAmazonProductUrl(value);
  return result.ok ? result.link.canonicalUrl : null;
}
