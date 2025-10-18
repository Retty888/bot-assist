import { expect, test } from "@playwright/test";

test.describe("Trading workstation UI", () => {
  test("executes default signal and shows contextual data", async ({ page }) => {
    await page.goto("/");

    const signalInput = page.locator("#signal");
    await expect(signalInput).toHaveValue(/Long BTC/, { timeout: 15_000 });

    const hintStatus = page.locator("#hint-status");
    await expect(hintStatus).toHaveText(/Recommendations updated|No actionable hints yet/i, {
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Execute Signal" }).click();

    const statusMessage = page.locator("#status-message");
    await expect(statusMessage).toHaveText(/Signal executed successfully/i, { timeout: 20_000 });
    await expect(page.locator("#status-mode")).toContainText(/Demo/i);
    await expect(page.locator("#parsed-signal")).toContainText('"symbol"');

    const historyItem = page.locator("#history-list li").first();
    await expect(historyItem).toBeVisible({ timeout: 10_000 });
  });
});
