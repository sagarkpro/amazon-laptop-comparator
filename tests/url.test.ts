import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAmazonProductUrl,
  extractAsinFromUrl,
} from "../src/input/url.js";
import { parseLinksFile } from "../src/input/links.js";

test("normalizes the sample Amazon India URL and drops tracking parameters", () => {
  const result = normalizeAmazonProductUrl(
    "https://www.amazon.in/dp/B0HJGRVBFF/?coliid=I2ISBBSANDHE2&colid=JC3B1L55WHKG&psc=1",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.link.asin, "B0HJGRVBFF");
    assert.equal(result.link.canonicalUrl, "https://www.amazon.in/dp/B0HJGRVBFF");
  }
});

test("supports gp/product and query-ASIN forms", () => {
  const result = normalizeAmazonProductUrl(
    "https://www.amazon.in/gp/product/B0ABC12345?psc=1",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.link.canonicalUrl, "https://www.amazon.in/dp/B0ABC12345");
  }
  assert.equal(
    extractAsinFromUrl("https://www.amazon.in/gp/product/B0ABC12345"),
    "B0ABC12345",
  );
});

test("rejects non-Amazon hosts and short links", () => {
  const otherHost = normalizeAmazonProductUrl(
    "https://www.flipkart.com/dp/B0HJGRVBFF",
  );
  assert.equal(otherHost.ok, false);
  if (!otherHost.ok) assert.equal(otherHost.code, "unsupported_host");

  const short = normalizeAmazonProductUrl("https://amzn.to/abc");
  assert.equal(short.ok, false);
  if (!short.ok) assert.equal(short.code, "short_link");
});

test("rejects URLs without a valid ASIN", () => {
  const result = normalizeAmazonProductUrl("https://www.amazon.in/s?k=laptop");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "asin_not_found");
});

test("parses comments, blanks, duplicates and invalid lines", () => {
  const content = [
    "# Gaming laptops",
    "",
    "https://www.amazon.in/dp/B0HJGRVBFF?tag=x",
    "https://www.amazon.in/dp/B0HJGRVBFF?psc=1",
    "https://example.com/dp/B0HJGRVBFF",
    "not-a-url",
  ].join("\n");
  const parsed = parseLinksFile(content, 10, "data/laptop-links.txt");
  assert.equal(parsed.links.length, 1);
  assert.equal(parsed.summary.duplicates, 1);
  assert.equal(parsed.summary.invalid, 2);
  assert.equal(parsed.links[0]?.asin, "B0HJGRVBFF");
  assert.ok(parsed.summary.issues.some((issue) => issue.code === "duplicate"));
});

test("caps the number of unique products", () => {
  const content = [
    "https://www.amazon.in/dp/B0HJGRVBFF",
    "https://www.amazon.in/dp/B0ABC12345",
    "https://www.amazon.in/dp/B0XYZ98765",
  ].join("\n");
  const parsed = parseLinksFile(content, 2);
  assert.equal(parsed.links.length, 2);
  assert.equal(parsed.summary.truncated, 1);
});
