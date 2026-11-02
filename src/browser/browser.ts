import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { AppConfig } from "../config.js";
import { Logger, describeError } from "../logger.js";

export async function launchBrowser(
  config: AppConfig,
  logger: Logger,
): Promise<Browser> {
  try {
    const browser = await chromium.launch({
      headless: config.headless,
      slowMo: config.slowMoMs,
      channel: config.browserChannel ?? undefined,
    });
    logger.info(
      "Browser launched",
      `${config.headless ? "headless" : "headed"}${config.browserChannel ? ` channel=${config.browserChannel}` : ""}`,
    );
    return browser;
  } catch (error) {
    throw new Error(
      `Could not launch Chromium: ${describeError(error)}. Run "npx playwright install chromium" (or set BROWSER_CHANNEL=chrome).`,
    );
  }
}

export async function createContext(
  browser: Browser,
  config: AppConfig,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en;q=0.9",
    },
  });

  if (config.blockImages) {
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") {
        return route.abort();
      }
      return route.continue();
    });
  }

  return context;
}

export async function createWorkerPage(
  context: BrowserContext,
  config: AppConfig,
): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(config.navTimeoutMs);
  page.on("dialog", (dialog) => {
    void dialog.dismiss().catch(() => undefined);
  });
  return page;
}

export async function closeQuietly(
  target: { close: () => Promise<void> } | null | undefined,
): Promise<void> {
  if (!target) return;
  try {
    await target.close();
  } catch {
    // Closing should never mask the original result.
  }
}
