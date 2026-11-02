import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("page-side snapshot source is valid JavaScript and has no bundler helper", () => {
  const source = readFileSync(
    new URL("../src/browser/snapshot-page.txt", import.meta.url),
    "utf8",
  );
  assert.doesNotThrow(() => new Function(`return (${source});`));
  assert.ok(!source.includes("__name"));
});
