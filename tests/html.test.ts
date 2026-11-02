import test from "node:test";
import assert from "node:assert/strict";
import { buildHtml } from "../src/report/html.js";
import { makeProduct, makeReport } from "./fixtures.js";

test("escapes embedded report data so product text cannot close the script tag", () => {
  const product = makeProduct({
    title: '</script><script>alert("xss")</script>',
  });
  const html = buildHtml(makeReport([product]));
  assert.ok(!html.includes('</script><script>alert("xss")'));
  assert.ok(html.includes("\\u003c/script"));
  assert.ok(html.includes("Laptop comparison"));
});
