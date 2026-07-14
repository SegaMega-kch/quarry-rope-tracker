import assert from "node:assert/strict";
import test from "node:test";
import {
  canExport,
  canManageLocations,
  canManageRequests,
  canWriteOff
} from "../lib/permissions";

test("shift cannot perform privileged operations", () => {
  assert.equal(canWriteOff("shift"), false);
  assert.equal(canExport("shift"), false);
  assert.equal(canManageLocations("shift"), false);
  assert.equal(canManageRequests("shift"), false);
});

test("boss can write off, export and manage mechanic requests", () => {
  assert.equal(canWriteOff("boss"), true);
  assert.equal(canExport("boss"), true);
  assert.equal(canManageRequests("boss"), true);
  assert.equal(canManageLocations("boss"), false);
});

test("storekeeper can write off, export and manage dictionaries", () => {
  assert.equal(canWriteOff("storekeeper"), true);
  assert.equal(canExport("storekeeper"), true);
  assert.equal(canManageLocations("storekeeper"), true);
  assert.equal(canManageRequests("storekeeper"), false);
});
