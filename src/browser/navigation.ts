import type { Page } from "playwright";
import type { AppConfig } from "../config.js";
import { Logger, describeError } from "../logger.js";
import { waitForManualChallenge } from "./challenge.js";

export interface NavigationResult {
  ok: boolean;
  status: number | null;
  finalUrl: string;
  attempts: number;
  blocked: boolean;
  blockedReason: string | null;
  unavailable: boolean;
  error: string | null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function continueShoppingIfPresent(page: Page): Promise<void> {
  const candidates = [
    page.getByRole("button", { name: /continue shopping/i }),
    page.getByRole("link", { name: /continue shopping/i }),
  ];
  for (const locator of candidates) {
    try {
      if ((await locator.count()) === 0) continue;
      const first = locator.first();
      if (!(await first.isVisible().catch(() => false))) continue;
      await first.click({ timeout: 2500 });
      await page.waitForTimeout(700);
      return;
    } catch {
      // Ignore benign interstitial handling failures and let extraction report.
    }
  }
}

interface PageInspection {
  blockedReason: string | null;
  notFound: boolean;
  isCaptcha: boolean;
  isSignIn: boolean;
}

async function inspectPage(page: Page, status: number | null): Promise<PageInspection> {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const body = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const sample = `${title}\n${body.slice(0, 7000)}`.toLowerCase();

  const isCaptcha =
    /validatecaptcha|\/errors\/validatecaptcha/i.test(url) ||
    /robot check|enter the characters you see below|type the characters you see/i.test(
      sample,
    ) ||
    /sorry, we just need to make sure you're not a robot/i.test(sample);

  const isSignIn =
    /\/(?:ap|gp)\/signin/i.test(url) ||
    (await page
      .locator("form[name='signIn'], #ap_email")
      .first()
      .isVisible()
      .catch(() => false));

  const notFound =
    status === 404 ||
    /\/errors\/404/i.test(url) ||
    /page not found|we couldn't find that page|looking for something\?/i.test(
      `${title}\n${body.slice(0, 2000)}`,
    );

  if (isCaptcha || /robot check/i.test(title)) {
    return { blockedReason: "captcha_or_robot_check", notFound, isCaptcha, isSignIn };
  }
  if (isSignIn) {
    return { blockedReason: "sign_in_required", notFound, isCaptcha, isSignIn };
  }
  if (status === 401) {
    return { blockedReason: "http_401_unauthorized", notFound, isCaptcha, isSignIn };
  }
  if (status === 403) {
    return { blockedReason: "http_403_forbidden", notFound, isCaptcha, isSignIn };
  }
  if (status === 429) {
    return { blockedReason: "http_429_rate_limited", notFound, isCaptcha, isSignIn };
  }
  return { blockedReason: null, notFound, isCaptcha, isSignIn };
}

export async function gotoWithRetry(
  page: Page,
  url: string,
  config: AppConfig,
  logger: Logger,
): Promise<NavigationResult> {
  const maxAttempts = config.navRetries + 1;
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const backoff =
        config.retryBaseDelayMs * 2 ** (attempt - 2) + Math.floor(Math.random() * 500);
      logger.debug(`Retrying navigation (${attempt}/${maxAttempts})`, `waiting ${backoff}ms`);
      await sleep(backoff);
    }

    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: config.navTimeoutMs,
      });
      lastStatus = response?.status() ?? null;
      await continueShoppingIfPresent(page);

      let inspection = await inspectPage(page, lastStatus);
      if (
        inspection.blockedReason === "captcha_or_robot_check" ||
        inspection.blockedReason === "sign_in_required"
      ) {
        const solved = await waitForManualChallenge(
          page,
          config,
          logger,
          inspection.blockedReason,
          url,
        );
        if (solved) {
          inspection = await inspectPage(page, lastStatus);
        }
      }
      if (inspection.blockedReason) {
        return {
          ok: false,
          status: lastStatus,
          finalUrl: page.url(),
          attempts: attempt,
          blocked: true,
          blockedReason: inspection.blockedReason,
          unavailable: false,
          error: null,
        };
      }
      if (inspection.notFound) {
        return {
          ok: false,
          status: lastStatus,
          finalUrl: page.url(),
          attempts: attempt,
          blocked: false,
          blockedReason: null,
          unavailable: true,
          error: null,
        };
      }

      if (lastStatus !== null && lastStatus >= 500) {
        if (lastStatus === 503 && attempt === maxAttempts) {
          return {
            ok: false,
            status: lastStatus,
            finalUrl: page.url(),
            attempts: attempt,
            blocked: true,
            blockedReason: "http_503_service_unavailable",
            unavailable: false,
            error: null,
          };
        }
        if (attempt < maxAttempts) {
          logger.warn(`Amazon returned HTTP ${lastStatus}; will retry`);
          continue;
        }
        return {
          ok: false,
          status: lastStatus,
          finalUrl: page.url(),
          attempts: attempt,
          blocked: false,
          blockedReason: null,
          unavailable: false,
          error: `Amazon returned HTTP ${lastStatus}.`,
        };
      }

      await page
        .waitForSelector("#productTitle, #ppd, #centerCol, #dp", { timeout: 7000 })
        .catch(() => undefined);
      await page.waitForTimeout(350);

      return {
        ok: true,
        status: lastStatus,
        finalUrl: page.url(),
        attempts: attempt,
        blocked: false,
        blockedReason: null,
        unavailable: false,
        error: null,
      };
    } catch (error) {
      lastError = describeError(error);
      if (attempt < maxAttempts) {
        logger.warn(
          `Navigation attempt ${attempt}/${maxAttempts} failed; will retry`,
          lastError,
        );
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    status: lastStatus,
    finalUrl: page.url(),
    attempts: maxAttempts,
    blocked: false,
    blockedReason: null,
    unavailable: false,
    error: lastError ?? "Navigation failed for an unknown reason.",
  };
}
