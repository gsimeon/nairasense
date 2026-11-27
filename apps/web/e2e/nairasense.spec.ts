import { expect, test } from "@playwright/test";

test.describe("NairaSense Core & Reliability E2E", () => {
  test("CashSense deterministic totals and change calculation", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "+ ₦500" }).click();
    await page.getByRole("button", { name: "+ ₦1,000" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦1,500");

    await page.getByLabel("Change helper — item / bill amount (₦)").fill("1250");
    await expect(page.locator(".change-result")).toContainText("250 Naira");

    await page.getByRole("button", { name: "Remove Note 1, 500 Naira" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦1,000");
  });

  test("TransactionSense multi-amount requires explicit user selection", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "TransactionSense" }).click();

    await page
      .getByLabel("Alert or receipt text")
      .fill("Debit NGN 5,000.00. Fee: NGN 50.00. Avail Bal: NGN 25,000.00. Ref: E2E-100. Successful.");
    await page.getByRole("button", { name: "Extract fields for review" }).click();

    // Must NOT silently pre-fill the first amount when multiple amounts are present
    const amountInput = page.getByLabel("Amount (NGN)");
    await expect(amountInput).toHaveValue("");

    const candidateBtn = page.getByRole("button", { name: "₦5,000.00" });
    await expect(candidateBtn).toHaveAttribute("aria-pressed", "false");
    await candidateBtn.click();
    await expect(candidateBtn).toHaveAttribute("aria-pressed", "true");
    await expect(amountInput).toHaveValue("5000.00");

    await page.getByRole("button", { name: "Confirm & save record" }).click();
    await expect(page.getByText("Saved transaction records (1)")).toBeVisible();
  });

  test("Account-switch isolation and offline-to-online sync recovery", async ({ page, context }) => {
    const suffix = Date.now();
    const userA = `alice_${suffix}`;
    const userB = `bob_${suffix}`;

    await page.goto("/");

    // Register User A
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByLabel("Username").fill(userA);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userA}`)).toBeVisible();

    // Add ₦500 as User A while online and wait for sync
    await page.getByRole("button", { name: "+ ₦500" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦500");
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Go offline, add ₦200 -> queued in sync_queue
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ ₦200" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦700");
    await expect(page.getByText("1 pending sync")).toBeVisible();

    // Reconnect and verify queue flushes without duplication
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".total-amount")).toHaveText("₦700");

    // Sign out -> User A's records must clear immediately
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦0");

    // Register User B -> User B must NOT see User A's ₦700
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).first().click();
    await page.getByLabel("Username").fill(userB);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userB}`)).toBeVisible();
    await expect(page.locator(".total-amount")).toHaveText("₦0");
  });

  test("Offline pending queue survives browser reload and offline delete stays deleted", async ({
    page,
    context,
  }) => {
    const user = `restart_${Date.now()}`;
    await page.goto("/");

    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).first().click();
    await page.getByLabel("Username").fill(user);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${user}`)).toBeVisible();

    // Add ₦500 online first
    await page.getByRole("button", { name: "+ ₦500" }).click();
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Go offline, add ₦100, then delete ₦500
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ ₦100" }).click();
    await page.getByRole("button", { name: "Remove Note 1, 500 Naira" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦100");
    await expect(page.getByText("2 pending sync")).toBeVisible();

    // Reconnect and reload page -> pending ₦100 and deletion of ₦500 must both persist
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByText(`Signed in: ${user}`)).toBeVisible();
    await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".total-amount")).toHaveText("₦100");
  });

  test("Inference API failure announces error and never shows fake suggestion", async ({
    page,
  }) => {
    await page.route("**/api/v1/cash/infer", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"detail":"err"}' }),
    );
    await page.goto("/");

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await page.locator("input[type='file']").first().setInputFiles({
      name: "note.png",
      mimeType: "image/png",
      buffer: Buffer.from(pngBase64, "base64"),
    });
    await page.getByRole("button", { name: "Identify uploaded photo" }).click();

    await expect(page.getByRole("status")).toContainText("Could not check note");
    await expect(page.getByRole("heading", { name: "2. Review the suggestion" })).toHaveCount(0);
  });
});
