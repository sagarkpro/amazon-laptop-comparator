import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeUpgradeability,
  parseRamCapacity,
  parseRamSpeed,
} from "../src/normalize/hardware.js";
import { extractMemory } from "../src/extract/memory.js";
import { ExtractionContext } from "../src/extract/context.js";
import { makeSnapshot } from "./fixtures.js";

test("parses RAM capacity without confusing storage", () => {
  assert.equal(parseRamCapacity("16GB DDR5-4800"), 16);
  assert.equal(parseRamCapacity("Installed RAM: 32 GB"), 32);
  assert.equal(parseRamCapacity("512GB SSD"), null);
  assert.equal(parseRamCapacity("1TB HDD"), null);
});

test("parses RAM speed from DDR notation, not GPU boost clocks", () => {
  assert.equal(parseRamSpeed("DDR5-4800"), 4800);
  assert.equal(parseRamSpeed("Memory: 16GB 5600 MHz"), 5600);
  assert.equal(
    parseRamSpeed("GDDR6, Boost Clock 1492MHz, TGP 65W"),
    null,
  );
});

test("only marks upgradeability from explicit clues", () => {
  assert.equal(normalizeUpgradeability("16GB DDR5"), null);
  assert.equal(normalizeUpgradeability("2 x SO-DIMM slots")?.value, "yes");
  assert.equal(normalizeUpgradeability("Soldered memory")?.value, "no");
});

test("extracts RAM capacity, type and explicit upgradeability", () => {
  const snapshot = makeSnapshot({
    specRows: [
      {
        label: "RAM Size",
        value: "16 GB",
        section: "product details",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Memory Technology",
        value: "DDR5",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Memory",
        value: "1x16GB SO-DIMM DDR5-4800, Max Memory: Up to 16GB DDR5-4800",
        section: "detail bullets",
        sourceType: "amazon_technical_specs",
      },
    ],
    bulletTexts: [
      "Graphics: NVIDIA GeForce RTX 3050 6GB GDDR6, Boost Clock 1492MHz, TGP 65W",
    ],
  });
  const context = new ExtractionContext(snapshot);
  const memory = extractMemory(snapshot, context, snapshot.productTitle);
  assert.equal(memory.installedGb.value, 16);
  assert.equal(memory.type.value, "DDR5");
  assert.equal(memory.speedMhz.value, 4800);
  assert.equal(memory.upgradeability.value, "yes");
});
