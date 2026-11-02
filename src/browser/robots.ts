import { Logger } from "../logger.js";

export interface RobotsRules {
  checked: boolean;
  sourceUrl: string;
  allowed: (url: string) => boolean;
  error?: string;
}

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

function parseRobots(content: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  const finish = () => {
    if (current && current.agents.length > 0 && current.rules.length > 0) {
      groups.push(current);
    }
    current = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line === "") {
      finish();
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (current && current.rules.length > 0) finish();
      if (!current) current = { agents: [], rules: [] };
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!current) current = { agents: [], rules: [] };
      if (value !== "") {
        current.rules.push({ allow: field === "allow", pattern: value });
      }
    }
  }
  finish();
  return groups;
}

function patternToRegex(pattern: string): RegExp {
  let escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  escaped = escaped.replace(/\*/g, ".*");
  if (pattern.endsWith("$")) {
    escaped = `${escaped.slice(0, -2)}$`;
  }
  return new RegExp(`^${escaped}`);
}

function isAllowedByGroups(url: string, groups: Group[]): boolean {
  const target = new URL(url);
  const path = `${target.pathname}${target.search}`;
  const applicable = groups.filter((group) => group.agents.includes("*"));
  if (applicable.length === 0) return true;

  let best: Rule | null = null;
  let bestLength = -1;
  for (const group of applicable) {
    for (const rule of group.rules) {
      if (!patternToRegex(rule.pattern).test(path)) continue;
      const length = rule.pattern.length;
      if (length > bestLength || (length === bestLength && rule.allow && !best?.allow)) {
        best = rule;
        bestLength = length;
      }
    }
  }
  return best ? best.allow : true;
}

export async function loadRobotsRules(
  enabled: boolean,
  logger: Logger,
): Promise<RobotsRules> {
  const sourceUrl = "https://www.amazon.in/robots.txt";
  if (!enabled) {
    return { checked: false, sourceUrl, allowed: () => true };
  }

  try {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const content = await response.text();
    const groups = parseRobots(content);
    logger.info("Robots.txt checked", `${groups.length} rule groups parsed`);
    return {
      checked: true,
      sourceUrl,
      allowed: (url: string) => isAllowedByGroups(url, groups),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      "Could not check robots.txt; continuing without a robots gate",
      message,
    );
    return {
      checked: false,
      sourceUrl,
      allowed: () => true,
      error: message,
    };
  }
}
