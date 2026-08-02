import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const windows1251 = new TextDecoder("windows-1251");
const byteByCharacter = new Map<string, number>();

for (let byte = 0; byte < 256; byte += 1) {
  byteByCharacter.set(windows1251.decode(Uint8Array.of(byte)), byte);
}

function recoverMojibake(value: string) {
  const bytes: number[] = [];
  for (const character of value) {
    const byte = byteByCharacter.get(character);
    if (byte === undefined) return null;
    bytes.push(byte);
  }

  try {
    const recovered = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    return recovered === value ? null : recovered;
  } catch {
    return null;
  }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|prisma)$/.test(entry.name) ? [path] : [];
  });
}

test("source strings do not contain recoverable mojibake", () => {
  const damaged: string[] = [];

  for (const file of [...sourceFiles("app"), ...sourceFiles("lib"), ...sourceFiles("prisma")]) {
    const source = readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)) {
        const recovered = recoverMojibake(match[2]);
        if (recovered) damaged.push(`${file}:${index + 1}: ${match[2]} -> ${recovered}`);
      }
    });
  }

  assert.deepEqual(damaged, []);
});
