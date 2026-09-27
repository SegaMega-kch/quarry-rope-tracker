import assert from "node:assert/strict";
import { test } from "node:test";
import { freeYaknoOnHorizon, hasPoweredAssembly, yaknoWithoutExcavator } from "../lib/yakno-view";
import { yaknoLabel } from "../lib/labels";

test("Yakno labels use one hyphen without changing stored identifiers", () => {
  for (const number of ["117", "Я117", "я117", "Я-117", " Я - 117 "]) {
    assert.equal(yaknoLabel(number), "Я-117");
  }
  assert.equal(yaknoLabel("14/1"), "Я-14/1");
  for (const empty of [undefined, null, "", "   "]) assert.equal(yaknoLabel(empty), "");
});

function box(number: string, horizonId: number | null, name: string | null, isPowered = false) {
  return { number, horizonId, horizon: name ? { name } : null, isPowered };
}

test("free Yakno appears for every excavator on the same horizon without duplicating or mutating inventory", () => {
  const source = Object.freeze([Object.freeze(box("10", 1, "+100")), Object.freeze(box("2", 1, "+100")),
    Object.freeze(box("3", 2, "+200")), Object.freeze(box("4", 1, "+100", true))]);
  const firstExcavator = freeYaknoOnHorizon(source, 1);
  const secondExcavator = freeYaknoOnHorizon(source, 1);
  assert.deepEqual(firstExcavator.map(item => item.number), ["2", "10"]);
  assert.deepEqual(secondExcavator, firstExcavator);
  assert.equal(firstExcavator[0], source[1]);
  assert.equal(yaknoWithoutExcavator(source, [1, 1]).length, 1);
  assert.deepEqual(source.map(item => item.number), ["10", "2", "3", "4"]);
});

test("unknown excavator horizons never collect all unlocated Yakno", () => {
  const source = [box("1", null, null), box("2", 1, "+100")];
  assert.deepEqual(freeYaknoOnHorizon(source, null), []);
  assert.deepEqual(yaknoWithoutExcavator(source, [null]).map(item => item.number), ["2", "1"]);
});

test("orphaned Yakno sort by descending elevation, then number, with unlocated boxes last", () => {
  const source = [box("5", null, null), box("4", 4, "Горизонт -100"), box("10", 1, "Горизонт +200"),
    box("2", 1, "Горизонт +200"), box("3", 3, "0"), box("6", 5, "−50 м"),
    box("1", 2, "+100"), box("7", 6, "+100,5 м"), box("8", 7, "+300", true)];
  assert.deepEqual(yaknoWithoutExcavator(source, []).map(item => item.number), ["2", "10", "7", "1", "3", "6", "4", "5"]);
});

test("connecting hides a free box from horizon lists; disconnecting makes it available there again", () => {
  const free = box("7", 1, "+100");
  assert.equal(freeYaknoOnHorizon([free], 1).length, 1);
  assert.equal(freeYaknoOnHorizon([{ ...free, isPowered: true }], 1).length, 0);
  assert.equal(yaknoWithoutExcavator([{ ...free, isPowered: true }], []).length, 0);
  assert.equal(yaknoWithoutExcavator([free], []).length, 1);
});

test("Yakno card assembly marker requires an actual working connection, not a nearby/repair/loan assembly", () => {
  const connected = Object.freeze({ status: "WORKING", isPowered: true, excavatorLocationId: 4 });
  const source = Object.freeze([connected]);
  assert.equal(hasPoweredAssembly(source, 4), true);
  assert.equal(hasPoweredAssembly(source, 9), false);
  assert.equal(hasPoweredAssembly([], 4), false);
  for (const disconnected of [
    { ...connected, isPowered: false },
    { ...connected, excavatorLocationId: null },
    { ...connected, status: "REPAIR" },
    { ...connected, status: "ON_LOAN" }
  ]) assert.equal(hasPoweredAssembly([disconnected], 4), false);
  assert.deepEqual(source, [connected]);
});

test("assembly marker follows disconnection/reconnection and remains while another working assembly is powered", () => {
  const connected = { status: "WORKING", isPowered: true, excavatorLocationId: 4 };
  const disconnected = { ...connected, isPowered: false, excavatorLocationId: null };
  assert.equal(hasPoweredAssembly([connected, disconnected], 4), true);
  assert.equal(hasPoweredAssembly([disconnected], 4), false);
  const reconnected = { ...connected, excavatorLocationId: 9 };
  assert.equal(hasPoweredAssembly([reconnected], 4), false);
  assert.equal(hasPoweredAssembly([reconnected], 9), true);
});
