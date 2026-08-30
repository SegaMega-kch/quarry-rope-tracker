import assert from "node:assert/strict";
import test from "node:test";
import { shouldScrapUnloadedTeeth, toothCraneLocation } from "../lib/tooth-policy";

test("only used teeth unloaded at the crane are scrapped", () => {
  assert.equal(shouldScrapUnloadedTeeth("USED", toothCraneLocation), true);
  assert.equal(shouldScrapUnloadedTeeth("NEW", toothCraneLocation), false);
  assert.equal(shouldScrapUnloadedTeeth("USED", "ЭКГ-10 №4"), false);
  assert.equal(shouldScrapUnloadedTeeth("NEW", "ЭКГ-10 №4"), false);
  assert.equal(shouldScrapUnloadedTeeth("USED", null), false);
});
