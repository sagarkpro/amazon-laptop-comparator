import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface AppConfig {
  cwd: string;
  linksFile: string;
  outputDir: string;
  manufacturerSpecsFile: string;
  manufacturerLookup: boolean;
  headless: boolean;
  concurrency: number;
  minDelayMs: number;
  maxDelayMs: number;
  navTimeoutMs: number;
  navRetries: number;
  retryBaseDelayMs: number;
  maxProducts: number;
  limit: number | null;
  browserChannel: string | null;
  slowMoMs: number;
  blockImages: boolean;
  respectRobots: boolean;
  blockThreshold: number;
  manualChallengeWait: boolean;
  challengeWaitMs: number;
  challengePollMs: number;
  debug: boolean;
  dryRun: boolean;
  logLevel: LogLevel;
}

export interface CliOverrides {
  headless?: boolean;
  linksFile?: string;
  outputDir?: string;
  manufacturerSpecsFile?: string;
  manufacturerLookup?: boolean;
  concurrency?: number;
  limit?: number | null;
  respectRobots?: boolean;
  manualChallengeWait?: boolean;
  debug?: boolean;
  dryRun?: boolean;
  help?: boolean;
  version?: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "silent"];

function loadDotEnv(cwd: string): void {
  const envPath = resolve(cwd, ".env");
  if (!existsSync(envPath)) return;
  const proc = process as NodeJS.Process & {
    loadEnvFile?: (path?: string) => void;
  };
  if (typeof proc.loadEnvFile !== "function") {
    throw new ConfigError(
      "This Node.js version does not support process.loadEnvFile. Use Node.js >= 20.12 or remove .env and export variables directly.",
    );
  }
  proc.loadEnvFile(envPath);
}

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function envBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ConfigError(`${name} must be a boolean (true/false). Got: ${raw}`);
}

function envInteger(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${name} must be an integer. Got: ${raw}`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}. Got: ${value}`);
  }
  return value;
}

function takeValue(args: string[], index: number, flag: string): string {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    throw new ConfigError(`Missing value for ${flag}`);
  }
  return next;
}

export function parseCliArgs(argv: string[]): CliOverrides {
  const overrides: CliOverrides = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw) continue;
    const [flag, inlineValue] = raw.includes("=")
      ? [raw.slice(0, raw.indexOf("=")), raw.slice(raw.indexOf("=") + 1)]
      : [raw, undefined];

    switch (flag) {
      case "--help":
      case "-h":
        overrides.help = true;
        break;
      case "--version":
      case "-v":
        overrides.version = true;
        break;
      case "--headed":
        overrides.headless = false;
        break;
      case "--headless":
        overrides.headless = true;
        break;
      case "--dry-run":
        overrides.dryRun = true;
        break;
      case "--debug":
        overrides.debug = true;
        break;
      case "--no-robots":
        overrides.respectRobots = false;
        break;
      case "--no-challenge-wait":
        overrides.manualChallengeWait = false;
        break;
      case "--no-manufacturer":
        overrides.manufacturerLookup = false;
        break;
      case "--links": {
        const value = inlineValue ?? takeValue(argv, i, flag);
        if (!inlineValue) i += 1;
        overrides.linksFile = value;
        break;
      }
      case "--output": {
        const value = inlineValue ?? takeValue(argv, i, flag);
        if (!inlineValue) i += 1;
        overrides.outputDir = value;
        break;
      }
      case "--manufacturer-specs": {
        const value = inlineValue ?? takeValue(argv, i, flag);
        if (!inlineValue) i += 1;
        overrides.manufacturerSpecsFile = value;
        break;
      }
      case "--concurrency": {
        const value = inlineValue ?? takeValue(argv, i, flag);
        if (!inlineValue) i += 1;
        overrides.concurrency = Number(value);
        break;
      }
      case "--limit": {
        const value = inlineValue ?? takeValue(argv, i, flag);
        if (!inlineValue) i += 1;
        overrides.limit = Number(value);
        break;
      }
      default:
        throw new ConfigError(`Unknown option: ${raw}`);
    }
  }
  return overrides;
}

export function loadConfig(argv: string[] = process.argv.slice(2)): AppConfig {
  const cwd = process.cwd();
  loadDotEnv(cwd);
  const overrides = parseCliArgs(argv);

  const minDelayMs = envInteger("MIN_DELAY_MS", 4000, 0, 300_000);
  const maxDelayMs = envInteger("MAX_DELAY_MS", 8000, 0, 300_000);
  if (minDelayMs > maxDelayMs) {
    throw new ConfigError("MIN_DELAY_MS must be less than or equal to MAX_DELAY_MS.");
  }

  const concurrency = overrides.concurrency ?? envInteger("CONCURRENCY", 1, 1, 3);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new ConfigError("CONCURRENCY must be an integer between 1 and 3.");
  }

  const limit = overrides.limit ?? null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    throw new ConfigError("--limit must be an integer between 1 and 100.");
  }

  const logLevelRaw = envString("LOG_LEVEL", "info").toLowerCase();
  if (!LOG_LEVELS.includes(logLevelRaw as LogLevel)) {
    throw new ConfigError(
      `LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}. Got: ${logLevelRaw}`,
    );
  }

  const browserChannelRaw = envString("BROWSER_CHANNEL", "");

  return {
    cwd,
    linksFile: resolve(
      cwd,
      overrides.linksFile ?? envString("LINKS_FILE", "data/laptop-links.txt"),
    ),
    outputDir: resolve(
      cwd,
      overrides.outputDir ?? envString("OUTPUT_DIR", "output"),
    ),
    manufacturerSpecsFile: resolve(
      cwd,
      overrides.manufacturerSpecsFile ??
        envString("MANUFACTURER_SPECS_FILE", "data/manufacturer-specs.json"),
    ),
    manufacturerLookup: overrides.manufacturerLookup ?? true,
    headless: overrides.headless ?? envBoolean("HEADLESS", false),
    concurrency,
    minDelayMs,
    maxDelayMs,
    navTimeoutMs: envInteger("NAV_TIMEOUT_MS", 45_000, 5_000, 180_000),
    navRetries: envInteger("NAV_RETRIES", 2, 0, 5),
    retryBaseDelayMs: envInteger("RETRY_BASE_DELAY_MS", 3000, 0, 60_000),
    maxProducts: envInteger("MAX_PRODUCTS", 30, 1, 100),
    limit,
    browserChannel: browserChannelRaw === "" ? null : browserChannelRaw,
    slowMoMs: envInteger("SLOW_MO_MS", 0, 0, 10_000),
    blockImages: envBoolean("BLOCK_IMAGES", false),
    respectRobots: overrides.respectRobots ?? envBoolean("RESPECT_ROBOTS", true),
    blockThreshold: envInteger("BLOCK_THRESHOLD", 2, 1, 10),
    manualChallengeWait:
      overrides.manualChallengeWait ??
      envBoolean("WAIT_FOR_MANUAL_CHALLENGE", true),
    challengeWaitMs: envInteger("CHALLENGE_WAIT_MS", 600_000, 10_000, 3_600_000),
    challengePollMs: envInteger("CHALLENGE_POLL_MS", 2_500, 500, 30_000),
    debug: overrides.debug ?? envBoolean("DEBUG", false),
    dryRun: overrides.dryRun ?? false,
    logLevel: logLevelRaw as LogLevel,
  };
}

export function publicConfig(config: AppConfig): import("./types.js").PublicConfig {
  return {
    headless: config.headless,
    concurrency: config.concurrency,
    minDelayMs: config.minDelayMs,
    maxDelayMs: config.maxDelayMs,
    navTimeoutMs: config.navTimeoutMs,
    navRetries: config.navRetries,
    maxProducts: config.maxProducts,
    respectRobots: config.respectRobots,
    manufacturerLookup: config.manufacturerLookup,
    browserChannel: config.browserChannel,
    manualChallengeWait: config.manualChallengeWait,
  };
}

export const HELP_TEXT = `Amazon India laptop comparison

Usage:
  npm run compare
  npm run compare -- [options]

Options:
  --headed                 Show the browser window (default)
  --headless               Run without a browser window
  --links <path>           Link file (default: data/laptop-links.txt)
  --output <path>          Output directory (default: output)
  --manufacturer-specs <path>
                           Curated manufacturer specification file
  --no-manufacturer        Skip manufacturer specification overrides
  --concurrency <1-3>      Concurrent product pages (default: 1)
  --limit <n>              Process at most n products this run
  --dry-run                Parse links and print a summary without browsing
  --no-robots              Skip the robots.txt preflight check
  --no-challenge-wait      Do not wait for a manual CAPTCHA/login solve
  --debug                  Save debug screenshots/HTML for failures
  --help                   Show this help
  --version                Show the version

Environment variables are documented in .env.example and README.md.
`;
