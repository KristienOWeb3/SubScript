import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { getRecognizedAccountName } from "../../../lib/transactions/identity.ts";

const avatarPath = path.resolve("src/components/dashboard/TransactionAvatar.tsx");
const iconsPath = path.resolve("src/components/icons.tsx");

test("TransactionAvatar component enforces directional SVG icons over letter avatars", () => {
  const avatarSource = fs.readFileSync(avatarPath, "utf-8");
  const iconsSource = fs.readFileSync(iconsPath, "utf-8");

  // Uses dedicated SVGs
  assert.match(avatarSource, /IncomingTransactionIcon/);
  assert.match(avatarSource, /OutgoingTransactionIcon/);

  // Accessible labels
  assert.match(avatarSource, /Received from external wallet/);
  assert.match(avatarSource, /Sent to external wallet/);

  // SVGs exist with correct viewBoxes
  assert.match(iconsSource, /IncomingTransactionIcon/);
  assert.match(iconsSource, /viewBox="0 0 153 159"/);
  assert.match(iconsSource, /OutgoingTransactionIcon/);
  assert.match(iconsSource, /viewBox="0 0 283 283"/);

  // Directional fallbacks do NOT hardcode letter D or S
  assert.doesNotMatch(avatarSource, /"D"/);
  assert.doesNotMatch(avatarSource, /'D'/);
  assert.doesNotMatch(avatarSource, /"S"/);
  assert.doesNotMatch(avatarSource, /'S'/);
});

test("recognized SubScript accounts retain profile images or name fallbacks", () => {
  const avatarSource = fs.readFileSync(avatarPath, "utf-8");

  // Profile pic rendering
  assert.match(avatarSource, /profilePic/);
  assert.match(avatarSource, /object-cover/);

  // Recognized account logic
  assert.equal(getRecognizedAccountName("@alice", null), "alice");
  assert.equal(getRecognizedAccountName(null, "0x1234567890123456789012345678901234567890"), null);
  assert.equal(getRecognizedAccountName("bob", null), "bob");
});

