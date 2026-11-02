import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Report } from "./types.js";
import type { Logger } from "./logger.js";
import { buildCsv } from "./report/csv.js";
import { buildHtml } from "./report/html.js";
import { buildJson } from "./report/json.js";

export interface OutputPaths {
  directory: string;
  json: string;
  csv: string;
  html: string;
}

function timestampSlug(value: string): string {
  return value
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-")
    .replace("T", "_");
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function writePartialReport(
  report: Report,
  outputDir: string,
): Promise<void> {
  await writeAtomic(join(outputDir, "partial.json"), buildJson(report));
}

export async function removePartialReport(outputDir: string): Promise<void> {
  await unlink(join(outputDir, "partial.json")).catch(() => undefined);
}

export async function writeReportOutputs(
  report: Report,
  outputDir: string,
  logger: Logger,
): Promise<OutputPaths> {
  const json = buildJson(report);
  const csv = buildCsv(report);
  const html = buildHtml(report);
  const slug = timestampSlug(report.run.startedAt);
  const base = `laptops-${slug}`;

  const paths: OutputPaths = {
    directory: outputDir,
    json: join(outputDir, "latest.json"),
    csv: join(outputDir, "latest.csv"),
    html: join(outputDir, "latest.html"),
  };

  await writeAtomic(paths.json, json);
  await writeAtomic(paths.csv, csv);
  await writeAtomic(paths.html, html);

  await writeAtomic(join(outputDir, `${base}.json`), json);
  await writeAtomic(join(outputDir, `${base}.csv`), csv);
  await writeAtomic(join(outputDir, `${base}.html`), html);

  logger.info("Reports written", paths.directory);
  logger.info("Open the dashboard", paths.html);
  return paths;
}
