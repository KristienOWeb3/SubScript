import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("merchant and user KYC controls use the supplied shield and pending-clock SVG", () => {
  const icons = fs.readFileSync(path.resolve("src/components/icons.tsx"), "utf8");
  const merchant = fs.readFileSync(path.resolve("src/app/dashboard/page.tsx"), "utf8");
  const user = fs.readFileSync(path.resolve("src/app/dashboard/user/page.tsx"), "utf8");

  assert.match(icons, /function KycVerificationPendingIcon/);
  assert.match(icons, /viewBox="0 0 167 166"/);
  assert.match(icons, /verification pending clock/);
  assert.match(icons, /M57\.5 12\.1c-11\.4 6-21\.4 9\.8-33\.2 12\.4/);
  assert.match(icons, /M75\.8 74\.2 59\.2 91\.5l-8\.4-8\.3/);
  assert.match(merchant, /<KycVerificationPendingIcon className="h-5 w-5"/);
  assert.match(user, /<KycVerificationPendingIcon className="h-4 w-4"/);
});
