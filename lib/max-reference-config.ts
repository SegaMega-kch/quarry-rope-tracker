import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { maxId } from "./max-api";

export type ReferenceDestination = { botId: string; botUsername: string; chatId: string; chatTitle: string };
export type ReferenceConfig = ReferenceDestination & { sourceDatabase: string; stateDatabase: string; tokenFile: string;
  webhookSecretFile: string; webhookUrl: string };

export function referenceIdentity(destination: ReferenceDestination) {
  if (!destination.botUsername.trim() || !destination.chatTitle.trim()) throw new Error("Reference destination is required");
  return JSON.stringify({ botId: maxId(destination.botId), botUsername: destination.botUsername,
    chatId: maxId(destination.chatId), chatTitle: destination.chatTitle });
}

export function loadReferenceConfig(path: string): ReferenceConfig {
  if (!isAbsolute(path)) throw new Error("Use a private absolute configuration path");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reference configuration");
  const keys = ["sourceDatabase", "stateDatabase", "tokenFile", "webhookSecretFile", "webhookUrl", "botId", "botUsername", "chatId", "chatTitle"];
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key)) || keys.some((key) => typeof record[key] !== "string" || !String(record[key]).trim())) throw new Error("Unexpected reference configuration fields");
  const config = record as ReferenceConfig;
  referenceIdentity(config);
  const paths = [config.sourceDatabase, config.stateDatabase, config.tokenFile, config.webhookSecretFile, path];
  for (const file of paths) if (!isAbsolute(file) || /[?#]/.test(file)) throw new Error("Use absolute plain filenames");
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (resolve(paths[i]) === resolve(paths[j])) throw new Error("Configuration, secrets, source and state must be separate");
    if (!existsSync(paths[i]) || !existsSync(paths[j])) continue;
    const a = statSync(paths[i]), b = statSync(paths[j]);
    if (realpathSync(paths[i]) === realpathSync(paths[j]) || (a.dev === b.dev && a.ino === b.ino)) throw new Error("Reference paths alias the same file");
  }
  const source = statSync(config.sourceDatabase);
  if (!source.isFile() || !source.size) throw new Error("An existing inventory source is required");
  const url = new URL(config.webhookUrl);
  if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/api/max/reference") throw new Error("Use the HTTPS reference endpoint on port 443");
  return config;
}

export function readReferenceSecret(config: Pick<ReferenceConfig, "webhookSecretFile">) {
  const secret = readFileSync(config.webhookSecretFile, "utf8").trim();
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(secret)) throw new Error("Invalid reference webhook secret");
  return secret;
}

export async function openReferenceSource(path: string) {
  const source = statSync(path);
  if (!source.isFile() || !source.size) throw new Error("An existing inventory source is required");
  const db = new PrismaClient({ datasources: { db: { url: `file:${realpathSync(path).replaceAll("\\", "/")}?connection_limit=1` } } });
  try {
    // All reads use this dedicated single-connection client, never the web application's writer.
    await db.$executeRaw`PRAGMA query_only = ON`;
    return db;
  } catch (error) { await db.$disconnect(); throw error; }
}
