import Database from 'better-sqlite3';
import path from 'path';
import { findRepoRoot } from '@machina/schemas';

// Shared across processes: apps/dashboard and mcp/server are separate Node processes but
// must read/write the same catalogue and demand log. One file at the repo root, resolved
// the same way regardless of which workspace invoked it (see findRepoRoot). Override with
// MACHINA_DB_PATH if a test run needs an isolated database.
const DB_PATH = process.env.MACHINA_DB_PATH || path.join(findRepoRoot(), 'machina.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}
