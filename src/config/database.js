const path = require('path');
const fs = require('fs');
const os = require('os');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
let wantPostgres = Boolean(databaseUrl && (databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://')));
let isPostgres = wantPostgres;

let postgresDriver = null;
let sqliteDbInstance = null;
let sqliteDriver = null;
let activeDriver = null;

function convertPlaceholders(sql) {
  let i = 1;
  return sql.replace(/\?/g, () => `$${i++}`);
}

function getSqliteDriver() {
  if (sqliteDriver) return sqliteDriver;

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  let dataDir = isServerless ? os.tmpdir() : path.join(__dirname, '..', '..', 'data');
  if (!isServerless && !fs.existsSync(dataDir)) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  }
  const dbPath = process.env.DB_PATH || path.join(dataDir, 'muspimnas.db');
  const { DatabaseSync } = require('node:sqlite');
  sqliteDbInstance = new DatabaseSync(dbPath);

  try {
    sqliteDbInstance.exec('PRAGMA foreign_keys = ON;');
    sqliteDbInstance.exec('PRAGMA journal_mode = WAL;');
  } catch (e) {}

  sqliteDriver = {
    isPostgres: false,
    sqliteDb: sqliteDbInstance,
    async query(sql, params = []) {
      return sqliteDbInstance.prepare(sql).all(...params);
    },
    async get(sql, params = []) {
      return sqliteDbInstance.prepare(sql).get(...params) || null;
    },
    async all(sql, params = []) {
      return sqliteDbInstance.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const res = sqliteDbInstance.prepare(sql).run(...params);
      return {
        changes: res.changes,
        lastInsertRowid: res.lastInsertRowid
      };
    },
    async exec(sql) {
      return sqliteDbInstance.exec(sql);
    }
  };

  return sqliteDriver;
}

if (wantPostgres) {
  // Clean connection string if channel_binding is present
  const cleanUrl = databaseUrl.replace('&channel_binding=require', '').replace('channel_binding=require&', '');
  const pool = new Pool({
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
  });

  postgresDriver = {
    isPostgres: true,
    pool,
    async query(sql, params = []) {
      const converted = convertPlaceholders(sql);
      return await pool.query(converted, params);
    },
    async get(sql, params = []) {
      const converted = convertPlaceholders(sql);
      const res = await pool.query(converted, params);
      return res.rows[0] || null;
    },
    async all(sql, params = []) {
      const converted = convertPlaceholders(sql);
      const res = await pool.query(converted, params);
      return res.rows;
    },
    async run(sql, params = []) {
      let runSql = sql;
      const isInsert = /^\s*INSERT\s+INTO/i.test(sql);
      if (isInsert && !/RETURNING/i.test(sql)) {
        runSql += ' RETURNING id';
      }
      const converted = convertPlaceholders(runSql);
      const res = await pool.query(converted, params);
      return {
        changes: res.rowCount,
        lastInsertRowid: res.rows[0]?.id
      };
    },
    async exec(sql) {
      return await pool.query(sql);
    }
  };

  activeDriver = postgresDriver;
} else {
  activeDriver = getSqliteDriver();
}

// Proxy database object
const db = {
  get isPostgres() {
    return activeDriver?.isPostgres ?? isPostgres;
  },
  get pool() {
    return activeDriver?.pool;
  },
  get sqliteDb() {
    return activeDriver?.sqliteDb;
  },
  async query(sql, params = []) {
    return await activeDriver.query(sql, params);
  },
  async get(sql, params = []) {
    return await activeDriver.get(sql, params);
  },
  async all(sql, params = []) {
    return await activeDriver.all(sql, params);
  },
  async run(sql, params = []) {
    return await activeDriver.run(sql, params);
  },
  async exec(sql) {
    return await activeDriver.exec(sql);
  }
};

// Initialize tables for both Postgres and SQLite
async function initializeDatabase() {
  if (wantPostgres && activeDriver === postgresDriver) {
    try {
      console.log('[Database] Menguji koneksi ke PostgreSQL (Cloud)...');
      await activeDriver.query('SELECT 1');
      console.log('[Database] Berhasil terhubung ke PostgreSQL.');
    } catch (err) {
      console.warn(`[Database] PostgreSQL tidak dapat diakses (${err.message}).`);
      console.warn('[Database] Mengaktifkan mode aman SQLite lokal secara otomatis.');
      isPostgres = false;
      activeDriver = getSqliteDriver();
    }
  }

  if (activeDriver.isPostgres) {
    await activeDriver.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS court_rooms (
        id SERIAL PRIMARY KEY,
        room_name VARCHAR(255) NOT NULL,
        session_title VARCHAR(255) NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 50,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS participants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        identifier_num VARCHAR(255) UNIQUE NOT NULL,
        institution TEXT DEFAULT '',
        qr_token VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS room_allocations (
        id SERIAL PRIMARY KEY,
        participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES court_rooms(id) ON DELETE CASCADE,
        is_attended INTEGER NOT NULL DEFAULT 0,
        attended_at TIMESTAMP NULL,
        left_at TIMESTAMP NULL,
        UNIQUE(participant_id, room_id)
      );

      CREATE INDEX IF NOT EXISTS idx_participants_qr ON participants(qr_token);
      CREATE INDEX IF NOT EXISTS idx_allocations_room ON room_allocations(room_id);
      CREATE INDEX IF NOT EXISTS idx_allocations_participant ON room_allocations(participant_id);
    `);
  } else {
    await activeDriver.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS court_rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_name TEXT NOT NULL,
        session_title TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 50,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        identifier_num TEXT UNIQUE NOT NULL,
        institution TEXT DEFAULT '',
        qr_token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS room_allocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        room_id INTEGER NOT NULL REFERENCES court_rooms(id) ON DELETE CASCADE,
        is_attended INTEGER NOT NULL DEFAULT 0,
        attended_at DATETIME NULL,
        left_at DATETIME NULL,
        UNIQUE(participant_id, room_id)
      );

      CREATE INDEX IF NOT EXISTS idx_participants_qr ON participants(qr_token);
      CREATE INDEX IF NOT EXISTS idx_allocations_room ON room_allocations(room_id);
      CREATE INDEX IF NOT EXISTS idx_allocations_participant ON room_allocations(participant_id);
    `);

    try {
      activeDriver.sqliteDb.exec('ALTER TABLE room_allocations ADD COLUMN left_at DATETIME NULL;');
    } catch (e) {}
  }

  // Auto-seed default admin and initial data if database is freshly created
  try {
    const adminCheck = await db.get('SELECT COUNT(*) as count FROM admins');
    if (!adminCheck || Number(adminCheck.count) === 0) {
      console.log('[Database] Database baru terdeteksi. Menjalankan auto-seeding data awal...');
      const runSeeder = require('../seed/seeder');
      await runSeeder({ ensureTables: false });
    }
  } catch (err) {
    console.error('[Database] Check admin table error:', err);
  }
}

module.exports = {
  db,
  initializeDatabase,
  get isPostgres() {
    return activeDriver?.isPostgres ?? isPostgres;
  }
};
