const { PrismaClient } = require('@prisma/client');
const { createHash } = require('node:crypto');
const { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const hash = (value) => createHash('sha256').update(value).digest('hex');

function openDatabase(path) {
  // Refuse missing files: SQLite would otherwise create an empty database.
  const absolute = realpathSync(path);
  if (!statSync(absolute).isFile() || statSync(absolute).size === 0) throw new Error('Database file is empty or invalid');
  return new PrismaClient({ datasources: { db: { url: `file:${absolute.replaceAll('\\', '/')}` } } });
}

async function assertHealthy(db) {
  const integrity = await db.$queryRawUnsafe('PRAGMA integrity_check');
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('SQLite integrity check failed');
  const foreignKeys = await db.$queryRawUnsafe('PRAGMA foreign_key_check');
  if (foreignKeys.length) throw new Error(`Broken references: ${foreignKeys.length}`);
}

async function fingerprint(db, name, columns) {
  // Compare stored SQLite values, including dates, without Prisma model conversions.
  const fields = columns.map((column, index) => `quote(${quote(column)}) AS c${index}`).join(', ');
  const rows = await db.$queryRawUnsafe(`SELECT ${fields} FROM ${quote(name)}`);
  const ordered = rows.map((row) => JSON.stringify(columns.map((_, index) => row[`c${index}`]))).sort();
  return { count: rows.length, hash: hash(JSON.stringify(ordered)) };
}

async function snapshot(db) {
  return db.$transaction(async (tx) => {
    await assertHealthy(tx);
    const names = await tx.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name");
    const tables = {};
    for (const { name } of names) {
      const info = await tx.$queryRawUnsafe(`PRAGMA table_info(${quote(name)})`);
      const columns = info.map((column) => column.name);
      tables[name] = { columns, ...await fingerprint(tx, name, columns) };
    }
    return tables;
  }, { timeout: 60000 });
}

async function compare(db, tables) {
  return db.$transaction(async (tx) => {
    await assertHealthy(tx);
    for (const [name, before] of Object.entries(tables)) {
      const info = await tx.$queryRawUnsafe(`PRAGMA table_info(${quote(name)})`);
      if (!before.columns.every((column) => info.some((field) => field.name === column))) throw new Error(`Missing table or column: ${name}`);
      const after = await fingerprint(tx, name, before.columns);
      if (after.count !== before.count || after.hash !== before.hash) throw new Error(`Data changed: ${name}. Keep the application stopped and investigate.`);
    }
    return Object.keys(tables).length;
  }, { timeout: 60000 });
}

async function backupDatabase(path, directory) {
  const database = realpathSync(path);
  const destination = resolve(directory);
  if (existsSync(destination)) throw new Error('Backup directory already exists; choose a new directory');
  const db = openDatabase(database);
  let copy;
  try {
    await assertHealthy(db);
    mkdirSync(destination, { mode: 0o700 });
    const backup = join(destination, 'database.db');
    await db.$executeRawUnsafe('VACUUM main INTO ?', backup.replaceAll('\\', '/'));
    chmodSync(backup, 0o600);
    copy = openDatabase(backup);
    const tables = await snapshot(copy);
    await copy.$disconnect();
    copy = null;
    await compare(db, tables);
    const manifest = { format: 1, database, createdAt: new Date().toISOString(), backupHash: hash(readFileSync(backup)), tables };
    writeFileSync(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`BACKUP VERIFIED: ${Object.keys(tables).length} tables. Directory: ${destination}`);
    return manifest;
  } finally {
    if (copy) await copy.$disconnect();
    await db.$disconnect();
  }
}

async function verifyDatabase(path, directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || realpathSync(path) !== manifest.database) throw new Error('Manifest does not match this database');
  if (hash(readFileSync(join(directory, 'database.db'))) !== manifest.backupHash) throw new Error('Backup file changed');
  const db = openDatabase(path);
  try {
    const count = await compare(db, manifest.tables);
    console.log(`DATA VERIFIED: all existing values in ${count} tables are unchanged.`);
    return count;
  } finally {
    await db.$disconnect();
  }
}

module.exports = { backupDatabase, verifyDatabase };

if (require.main === module) {
  const [mode, database, directory] = process.argv.slice(2);
  if (!['backup', 'verify'].includes(mode) || !database || !directory) {
    console.error('Usage: node scripts/deployment-data.cjs backup|verify DATABASE_PATH NEW_BACKUP_DIRECTORY');
    process.exitCode = 1;
  } else {
    const run = mode === 'backup' ? backupDatabase : verifyDatabase;
    run(database, directory).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
