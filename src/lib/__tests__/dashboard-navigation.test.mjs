import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

function source(path) {
    return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

test("user settings consistently uses the gear icon and account actions are safely placed", () => {
    const page = source("src/app/dashboard/user/page.tsx");
    const accountRoute = source("src/app/api/user/account/route.ts");

    assert.match(page, /\{ id: "dns", label: "Settings", icon: Settings \}/);
    assert.match(page, /<Settings className="h-5 w-5"/);
    assert.doesNotMatch(page, /\{ id: "dns", label: "Settings", icon: Sliders \}/);
    assert.match(page, /onClick=\{\(\) => void handleLogout\(\)\}[\s\S]{0,900}>Log out</);
    assert.match(page, /onClick=\{handleDeleteAccount\}[\s\S]{0,700}>[\s\S]*Delete account/);
    assert.match(page, /requiredMatchText: "DELETE"/);
    assert.match(page, /if \(logoutLoading\) return/);
    assert.match(page, /if \(deleteAccountLoading\) return/);
    assert.match(accountRoute, /\$transaction\(async \(tx\)/);
    const atomicErasure = accountRoute.slice(accountRoute.indexOf("$transaction(async (tx)"));
    assert.match(atomicErasure, /tx\.session\.deleteMany/);
    assert.match(atomicErasure, /UPDATE user_embedded_wallets/);
    assert.match(atomicErasure, /UPDATE auth_identities/);
    assert.match(atomicErasure, /closure_status = 'CLOSED'/);
});

test("merchant advanced controls live under settings and the legacy URL is canonicalized", () => {
    const page = source("src/app/dashboard/page.tsx");
    const nav = source("src/components/dashboard/MerchantDashboardNav.tsx");
    const upgrade = source("src/app/dashboard/upgrade/page.tsx");

    assert.doesNotMatch(nav, /onSelect\("advanced"\)/);
    assert.doesNotMatch(nav, />Advanced<\/span>/);
    assert.match(nav, /<Settings className="h-4 w-4 shrink-0"/);
    assert.match(page, /Advanced Settings stays inside Merchant Settings/);
    assert.match(page, /tab === "advanced"[\s\S]{0,500}params\.set\("tab", "settings"\)/);
    assert.match(page, /params\.set\("section", "advanced"\)/);
    assert.match(upgrade, /APP_ROUTES\.merchantAdvancedSettings/);
    assert.match(page, /<KycVerificationPendingIcon className="h-5 w-5"/);
});

test("merchant navigation keeps the visible tab and address bar in sync", () => {
    const page = source("src/app/dashboard/page.tsx");

    assert.match(page, /const replaceMerchantTabUrl = \(tab: TabId\)/);
    assert.match(page, /tab === "overview"[\s\S]{0,120}searchParams\.delete\("tab"\)/);
    assert.match(page, /searchParams\.set\("tab", tab === "advanced" \? "settings" : tab\)/);
    assert.match(page, /setActiveTab\(nextTab\);[\s\S]{0,100}replaceMerchantTabUrl\(nextTab\)/);
});

test("canonical dashboard destinations resolve to pages or intentional proxy aliases", () => {
    const routes = source("src/utils/navigation.ts");
    for (const expected of [
        'login: "/signin"',
        'signup: "/signup"',
        'userDashboard: "/user"',
        'merchantDashboard: "/merchant"',
        'merchantAdvancedSettings: "/merchant?tab=settings&section=advanced"',
        'support: "/support"',
        'accountDeletionComplete: "/signin?accountDeleted=1"',
    ]) {
        assert.match(routes, new RegExp(expected.replace(/[?]/g, "\\?")));
    }

    for (const pagePath of [
        "src/app/signin/page.tsx",
        "src/app/signup/page.tsx",
        "src/app/support/page.tsx",
        "src/app/dashboard/user/page.tsx",
        "src/app/dashboard/page.tsx",
    ]) {
        assert.equal(existsSync(new URL(`../../../${pagePath}`, import.meta.url)), true, `${pagePath} must exist`);
    }
    const proxy = source("src/proxy.ts");
    assert.match(proxy, /pathname === "\/user"/);
    assert.match(proxy, /pathname === "\/merchant"/);
});

test("every literal user-visible internal navigation target resolves", () => {
    const srcRoot = new URL("../../../src/", import.meta.url);
    const targets = new Set();
    for (const entry of readdirSync(srcRoot, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || ![".ts", ".tsx"].includes(extname(entry.name))) continue;
        const contents = readFileSync(join(entry.parentPath, entry.name), "utf8");
        for (const pattern of [
            /href="(\/[^"{}]*)"/g,
            /router\.(?:push|replace|prefetch)\("(\/[^"{}]*)"/g,
            /redirect\("(\/[^"{}]*)"/g,
            /window\.location\.href\s*=\s*"(\/[^"{}]*)"/g,
        ]) {
            for (const match of contents.matchAll(pattern)) targets.add(match[1]);
        }
    }

    for (const rawTarget of targets) {
        const pathname = rawTarget.split(/[?#]/, 1)[0] || "/";
        if (pathname === "/llms.txt") {
            assert.equal(existsSync(new URL("../../../public/llms.txt", import.meta.url)), true);
            continue;
        }
        const pagePath = pathname === "/"
            ? "../../../src/app/page.tsx"
            : `../../../src/app${pathname}/page.tsx`;
        assert.equal(
            existsSync(new URL(pagePath, import.meta.url)),
            true,
            `${rawTarget} has no matching App Router page`,
        );
    }
});

test("authentication return paths reject external and browser-normalized redirects", () => {
    const navigation = source("src/utils/navigation.ts");
    const signin = source("src/app/signin/page.tsx");
    const signup = source("src/app/signup/page.tsx");

    assert.match(navigation, /!value\.startsWith\("\/"\) \|\| value\.startsWith\("\/\/"\)/);
    assert.match(navigation, /value\.includes\("\\\\"\)/);
    assert.match(navigation, /[\\u0000-\\u0020\\u007f]/);
    assert.match(signin, /getSafeRelativePath\(searchParams\?\.get\("next"\)/);
    assert.match(signup, /getSafeRelativePath\(searchParams\?\.get\("next"\)/);
});

test("account deletion requires a recent authenticated session and retains the dialog on failure", () => {
    const route = source("src/app/api/user/account/route.ts");
    const page = source("src/app/dashboard/user/page.tsx");
    const modal = source("src/components/ConfirmModal.tsx");

    assert.match(route, /authorizeFinancialStepUp/);
    assert.match(route, /action: "deleteAccount"/);
    assert.match(route, /RECENT_AUTH_REQUIRED/);
    assert.match(page, /keepOpenOnConfirm: true/);
    assert.match(page, /isLoading: true/);
    assert.match(modal, /role="alertdialog"/);
    assert.match(modal, /previouslyFocused\?\.focus\(\)/);
});
