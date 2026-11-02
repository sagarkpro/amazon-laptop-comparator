import type { LogLevel } from "./config.js";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const COLORS = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
};

function useColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

function paint(text: string, color: keyof typeof COLORS): string {
  return useColor() ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

export class Logger {
  private readonly threshold: number;

  constructor(level: LogLevel) {
    this.threshold = LEVEL_WEIGHT[level];
  }

  debug(message: string, detail?: string): void {
    if (this.threshold <= LEVEL_WEIGHT.debug) {
      this.write("debug", message, detail);
    }
  }

  info(message: string, detail?: string): void {
    if (this.threshold <= LEVEL_WEIGHT.info) {
      this.write("info", message, detail);
    }
  }

  warn(message: string, detail?: string): void {
    if (this.threshold <= LEVEL_WEIGHT.warn) {
      this.write("warn", message, detail);
    }
  }

  error(message: string, detail?: string): void {
    if (this.threshold <= LEVEL_WEIGHT.error) {
      this.write("error", message, detail);
    }
  }

  private write(level: "debug" | "info" | "warn" | "error", message: string, detail?: string): void {
    const label = {
      debug: paint("debug", "dim"),
      info: paint("info", "cyan"),
      warn: paint("warn", "yellow"),
      error: paint("error", "red"),
    }[level];
    const line = `[${label}] ${message}${detail ? ` ${paint(detail, "dim")}` : ""}`;
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
