import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDisplay,
  extractStorage,
  extractWeight,
} from "../src/extract/physical.js";
import { ExtractionContext } from "../src/extract/context.js";
import { makeSnapshot } from "./fixtures.js";

const title =
  'Lenovo LOQ Essential AMD Ryzen 5 7535HS | NVIDIA RTX 3050 6GB (16GB RAM/512GB SSD/FHD IPS/144Hz Refresh Rate/15.6" (39.6cm)/Grey/1.8Kg), 83S000JCIN Gaming Laptop';

test("extracts storage without confusing RAM capacity", () => {
  const snapshot = makeSnapshot({
    productTitle: title,
    specRows: [
      {
        label: "Hard Disk Size",
        value: "512 GB",
        section: "product details",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Hard Disk Description",
        value: "SSD",
        section: "product details",
        sourceType: "amazon_technical_specs",
      },
    ],
  });
  const context = new ExtractionContext(snapshot);
  const storage = extractStorage(snapshot, context, title);
  assert.equal(storage.value, "512GB SSD");
});

test("combines size, resolution, refresh and panel into a display label", () => {
  const snapshot = makeSnapshot({
    specRows: [
      {
        label: "Screen Size",
        value: "15.6 Inches",
        section: "product overview",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Resolution",
        value: "1920 x 1080",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Refresh Rate",
        value: "144 Hz",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Display Technology",
        value: "IPS",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
    ],
  });
  const context = new ExtractionContext(snapshot);
  const display = extractDisplay(snapshot, context, title);
  assert.equal(display.value, '15.6" 1920x1080 144Hz IPS');
});

test("extracts weight from a structured field", () => {
  const snapshot = makeSnapshot({
    specRows: [
      {
        label: "Item Weight",
        value: "1.8 kg",
        section: "product details",
        sourceType: "amazon_technical_specs",
      },
    ],
  });
  const context = new ExtractionContext(snapshot);
  const weight = extractWeight(snapshot, context, title);
  assert.equal(weight.value, "1.8 kg");
});
