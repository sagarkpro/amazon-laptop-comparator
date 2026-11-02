import test from "node:test";
import assert from "node:assert/strict";
import { extractCpuModel } from "../src/normalize/hardware.js";
import { parseCpuPower, extractCpu } from "../src/extract/cpu.js";
import { ExtractionContext } from "../src/extract/context.js";
import { makeSnapshot } from "./fixtures.js";

test("normalizes Intel and AMD CPU models", () => {
  assert.equal(
    extractCpuModel("13th Gen Intel Core i7-13620H Processor"),
    "Intel Core i7-13620H",
  );
  assert.equal(
    extractCpuModel("AMD Ryzen 5 7535HS (6C / 12T)"),
    "AMD Ryzen 5 7535HS",
  );
  assert.equal(extractCpuModel("AMD"), null);
});

test("distinguishes base TDP from maximum turbo power", () => {
  const parsed = parseCpuPower(
    "Processor Base Power 45W, Maximum Turbo Power 115W",
  );
  assert.equal(parsed?.baseTdpW, 45);
  assert.equal(parsed?.maxTurboPowerW, 115);
  assert.equal(parsed?.configurableTdpW, null);
});

test("parses a configurable TDP range without inventing a base TDP", () => {
  const parsed = parseCpuPower("35-54W", "Configurable TDP");
  assert.equal(parsed?.baseTdpW, null);
  assert.equal(parsed?.maxTurboPowerW, null);
  assert.deepEqual(parsed?.configurableTdpW, { min: 35, max: 54 });

  const generic = parseCpuPower("TDP 35-54W");
  assert.equal(generic?.baseTdpW, null);
  assert.deepEqual(generic?.configurableTdpW, { min: 35, max: 54 });

  const labelled = parseCpuPower("35-54W", "TDP");
  assert.equal(labelled?.baseTdpW, null);
  assert.deepEqual(labelled?.configurableTdpW, { min: 35, max: 54 });
});

test("does not treat a bare wattage as CPU TDP", () => {
  assert.equal(parseCpuPower("45W"), null);
});

test("extracts CPU model and configurable power from specification rows", () => {
  const snapshot = makeSnapshot({
    specRows: [
      {
        label: "Processor",
        value: "AMD Ryzen 5 7535HS",
        section: "product overview",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "Configurable TDP",
        value: "35-54 W",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
    ],
  });
  const context = new ExtractionContext(snapshot);
  const cpu = extractCpu(snapshot, context, snapshot.productTitle);
  assert.equal(cpu.model.value, "AMD Ryzen 5 7535HS");
  assert.equal(cpu.baseTdpW.value, null);
  assert.deepEqual(cpu.configurableTdpW.value, { min: 35, max: 54 });
});
