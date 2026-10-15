import { defineConfig } from "@playwright/test";

const pages = process.env.PLAYWRIGHT_PAGES === "1";
const origin = pages ? "http://127.0.0.1:4173" : "http://127.0.0.1:1420";

export default defineConfig({
  testDir: "./tests",
  use: {
    channel: "chromium",
    baseURL: `${origin}${pages ? "/JSONL-Studio/" : "/"}`,
    viewport: { width: 1200, height: 820 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: pages
      ? "npm run preview -- --host 127.0.0.1 --port 4173 --base /JSONL-Studio/"
      : "npm run dev",
    url: `${origin}${pages ? "/JSONL-Studio/" : ""}`,
    reuseExistingServer: !process.env.CI,
  },
});
