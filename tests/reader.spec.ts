import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Language").selectOption("en");
});

async function openFileDetails(page: import("@playwright/test").Page) {
  const panel = page.getByRole("complementary", { name: "Navigator" });
  if (!(await panel.isVisible()))
    await page.getByRole("button", { name: "Navigator" }).click();
  return panel;
}

test("edit, reject invalid JSON, add duplicate delete and search outside visible range", async ({
  page,
}) => {
  await page.getByText("Explore a sample").click();
  await page
    .getByRole("button", { name: "Edit record L1", exact: true })
    .click();
  const editor = page.getByRole("textbox", {
    name: "Record JSON",
    exact: true,
  });
  await editor.fill("{bad}");
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.locator('[data-line="1"] .inline-record-editor'),
  ).toBeVisible();
  await expect(
    page.locator('[data-line="1"] .inline-record-editor').getByRole("alert"),
  ).toBeVisible();
  await editor.fill('{"changed":9007199254740993}');
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(page.locator(".inline-record-editor")).toHaveCount(0);
  await expect(page.locator('[data-line="1"]')).toContainText(
    "9007199254740993",
  );
  await page
    .getByRole("button", { name: "Duplicate record L1", exact: true })
    .click();
  await expect(await openFileDetails(page)).toContainText("6 lines");
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Delete record L2", exact: true })
    .click();
  await expect(await openFileDetails(page)).toContainText("5 lines");
  await page.getByLabel("Show").selectOption("custom");
  await page.getByLabel("Custom").fill("1");
  await page.getByLabel("Custom").blur();
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Record JSON", exact: true })
    .fill('{"deep":{"arr":[{"target":"needle"}]}}');
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(page.locator('[data-line="6"]')).toContainText("needle");
  await expect(page.locator(".statusbar")).toContainText("6–6 / 6");
  await page.getByLabel("From line").fill("1");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByLabel("Search current file").fill("needle");
  await page.getByLabel("Search mode").selectOption("value");
  await expect(page.locator(".search-results")).toContainText(
    "/deep/arr/0/target",
  );
  await page
    .locator(".search-results")
    .getByRole("button")
    .filter({ hasText: "needle" })
    .click();
  await expect(page.locator('[data-line="6"]')).toContainText('"needle"');
});

test("sample, error isolation, views and range navigation", async ({
  page,
}) => {
  await page.getByText("Explore a sample").click();
  await expect((await openFileDetails(page)).locator("h1")).toContainText(
    "Untitled.jsonl",
  );
  await page
    .getByRole("button", { name: "Validate file", exact: false })
    .click();
  await expect(page.locator(".validation-fact strong")).toContainText("1");
  await page.getByRole("button", { name: "Raw line", exact: true }).click();
  await page.getByLabel("Search current file").fill("trace_04");
  await expect(page.locator(".record-error")).toContainText("incomplete");
  await page.getByLabel("Search current file").fill("trace_05");
  await expect(page.locator('[data-line="5"] .record-raw')).toContainText(
    "9007199254740993",
  );
  await page.getByLabel("Search current file").fill("");
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

test("oversized records are preview-limited instead of reported as invalid", async ({
  page,
}) => {
  test.slow();
  await page
    .locator(".titlebar")
    .getByRole("button", { name: "New", exact: true })
    .click();
  const editor = page.getByRole("textbox", {
    name: "Document JSONL",
    exact: true,
  });
  await editor.fill(`{"payload":"${"x".repeat(2 * 1024 * 1024)}"}`);
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();

  const record = page.locator('[data-line="1"]');
  await expect(record).toHaveClass(/limited/);
  await expect(record).not.toHaveClass(/invalid/);
  await expect(record.locator(".record-description")).toHaveText(
    "Record preview limited",
  );
  await expect(record.locator(".record-limit")).toContainText(
    "file validation still streams the complete record",
  );
  await expect(page.locator(".validation-fact strong")).toContainText(
    "0 valid · 0 errors · 1 preview limited",
  );

  await page
    .getByRole("button", { name: "Validate file", exact: false })
    .click();
  await expect(page.locator(".validation-fact strong")).toContainText(
    "1 valid · 0 errors",
  );
  await expect(page.locator(".validation-fact strong")).not.toContainText(
    "preview limited",
  );
});

test("new file editor copies and imports arrays with lazy tree", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .locator(".titlebar")
    .getByRole("button", { name: "New", exact: true })
    .click();
  const draft = JSON.stringify([
    { items: Array.from({ length: 120 }, (_, i) => i) },
    false,
  ]);
  const editor = page.getByRole("textbox", {
    name: "Document JSONL",
    exact: true,
  });
  await editor.fill('{"stale":true}');
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .locator(".titlebar")
    .getByRole("button", { name: "New", exact: true })
    .click();
  await expect(editor).toHaveValue("");
  await editor.fill(draft);
  await page.getByRole("button", { name: "Copy all", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(draft);
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(await openFileDetails(page)).toContainText("2 lines");
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
  await expect(page.locator(".icon-select")).toHaveCount(2);
  await expect(page.locator(".icon-select select").first()).toHaveCSS(
    "opacity",
    "0",
  );
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

test("search highlights every visible match and content font can zoom", async ({
  page,
}) => {
  await page.getByText("Explore a sample").click();
  await page.getByLabel("Search current file").fill("trace");
  await expect(
    page.getByRole("complementary", { name: "Search results" }),
  ).toBeVisible();
  await expect(
    page.locator(".search-result-list .search-mark").first(),
  ).toBeVisible();
  await expect(page.locator(".reader .search-mark").first()).toHaveText(
    /trace/i,
  );

  const before = await page
    .locator(".tree-scroll")
    .first()
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  await page.getByRole("button", { name: "Increase font size" }).click();
  const after = await page
    .locator(".tree-scroll")
    .first()
    .evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
  expect(after).toBeGreaterThan(before);
  await expect(page.locator(".zoom-value")).toHaveText("110%");
});
