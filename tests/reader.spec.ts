import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("en");
});

test("sample, error isolation, views and range navigation", async ({
  page,
}) => {
  await page.getByText("Explore a sample").click();
  await expect(page.locator(".file-heading h1")).toContainText(
    "Untitled.jsonl",
  );
  await page
    .getByRole("button", { name: "Validate file", exact: false })
    .click();
  await expect(page.locator(".validation-fact strong")).toContainText("1");
  await page.getByRole("button", { name: "Raw line", exact: true }).click();
  await page.getByLabel("Find in visible records").fill("trace_04");
  await expect(page.locator(".record-error")).toContainText("incomplete");
  await page.getByLabel("Find in visible records").fill("trace_05");
  await expect(page.locator(".record-raw")).toContainText("9007199254740993");
  await page.getByLabel("Find in visible records").fill("");
  await page.getByRole("button", { name: "Pretty", exact: true }).click();
  await page.locator(".reader").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator('[data-line="5"] .record-raw')).toContainText(
    "9007199254740993",
  );
  await page.getByLabel("From line").fill("3");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page.locator(".statusbar")).toContainText("3–5");
});

test("paste array, lazy tree and locale/theme preferences", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Paste", exact: true })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "JSON, a JSON array", exact: false })
    .fill(
      JSON.stringify([
        { items: Array.from({ length: 120 }, (_, i) => i) },
        false,
      ]),
    );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator(".file-facts")).toContainText("2 lines");
  await expect(
    page.getByRole("button", { name: "Load 50 more", exact: false }),
  ).toHaveCount(0);
  await page
    .locator(".tree-scroll")
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await page
    .getByRole("button", { name: "Load 50 more", exact: false })
    .click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("Language").selectOption("zh");
  await expect(
    page.getByRole("button", { name: "打开文件", exact: false }),
  ).toBeVisible();
});

test("record fold, recursive node fold and copy menu", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByText("Explore a sample").click();
  const card = page.locator('[data-line="1"]');
  await card
    .getByRole("button", { name: "Collapse messages", exact: true })
    .click({ modifiers: ["Alt"] });
  await expect(
    card.getByRole("button", { name: "Expand messages", exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Expand messages", exact: true })
    .click({ modifiers: ["Alt"] });
  await card.getByRole("button", { name: "Copy id", exact: true }).click();
  await card.getByRole("menuitem", { name: "Copy JSONPath" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('$["id"]');
  await card
    .locator(".record-header")
    .getByRole("button", { name: "Collapse 1", exact: true })
    .click();
  await expect(card.locator(".tree-scroll")).toHaveCount(0);
});
