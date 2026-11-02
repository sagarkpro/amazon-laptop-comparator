import { readFileSync } from "node:fs";
import type { Page } from "playwright";
import type { PageSnapshot } from "../types.js";

/**
 * The page-side function is kept as plain JavaScript text so the TypeScript
 * bundler cannot inject helpers into a function that is serialized into the
 * browser context.
 */
const PAGE_FUNCTION_SOURCE = readFileSync(
  new URL("./snapshot-page.txt", import.meta.url),
  "utf8",
);

async function expandBankOfferSheet(page: Page): Promise<boolean> {
  try {
    const alreadyLoaded = await page
      .locator("#InstantBankDiscount .vsx-offers-desktop-lv__item p")
      .count();
    if (alreadyLoaded > 0) return true;

    const trigger = page
      .locator('#itembox-InstantBankDiscount [data-action="side-sheet"]')
      .first();
    if ((await trigger.count()) === 0) return false;
    if (!(await trigger.isVisible().catch(() => false))) return false;

    await trigger.click({ timeout: 4000 }).catch(() => undefined);
    await page
      .waitForSelector("#InstantBankDiscount .vsx-offers-desktop-lv__item p", {
        timeout: 6000,
      })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    return (
      (await page
        .locator("#InstantBankDiscount .vsx-offers-desktop-lv__item p")
        .count()) > 0
    );
  } catch {
    return false;
  }
}

async function closeBankOfferSheet(page: Page): Promise<void> {
  try {
    const sheet = page.locator("#InstantBankDiscount").first();
    if ((await sheet.count()) === 0) return;
    if (!(await sheet.isVisible().catch(() => false))) return;
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(200);
  } catch {
    // Navigation will clear any leftover overlay.
  }
}

export async function captureSnapshot(
  page: Page,
  requestedUrl: string,
  httpStatus: number | null,
): Promise<PageSnapshot> {
  const expanded = await expandBankOfferSheet(page);
  try {
    const args = JSON.stringify({ requestedUrl, httpStatus });
    const expression = `(${PAGE_FUNCTION_SOURCE})(${args})`;
    const snapshot = await page.evaluate(expression);
    return snapshot as PageSnapshot;
  } finally {
    if (expanded) await closeBankOfferSheet(page);
  }
}
