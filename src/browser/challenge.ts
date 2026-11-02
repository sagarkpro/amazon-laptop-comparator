import type { Page } from "playwright";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface ChallengeState {
  active: boolean;
  kind: "captcha" | "sign_in" | null;
}

async function inspectChallenge(page: Page): Promise<ChallengeState> {
  if (page.isClosed()) return { active: false, kind: null };

  const url = page.url();
  const title = await page.title().catch(() => "");
  const body = await page
    .locator("body")
    .innerText({ timeout: 2500 })
    .catch(() => "");
  const lowerUrl = url.toLowerCase();
  const sample = `${title}\n${body.slice(0, 8000)}`.toLowerCase();

  const captcha =
    /validatecaptcha|\/errors\/validatecaptcha/i.test(url) ||
    /robot check/i.test(title) ||
    /enter the characters you see below|type the characters you see|sorry, we just need to make sure you're not a robot/i.test(
      sample,
    );

  const signInForm = await page
    .locator("form[name='signIn'], #ap_email")
    .first()
    .isVisible()
    .catch(() => false);
  const signIn =
    /\/(?:ap|gp)\/signin/i.test(lowerUrl) || Boolean(signInForm);

  if (captcha) return { active: true, kind: "captcha" };
  if (signIn) return { active: true, kind: "sign_in" };
  return { active: false, kind: null };
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
      // Ignore.
    }
  }
}

/**
 * Wait for the user to solve a CAPTCHA or complete a login in a visible
 * browser. The script never solves or bypasses the challenge itself.
 */
export async function waitForManualChallenge(
  page: Page,
  config: AppConfig,
  logger: Logger,
  reason: string,
  productUrl?: string,
): Promise<boolean> {
  if (!config.manualChallengeWait) return false;

  if (config.headless) {
    logger.warn(
      "Manual challenge detected in headless mode",
      "Run without --headless so the browser window is visible and you can solve it.",
    );
    return false;
  }

  const minutes = Math.max(1, Math.ceil(config.challengeWaitMs / 60_000));
  logger.warn(
    "MANUAL ACTION REQUIRED",
    `${reason === "sign_in_required" ? "Amazon is asking you to sign in" : "Amazon is showing a CAPTCHA"}. Solve it in the open browser window. Waiting up to ${minutes} minute(s); the run will continue automatically.`,
  );

  const started = Date.now();
  let lastLog = started;

  while (Date.now() - started < config.challengeWaitMs) {
    await wait(config.challengePollMs);

    if (page.isClosed()) {
      logger.warn("Browser was closed while waiting for the manual challenge");
      return false;
    }

    const state = await inspectChallenge(page);
    if (!state.active) {
      logger.info(
        "Challenge cleared",
        "Continuing with the product page after manual action",
      );
      await continueShoppingIfPresent(page);

      await page
        .waitForSelector("#productTitle, #ppd, #centerCol, #dp", {
          timeout: 12_000,
        })
        .catch(() => undefined);

      if (productUrl && !/\/dp\/[A-Z0-9]{10}/i.test(page.url())) {
        await page
          .goto(productUrl, { waitUntil: "domcontentloaded", timeout: config.navTimeoutMs })
          .catch(() => undefined);
        await page
          .waitForSelector("#productTitle, #ppd, #centerCol, #dp", {
            timeout: 10_000,
          })
          .catch(() => undefined);
      }
      return true;
    }

    const elapsed = Date.now() - started;
    if (elapsed - lastLog >= 30_000) {
      lastLog = Date.now();
      const remaining = Math.max(
        0,
        Math.ceil((config.challengeWaitMs - elapsed) / 60_000),
      );
      logger.info(
        "Still waiting for manual challenge",
        `${remaining} minute(s) remaining`,
      );
    }
  }

  logger.warn(
    "Timed out waiting for manual challenge",
    `No challenge completion detected within ${minutes} minute(s).`,
  );
  return false;
}
