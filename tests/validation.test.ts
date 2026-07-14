import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedValue,
  locationCategories,
  positiveInteger,
  requestStatuses,
  ropePlacements,
  toothConditions
} from "../lib/validation";

test("positiveInteger accepts only whole positive quantities", () => {
  assert.equal(positiveInteger("1"), 1);
  assert.equal(positiveInteger("12"), 12);
  assert.throws(() => positiveInteger("0"));
  assert.throws(() => positiveInteger("-1"));
  assert.throws(() => positiveInteger("1.5"));
  assert.throws(() => positiveInteger("not-a-number"));
});

test("allowedValue rejects forged enum values", () => {
  assert.equal(allowedValue("GROUND", ropePlacements, "placement"), "GROUND");
  assert.equal(allowedValue("NEW", toothConditions, "condition"), "NEW");
  assert.equal(allowedValue("DONE", requestStatuses, "status"), "DONE");
  assert.equal(allowedValue("excavator", locationCategories, "category"), "excavator");
  assert.throws(() => allowedValue("DELETE_EVERYTHING", requestStatuses, "status"));
});
