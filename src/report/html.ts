import { readFileSync } from "node:fs";
import type { Report } from "../types.js";

function readAsset(name: string): string {
  return readFileSync(new URL(`./assets/${name}`, import.meta.url), "utf8");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function buildHtml(report: Report): string {
  const template = readFileSync(new URL("./template.html", import.meta.url), "utf8");
  const css = readAsset("dashboard.css");
  const js = readAsset("dashboard.js");
  return template
    .replace("__DASHBOARD_CSS__", () => css)
    .replace("__DASHBOARD_JS__", () => js)
    .replace("__REPORT_DATA__", () => safeJson(report));
}
