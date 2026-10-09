import assert from "node:assert/strict";
import test from "node:test";
import {
  canExport,
  canCreateExcavator,
  canManageRopeTypes,
  canManageYakno,
  canManageLocations,
  canManageRequests,
  canViewStatistics,
  canWriteOff
} from "../lib/permissions";
import { canUseProduction } from "../lib/production-store";

test("shift cannot perform privileged operations", () => {
  assert.equal(canWriteOff("shift"), false);
  assert.equal(canExport("shift"), false);
  assert.equal(canManageLocations("shift"), false);
  assert.equal(canManageRequests("shift"), false);
  assert.equal(canViewStatistics("shift"), false);
});

test("statistics is available only to the approved elevated roles", () => {
  for (const role of ["boss", "storekeeper", "admin"]) assert.equal(canViewStatistics(role), true);
  for (const role of ["shift", "guest", "unknown"]) assert.equal(canViewStatistics(role), false);
});

test("shift production is available only to admin", () => {
  assert.equal(canUseProduction("admin"), true);
  for (const role of ["shift", "boss", "storekeeper", "guest", "unknown"]) assert.equal(canUseProduction(role), false);
});

test("shift may only manage the newly approved dictionaries", () => {
  for (const role of ["shift", "storekeeper", "admin"]) {
    assert.equal(canCreateExcavator(role), true);
    assert.equal(canManageRopeTypes(role), true);
    assert.equal(canManageYakno(role), true);
  }
  for (const role of ["boss", "guest", "unknown"]) {
    assert.equal(canCreateExcavator(role), false);
    assert.equal(canManageRopeTypes(role), false);
    assert.equal(canManageYakno(role), false);
  }
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
