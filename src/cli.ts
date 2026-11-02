#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { loadConfig, HELP_TEXT, ConfigError } from "./config.js";
import { Logger, describeError } from "./logger.js";
import { parseLinksFile } from "./input/links.js";
import { runCompare } from "./pipeline.js";

const VERSION = "1.0.0";

async function dryRun(config: ReturnType<typeof loadConfig>, logger: Logger): Promise<void> {
  const inputFile = relative(config.cwd, config.linksFile) || config.linksFile;
  let content: string;
  try {
    content = await readFile(config.linksFile, "utf8");
  } catch (error) {
    throw new Error(`Could not read links file ${config.linksFile}: ${describeError(error)}`);
  }

  const parsed = parseLinksFile(content, config.maxProducts, inputFile);
  const links =
    config.limit !== null ? parsed.links.slice(0, config.limit) : parsed.links;

  logger.info("Dry run", "no browser will be launched");
  logger.info(
    "Input summary",
    `${links.length} valid unique URL(s); ${parsed.summary.duplicates} duplicate(s); ${parsed.summary.invalid} invalid line(s); ${parsed.summary.truncated} truncated`,
  );
  for (const issue of parsed.summary.issues) {
    logger.warn(`Input line ${issue.line || "file"}: ${issue.message}`, issue.value);
  }
  if (links.length === 0) {
    logger.warn("No valid product URLs. Add Amazon India /dp/ASIN links to the file.");
    return;
  }
  for (const [index, link] of links.entries()) {
    console.log(`${index + 1}. ${link.asin ?? "no ASIN"}  ${link.canonicalUrl}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return;
  }

  let config;
  try {
    config = loadConfig(argv);
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : describeError(error);
    console.error(`Configuration error: ${message}`);
    console.error('Run "npm run compare -- --help" for usage.');
    process.exitCode = 1;
    return;
  }

  const logger = new Logger(config.logLevel);
  logger.info(
    "Amazon laptop comparison",
    `${config.headless ? "headless" : "headed"}; concurrency=${config.concurrency}; delay=${config.minDelayMs}-${config.maxDelayMs}ms`,
  );

  if (config.dryRun) {
    await dryRun(config, logger);
    return;
  }

  const result = await runCompare(config, logger);
  if (result.fatalError) {
    logger.error("Run finished with a fatal error", result.fatalError);
    process.exitCode = 1;
  }
  console.log("");
  console.log(`Dashboard: ${result.paths.html}`);
  console.log(`JSON:      ${result.paths.json}`);
  console.log(`CSV:       ${result.paths.csv}`);
}

main().catch((error) => {
  console.error(`Fatal error: ${describeError(error)}`);
  process.exitCode = 1;
});
