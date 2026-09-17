import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("the mobile tier control expands before opening verification details", () => {
    const header = source("src/components/UserDashboardHeader.tsx");
    const dashboard = source("src/app/dashboard/user/page.tsx");

    assert.match(header, /const \[mobileTierExpanded, setMobileTierExpanded\] = useState\(false\)/);
    assert.match(header, /if \(!mobileTierExpanded\)[\s\S]*setMobileTierExpanded\(true\)[\s\S]*return/);
    assert.match(header, /type="button"[\s\S]*aria-expanded=\{mobileTierExpanded\}/);
    assert.match(header, /onTierDetails\(\)[\s\S]*onTabChange\("dns"\)/);
    assert.match(header, /mobileTierExpanded \? `Tier \$\{tier\}` : tier/);

    assert.match(dashboard, /<HomeHeader[\s\S]*onTierDetails=\{\(\) => \{[\s\S]*setActiveTab\("dns"\)[\s\S]*setAccountSubView\("kyc"\)/);
    assert.match(dashboard, /const \[tierExpanded, setTierExpanded\] = useState\(false\)/);
    assert.match(dashboard, /if \(!tierExpanded\)[\s\S]*setTierExpanded\(true\)[\s\S]*return;[\s\S]*onTierDetails\(\)/);
    assert.match(dashboard, /aria-expanded=\{tierExpanded\}/);
    assert.match(dashboard, /tierExpanded \? `Tier \$\{tier\}` : tier/);
});

test("every runtime control is rendered as a labelled visual switch", () => {
    const health = source("src/components/admin/AdminSystemHealthCard.tsx");

    assert.match(health, /SWITCHES\.map/);
    assert.match(health, /role="switch"/);
    assert.match(health, /aria-checked=\{known \? value : false\}/);
    assert.match(health, /aria-labelledby=\{`\$\{entry\.field\}-label \$\{entry\.field\}-state`\}/);
    assert.match(health, /data-switch-track/);
    assert.match(health, /data-switch-thumb/);
    assert.match(health, /alarming[\s\S]*border-red-700 bg-red-600/);
    assert.match(health, /Server-enforced controls stored in system settings/);
});

test("mobile admin navigation uses high-contrast labels", () => {
    const admin = source("src/app/admin/page.tsx");
    const drawer = admin.slice(
        admin.indexOf("Mobile Navigation Sidebar Drawer"),
        admin.indexOf("{error &&", admin.indexOf("Mobile Navigation Sidebar Drawer")),
    );

    assert.match(drawer, /tracking-wider text-white\/80/);
    assert.match(drawer, /text-white\/95 hover:bg-white\/\[0\.12\]/);
    assert.doesNotMatch(drawer, /text-white\/(?:40|50|60|70)(?:\s|\")/);
});

test("the user mobile bottom nav and its skeleton keep the five-percent height increase", () => {
    const nav = source("src/components/dashboard/MobileFloatingNav.tsx");
    const dashboard = source("src/app/dashboard/user/page.tsx");

    assert.match(nav, /const CAPSULE_HEIGHT = 52\.5/);
    assert.match(nav, /const CAPSULE_RETRACTED_SIZE = 52\.5/);
    assert.match(dashboard, /h-\[52\.5px\]/);
    assert.match(dashboard, /w-\[52\.5px\]/);
});

test("the mobile dashboard skeleton mirrors profile, tier, and notification controls", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");
    const headerStart = dashboard.indexOf('aria-label="Loading profile"');
    const headerEnd = dashboard.indexOf("<main", headerStart);
    const mobileSkeleton = dashboard.slice(headerStart, headerEnd);

    assert.ok(headerStart !== -1, "loading profile skeleton exists");
    assert.match(mobileSkeleton, /h-12 w-12[^\n]*rounded-full/);
    assert.match(mobileSkeleton, /aria-label="Loading account controls"/);
    assert.equal((mobileSkeleton.match(/h-9 w-9 subscript-skeleton rounded-full/g) || []).length, 2);
    assert.doesNotMatch(mobileSkeleton, /h-3 w-20/);
});

test("balance routing no longer claims Arc transfers are free", () => {
    const dashboard = source("src/app/dashboard/user/page.tsx");

    assert.doesNotMatch(dashboard, /Straight from your balance/);
    assert.doesNotMatch(dashboard, /there&apos;s no fee/);
    assert.match(dashboard, /if \(numericAmount <= walletBalance\) return null/);
});
