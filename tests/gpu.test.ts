import test from "node:test";
import assert from "node:assert/strict";
import {
  extractGpuModel,
  parseVramFromGpuText,
} from "../src/normalize/hardware.js";
import { parseGpuPower, extractGpu } from "../src/extract/gpu.js";
import { ExtractionContext } from "../src/extract/context.js";
import { makeSnapshot } from "./fixtures.js";

test("normalizes discrete and integrated GPU models", () => {
  const discrete = extractGpuModel("NVIDIA GeForce RTX 3050 6GB GDDR6");
  assert.equal(discrete?.model, "NVIDIA GeForce RTX 3050 Laptop GPU");
  assert.equal(discrete?.type, "discrete");

  const integrated = extractGpuModel("AMD Radeon 780M Graphics");
  assert.equal(integrated?.model, "AMD Radeon 780M");
  assert.equal(integrated?.type, "integrated");
});

test("parses explicit VRAM but never infers it from the GPU name", () => {
  assert.equal(parseVramFromGpuText("NVIDIA GeForce RTX 3050 6GB GDDR6")?.gb, 6);
  assert.equal(parseVramFromGpuText("NVIDIA GeForce RTX 4060 Laptop GPU"), null);
  assert.equal(
    parseVramFromGpuText("NVIDIA GeForce RTX 4060 16GB RAM"),
    null,
  );
});

test("distinguishes TGP, maximum graphics power and Dynamic Boost", () => {
  const sum = parseGpuPower("115W + 25W Dynamic Boost");
  assert.equal(sum?.baseTgpW, 115);
  assert.equal(sum?.dynamicBoostW, 25);
  assert.equal(sum?.maxGraphicsPowerW, 140);

  const max = parseGpuPower("Maximum Graphics Power 140W");
  assert.equal(max?.baseTgpW, null);
  assert.equal(max?.maxGraphicsPowerW, 140);

  const including = parseGpuPower("140W including Dynamic Boost");
  assert.equal(including?.maxGraphicsPowerW, 140);
  assert.equal(including?.baseTgpW, null);

  const tgp = parseGpuPower("TGP 65W");
  assert.equal(tgp?.baseTgpW, 65);
  assert.equal(tgp?.maxGraphicsPowerW, null);

  const labelled = parseGpuPower("65 W", "Maximum Graphics Power");
  assert.equal(labelled?.maxGraphicsPowerW, 65);
  assert.equal(labelled?.baseTgpW, null);
});

test("leaves VRAM unknown for a discrete GPU with no capacity statement", () => {
  const snapshot = makeSnapshot({
    specRows: [
      {
        label: "Graphics",
        value: "NVIDIA GeForce RTX 4060 Laptop GPU",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
      {
        label: "TGP",
        value: "115 W",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
    ],
  });
  const context = new ExtractionContext(snapshot);
  const gpu = extractGpu(snapshot, context, snapshot.productTitle);
  assert.equal(gpu.type, "discrete");
  assert.equal(gpu.vramGb.value, null);
  assert.equal(gpu.vramGb.verification, "unknown");
  assert.equal(gpu.baseTgpW.value, 115);
  assert.ok(context.warnings.some((warning) => warning.code === "gpu_vram_missing"));
});

test("marks integrated VRAM as not applicable", () => {
  const snapshot = makeSnapshot({
    specRows: [
      {
        label: "Graphics",
        value: "AMD Radeon 780M",
        section: "technical specifications",
        sourceType: "amazon_technical_specs",
      },
    ],
  });
  const context = new ExtractionContext(snapshot);
  const gpu = extractGpu(snapshot, context, snapshot.productTitle);
  assert.equal(gpu.type, "integrated");
  assert.equal(gpu.vramGb.value, null);
  assert.equal(gpu.vramGb.verification, "not_applicable");
});
