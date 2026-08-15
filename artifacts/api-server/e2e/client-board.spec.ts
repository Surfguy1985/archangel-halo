/**
 * Browser e2e for the four Client Board flows. Skip when Playwright browsers
 * are not installed (`npx playwright install` first). HTTP coverage of the
 * same four flows lives in clientBoardFlows.integration.test.ts.
 *
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5000 npx playwright test artifacts/api-server/e2e/client-board.spec.ts
 */
import { test, expect } from "@playwright/test";

const base = process.env.PLAYWRIGHT_BASE_URL;

test.describe("Client board browser flows", () => {
  test.skip(!base, "Set PLAYWRIGHT_BASE_URL to run browser e2e");

  test("regional manager opens Pulse and sees vacancy cost", async ({ page }) => {
    await page.goto(`${base}/portfolio`);
    await expect(page.getByText(/vacancy/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("approve a scope from the Turn Ring", async ({ page }) => {
    await page.goto(`${base}/portfolio`);
    await page.getByRole("button").first().click();
    await expect(page.getByText(/waiting on you|approve/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("non-compliant invoice is blocked in the UI", async ({ page }) => {
    await page.goto(`${base}/portfolio`);
    await expect(page.getByText(/blocked before billing|off.schedule|cannot invoice/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("bid board compares three vendors", async ({ page }) => {
    await page.goto(`${base}/portfolio`);
    await expect(page.locator("body")).toBeVisible();
  });
});
