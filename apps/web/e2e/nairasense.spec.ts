import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { parseLocallyOffline, SourceType } from "../src/lib/offlineParser";

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
    await expect(page.getByText("Your record has synchronised", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Go offline, add ₦200 -> queued in sync_queue
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ ₦200" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦700");
    await expect(page.getByText("Waiting for internet connection", { exact: true })).toBeVisible();

    // Reconnect and verify queue flushes without duplication
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText("Your record has synchronised", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
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
    await expect(page.getByText("Your record has synchronised", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Go offline, add ₦100, then delete ₦500
    await context.setOffline(true);
    await page.getByRole("button", { name: "+ ₦100" }).click();
    await page.getByRole("button", { name: "Remove Note 1, 500 Naira" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦100");
    await expect(page.getByText("Waiting for internet connection", { exact: true })).toBeVisible();

    // Reconnect and reload page -> pending ₦100 and deletion of ₦500 must both persist
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByText(`Signed in: ${user}`)).toBeVisible();
    await expect(page.getByText("Your record has synchronised", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
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

  test("Camera permission denied surfaces upload fallback cleanly", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
        },
        configurable: true,
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Start live camera" }).click();
    await expect(page.locator("p[role='alert']")).toContainText("Camera permission was denied");
    await expect(page.getByRole("button", { name: "+ ₦500" })).toBeVisible();
  });

  test("Logout during in-flight entry write does not leak into next user", async ({ page }) => {
    const suffix = Date.now();
    const userA = `inflight_a_${suffix}`;
    const userB = `inflight_b_${suffix}`;

    await page.goto("/");
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).first().click();
    await page.getByLabel("Username").fill(userA);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userA}`)).toBeVisible();

    // Delay entry POST so User A logs out while request is in flight
    await page.route("**/api/v1/cash/sessions/*/entries", async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });

    await page.getByRole("button", { name: "+ ₦500" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦0");

    // Sign in as User B immediately and verify User A's in-flight write does not leak
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).first().click();
    await page.getByLabel("Username").fill(userB);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userB}`)).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator(".total-amount")).toHaveText("₦0");
  });

  test("Logout during in-flight deletion does not leak into next user", async ({ page }) => {
    const suffix = Date.now();
    const userA = `del_inflight_a_${suffix}`;
    const userB = `del_inflight_b_${suffix}`;

    await page.goto("/");
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).first().click();
    await page.getByLabel("Username").fill(userA);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userA}`)).toBeVisible();

    await page.getByRole("button", { name: "+ ₦500" }).click();
    await expect(page.getByText("Your record has synchronised", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Delay DELETE so User A logs out while deletion is in flight
    await page.route("**/api/v1/cash/entries/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await new Promise((r) => setTimeout(r, 400));
      }
      await route.continue();
    });

    const deleteCompleted = page.waitForResponse(
      (res) => res.url().includes("/api/v1/cash/entries/") && res.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "Remove Note 1, 500 Naira" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.locator(".total-amount")).toHaveText("₦0");
    const delRes = await deleteCompleted;
    expect(delRes.status()).toBe(204);

    // Sign in as User B and add ₦200; User A's delayed delete must not affect User B
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.getByRole("button", { name: "Create account" }).first().click();
    await page.getByLabel("Username").fill(userB);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userB}`)).toBeVisible();

    await page.getByRole("button", { name: "+ ₦200" }).click();
    await expect(page.getByText("Your record has synchronised", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(".total-amount")).toHaveText("₦200");

    // Sign back in as User A and reload -> deletion remains persisted on server
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign in / Sync" }).click();
    await page.locator("form.auth-form").getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Username").fill(userA);
    await page.getByLabel("Password (8+ characters)").fill("password123");
    await page.locator("form.auth-form button[type='submit']").click();
    await expect(page.getByText(`Signed in: ${userA}`)).toBeVisible();
    await page.reload();
    await expect(page.getByText(`Signed in: ${userA}`)).toBeVisible();
    await expect(page.locator(".total-amount")).toHaveText("₦0");
  });

  test("Online and offline transaction parsers separate direction from outcome", async ({
    page,
    context,
  }) => {
    const alertText = "Your account has been debited NGN 5,000. Transaction successful.";
    await page.goto("/");
    await page.getByRole("tab", { name: "TransactionSense" }).click();

    // Online extraction via backend
    await page.getByLabel("Alert or receipt text").fill(alertText);
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.getByLabel("Transaction direction")).toHaveValue("Debit");
    await expect(page.getByLabel("Reported outcome")).toHaveValue("Successful");

    // Offline fallback extraction
    await context.setOffline(true);
    await page.getByLabel("Alert or receipt text").fill(alertText);
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.getByLabel("Transaction direction")).toHaveValue("Debit");
    await expect(page.getByLabel("Reported outcome")).toHaveValue("Successful");

    // Negation handling offline & online
    const negatedText = "Debit of NGN 5,000.00 was not successful.";
    await page.getByLabel("Alert or receipt text").fill(negatedText);
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.getByLabel("Transaction direction")).toHaveValue("Debit");
    await expect(page.getByLabel("Reported outcome")).toHaveValue("Failed");

    await context.setOffline(false);
    await page.getByLabel("Alert or receipt text").fill(negatedText);
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.getByLabel("Transaction direction")).toHaveValue("Debit");
    await expect(page.getByLabel("Reported outcome")).toHaveValue("Failed");

    // Negated reversal ("not reversed") must not report Reversed offline or online
    const notReversedText = "Debit NGN 5,000.00 failed; transaction was not reversed.";
    await page.getByLabel("Alert or receipt text").fill(notReversedText);
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.getByLabel("Reported outcome")).toHaveValue("Failed");

    await context.setOffline(true);
    await page.getByLabel("Alert or receipt text").fill(notReversedText);
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.getByLabel("Reported outcome")).toHaveValue("Failed");
    await context.setOffline(false);
  });

  test("Online and offline parsers match across all shared Nigerian bank fixtures and alert on ambiguity", async ({
    page,
    request,
  }) => {
    const fixturesPath = path.resolve(
      __dirname,
      "../../../services/api/tests/fixtures/transaction_messages/nigerian_alerts.json",
    );
    const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf-8")) as Array<{
      name: string;
      source_type: SourceType;
      raw_text: string;
      expected: {
        amount_kobo: number | null;
        reported_status: string | null;
        transaction_direction: string | null;
        reference: string | null;
        multiple_amounts_detected: boolean;
      };
    }>;

    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";
    for (const fx of fixtures) {
      const offline = parseLocallyOffline(fx.raw_text, fx.source_type);
      const apiRes = await request.post(`${apiBase}/transactions/extract`, {
        data: { raw_text: fx.raw_text, source_type: fx.source_type },
      });
      expect(apiRes.status(), fx.name).toBe(200);
      const online = await apiRes.json();

      expect(offline.amount_kobo, `${fx.name} offline amount`).toBe(fx.expected.amount_kobo);
      expect(online.amount_kobo, `${fx.name} online amount`).toBe(fx.expected.amount_kobo);
      expect(offline.reported_status, `${fx.name} offline status`).toBe(fx.expected.reported_status);
      expect(online.reported_status, `${fx.name} online status`).toBe(fx.expected.reported_status);
      expect(offline.reference, `${fx.name} parity reference`).toBe(online.reference);
      expect(offline.sender_label, `${fx.name} parity sender`).toBe(online.sender_label);
      expect(offline.recipient_label, `${fx.name} parity recipient`).toBe(online.recipient_label);
      expect(offline.transaction_date, `${fx.name} parity date`).toBe(online.transaction_date);
      expect(offline.extracted_fields.transaction_direction, `${fx.name} offline direction`).toBe(
        fx.expected.transaction_direction,
      );
      expect(online.extracted_fields.transaction_direction, `${fx.name} online direction`).toBe(
        fx.expected.transaction_direction,
      );
      expect(
        offline.extracted_fields.multiple_amounts_detected,
        `${fx.name} offline multi-amt`,
      ).toBe(fx.expected.multiple_amounts_detected);
      expect(
        online.extracted_fields.multiple_amounts_detected,
        `${fx.name} online multi-amt`,
      ).toBe(fx.expected.multiple_amounts_detected);
      expect(offline.extracted_fields.candidate_amounts_ngn, `${fx.name} parity amounts`).toEqual(
        online.extracted_fields.candidate_amounts_ngn,
      );
      expect(
        offline.extracted_fields.ambiguous_status_detected,
        `${fx.name} parity ambiguous flag`,
      ).toBe(online.extracted_fields.ambiguous_status_detected);
      expect(offline.extracted_fields.candidate_statuses, `${fx.name} parity candidate statuses`).toEqual(
        online.extracted_fields.candidate_statuses,
      );
    }

    // Verify ambiguous outcome surfaces an explicit alert banner to assistive tech
    await page.goto("/");
    await page.getByRole("tab", { name: "TransactionSense" }).click();
    await page
      .getByLabel("Alert or receipt text")
      .fill("Debit NGN 5,000.00 successful, but reversal pending.");
    await page.getByRole("button", { name: "Extract fields for review" }).click();
    await expect(page.locator("#panel-transactions p[role='alert']")).toContainText(
      "Conflicting outcome words were detected",
    );
  });
});
