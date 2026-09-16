import assert from "node:assert/strict";
import test from "node:test";
import { ethers } from "ethers";
import {
  generatePauseCalldata,
  generateUnpauseCalldata,
  generateAuthorizeDrawerCalldata,
  generateResolveDisputeCalldata,
  generateUpgradeCalldata,
  generateInitializeV2Calldata,
  vaultInterface,
  routerInterface,
} from "../../../../scripts/secops-calldata.mjs";

test("secops: pause calldata matches canonical EVM selector", () => {
  const recipe = generatePauseCalldata();
  assert.equal(recipe.function, "pause()");
  assert.equal(recipe.selector, "0x8456cb59");
  assert.equal(recipe.calldata, "0x8456cb59");
  assert.equal(recipe.value, "0 ETH / 0 USDC");
  assert.ok(recipe.targets.length >= 2);
  assert.ok(recipe.legacyAuditNote.includes("0x84b0196e"));
});

test("secops: unpause calldata matches canonical EVM selector", () => {
  const recipe = generateUnpauseCalldata();
  assert.equal(recipe.function, "unpause()");
  assert.equal(recipe.selector, "0x3f4ba83a");
  assert.equal(recipe.calldata, "0x3f4ba83a");
  assert.equal(recipe.value, "0 ETH / 0 USDC");
  assert.ok(recipe.targets.length >= 2);
  assert.ok(recipe.legacyAuditNote.includes("0x3f4b7b65"));
});

test("secops: authorize drawer generates valid ABI encoded data", () => {
  const drawer = "0x1111111111111111111111111111111111111111";
  const recipe = generateAuthorizeDrawerCalldata(drawer, true);
  assert.equal(recipe.selector, "0x2fdcb277");
  assert.equal(recipe.parameters.drawer, drawer);
  assert.equal(recipe.parameters.allowed, true);

  // Decode and assert
  const decoded = vaultInterface.decodeFunctionData("setAuthorizedDrawer", recipe.calldata);
  assert.equal(decoded[0].toLowerCase(), drawer.toLowerCase());
  assert.equal(decoded[1], true);
});

test("secops: authorize drawer handles false flag and booleans", () => {
  const drawer = "0x1111111111111111111111111111111111111111";
  const recipe = generateAuthorizeDrawerCalldata(drawer, "false");
  assert.equal(recipe.parameters.allowed, false);
  const decoded = vaultInterface.decodeFunctionData("setAuthorizedDrawer", recipe.calldata);
  assert.equal(decoded[1], false);
});

test("secops: resolve dispute generates valid ABI encoded data", () => {
  const user = "0x1111111111111111111111111111111111111111";
  const merchant = "0x2222222222222222222222222222222222222222";
  const recipe = generateResolveDisputeCalldata(user, merchant, true);
  assert.equal(recipe.selector, "0xa6680ef3");
  assert.equal(recipe.parameters.user, user);
  assert.equal(recipe.parameters.merchant, merchant);
  assert.equal(recipe.parameters.reopenSettlement, true);

  const decoded = vaultInterface.decodeFunctionData("resolveDispute", recipe.calldata);
  assert.equal(decoded[0].toLowerCase(), user.toLowerCase());
  assert.equal(decoded[1].toLowerCase(), merchant.toLowerCase());
  assert.equal(decoded[2], true);
});

test("secops: upgradeToAndCall without reinitializer encodes empty bytes", () => {
  const newImpl = "0x3333333333333333333333333333333333333333";
  const recipe = generateUpgradeCalldata(newImpl, "0x");
  assert.equal(recipe.selector, "0x4f1ef286");

  const decoded = vaultInterface.decodeFunctionData("upgradeToAndCall", recipe.calldata);
  assert.equal(decoded[0].toLowerCase(), newImpl.toLowerCase());
  assert.equal(decoded[1], "0x");
});

test("secops: upgradeToAndCall with initializeV2 encodes nested calldata", () => {
  const newImpl = "0x3333333333333333333333333333333333333333";
  const treasury = "0x4444444444444444444444444444444444444444";
  const initRecipe = generateInitializeV2Calldata(treasury);
  assert.equal(initRecipe.selector, "0x29b6eca9");

  const recipe = generateUpgradeCalldata(newImpl, initRecipe.calldata);
  const decoded = vaultInterface.decodeFunctionData("upgradeToAndCall", recipe.calldata);
  assert.equal(decoded[0].toLowerCase(), newImpl.toLowerCase());
  assert.equal(decoded[1], initRecipe.calldata);

  const decodedInit = vaultInterface.decodeFunctionData("initializeV2", decoded[1]);
  assert.equal(decodedInit[0].toLowerCase(), treasury.toLowerCase());
});

test("secops: invalid arguments throw clear descriptive errors", () => {
  assert.throws(() => generateAuthorizeDrawerCalldata("0xinvalid", true), /Invalid drawer address/);
  assert.throws(() => generateResolveDisputeCalldata("0x1111111111111111111111111111111111111111", "bad", true), /Invalid merchant address/);
  assert.throws(() => generateUpgradeCalldata("0xbad", "0x"), /Invalid implementation address/);
  assert.throws(() => generateAuthorizeDrawerCalldata("0x1111111111111111111111111111111111111111", "notabool"), /Invalid boolean value/);
});
