import assert from "node:assert/strict";
import test from "node:test";
import { safetyStatus, safetyTemplatesFor } from "../lib/safety";

const expiry = (value: string) => new Date(`${value}T12:00:00.000Z`);

test("safety status treats the expiry day as overdue", () => {
  assert.equal(safetyStatus(expiry("2026-08-02"), new Date("2026-08-02T10:00:00.000Z")), "OVERDUE");
});

test("safety status warns one calendar month before expiry", () => {
  assert.equal(safetyStatus(expiry("2026-09-15"), new Date("2026-08-15T07:00:00.000Z")), "EXPIRING");
  assert.equal(safetyStatus(expiry("2026-09-16"), new Date("2026-08-15T07:00:00.000Z")), "ACTIVE");
});

test("safety status keeps an empty date neutral", () => {
  assert.equal(safetyStatus(null, new Date("2026-08-02T10:00:00.000Z")), "NO_DATE");
});

test("safety templates preserve source equipment numbers and dates", () => {
  const items = safetyTemplatesFor("ЭКГ-12К №74");
  const extinguisher = items.find((item) => item.name === "Огнетушитель №747");
  assert.equal(extinguisher?.expiryDate?.toISOString().slice(0, 10), "2028-05-01");
  assert.equal(items.filter((item) => item.category === "EXTINGUISHER").length, 7);
});

test("new excavators receive PPE without invented extinguisher numbers", () => {
  const items = safetyTemplatesFor("ЭКГ-10 №9");
  assert.equal(items.filter((item) => item.category === "PPE").length, 10);
  assert.equal(items.filter((item) => item.category === "EXTINGUISHER").length, 0);
  assert.equal(items.every((item) => item.expiryDate === undefined), true);
});

test("safety templates use the correct low-voltage indicator name", () => {
  const items = safetyTemplatesFor("ЭКГ-10 №4");
  assert.equal(items.some((item) => item.name === "Низковольтный указатель"), true);
  assert.equal(items.some((item) => item.name === "Низговольтный указатель"), false);
});
