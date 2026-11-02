import test from "node:test";
import assert from "node:assert/strict";
import { buildCsv } from "../src/report/csv.js";
import { makeProduct, makeReport } from "./fixtures.js";

test("builds a one-row-per-product CSV with the expected columns", () => {
  const csv = buildCsv(makeReport());
  assert.ok(csv.startsWith("\uFEFF"));
  const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0]?.includes("gpu_vram_gb"));
  assert.ok(lines[0]?.includes("full_payment_conditional_price_inr"));
  assert.ok(lines[0]?.includes("emi_conditional_price_before_fees_inr"));
  assert.ok(lines[1]?.includes("B0TEST0001"));
  assert.ok(lines[1]?.includes("NVIDIA GeForce RTX 4060 Laptop GPU"));
});

test("escapes CSV formulas and quotes", () => {
  const product = makeProduct({
    title: '=HYPERLINK("https://example.com","click")',
  });
  const csv = buildCsv(makeReport([product]));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('""https://example.com""'));
});

test("uses explicit unknown values for missing fields", () => {
  const product = makeProduct();
  product.gpu.vramGb = {
    value: null,
    unit: null,
    source: null,
    verification: "unknown",
    qualification: null,
    rawText: null,
    candidates: [],
  };
  const csv = buildCsv(makeReport([product]));
  const row = csv.trimEnd().split("\r\n")[1] ?? "";
  assert.ok(row.includes("unknown"));
});
