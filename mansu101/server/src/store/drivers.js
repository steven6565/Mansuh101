import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite driver built on Node's built-in `node:sqlite` (Node >= 22.5).
 * No native compilation required — ideal for VPS provisioning.
 */
export class SqliteDriver {
  constructor(file) {
    this.file = file;
    this.db = null;
  }

  async open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    if (this.db.exec) {
      try {
        this.db.exec('PRAGMA optimize;');
      } catch {
        /* older builds */
      }
    }
  }

  async exec(sql) {
    this.db.exec(sql);
  }

  async all(sql, params = []) {
    return this.db.prepare(sql).all(...params);
  }

  async get(sql, params = []) {
    return this.db.prepare(sql).get(...params);
  }

  async run(sql, params = []) {
    return this.db.prepare(sql).run(...params);
  }

  async close() {
    this.db?.close();
  }
}

/**
 * PostgreSQL driver (optional). Requires `pnpm add pg`.
 * `?` placeholders are rewritten to `$1..$n` for a consistent store API.
 */
export class PostgresDriver {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this.pool = null;
  }

  async open() {
    let pg;
    try {
      pg = await import('pg');
    } catch {
      throw new Error(
        'PostgreSQL support needs the optional "pg" package. Run: pnpm --dir server add pg',
      );
    }
    const Pool = pg.default?.Pool ?? pg.Pool;
    this.pool = new Pool({ connectionString: this.connectionString, max: 10 });
    await this.pool.query('SELECT 1');
  }

  convert(sql) {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  }

  async exec(sql) {
    await this.pool.query(sql);
  }

  async all(sql, params = []) {
    const result = await this.pool.query(this.convert(sql), params);
    return result.rows;
  }

  async get(sql, params = []) {
    const result = await this.pool.query(this.convert(sql), params);
    return result.rows[0];
  }

  async run(sql, params = []) {
    const result = await this.pool.query(this.convert(sql), params);
    return { changes: result.rowCount, lastInsertRowid: null };
  }

  async close() {
    await this.pool?.end();
  }
}
