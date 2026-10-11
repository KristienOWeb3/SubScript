import { test, expect } from "@playwright/test";
import { dashboardBundle } from "./fixtures/dashboard-render";

let script: string;
test.beforeAll(async () => { script = await dashboardBundle("src/app/not-found.tsx"); });

for (const host of ["dashboard", "pay", "admin", "docs", "www"]) {
    test(`404 Return Home leaves the ${host} host for the public homepage`, async ({ page }) => {
        // Render the real component and intercept documents so the test stays offline.
        await page.route("https://*.subscriptonarc.com/**", route => route.fulfill({
            contentType: "text/html", body: "<!doctype html><div id='root'></div>",
        }));
        await page.goto(`https://${host}.subscriptonarc.com/missing-page`);
        await page.addScriptTag({ content: script });
        await expect(page.getByRole("link", { name: "Open Dashboard" })).toHaveAttribute("href", "https://dashboard.subscriptonarc.com/dashboard-router");
        await expect(page.getByRole("link", { name: "Help & Support" })).toHaveAttribute("href", "https://www.subscriptonarc.com/support");
        await page.getByRole("link", { name: "Return Home" }).click();
        await expect(page).toHaveURL("https://www.subscriptonarc.com/");
    });
}
