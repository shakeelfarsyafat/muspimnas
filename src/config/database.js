const path = require('path');
const fs = require('fs');
const os = require('os');

// Determine writable directory for SQLite database
// In serverless environments like Vercel (Linux) / AWS Lambda, use os.tmpdir() (/tmp)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
let dataDir;

if (isServerless) {
  dataDir = os.tmpdir();
} else {
  dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (e) {
      console.warn('Could not create data directory, using os.tmpdir() as fallback:', e);
      dataDir = os.tmpdir();
    }
  }
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'muspimnas.db');

// Use Node's built-in node:sqlite (available in Node 22+ / 24+)
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode
try {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
} catch (e) {
  console.warn('Pragma setup warning:', e);
}

// Initialize tables
function initializeDatabase() {
  db.exec(`
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
      participant_id INTEGER NOT NULL,
      room_id INTEGER NOT NULL,
      is_attended INTEGER NOT NULL DEFAULT 0,
      attended_at DATETIME NULL,
      left_at DATETIME NULL,
      UNIQUE(participant_id, room_id),
      FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES court_rooms(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_participants_qr ON participants(qr_token);
    CREATE INDEX IF NOT EXISTS idx_allocations_room ON room_allocations(room_id);
    CREATE INDEX IF NOT EXISTS idx_allocations_participant ON room_allocations(participant_id);
  `);

  // Migrate schema if left_at doesn't exist yet
  try {
    db.exec('ALTER TABLE room_allocations ADD COLUMN left_at DATETIME NULL;');
  } catch (e) {
    // Column already exists, safe to ignore
  }
}

initializeDatabase();

module.exports = {
  db,
  initializeDatabase,
  dbPath
};

// Check if database needs initial seeding AFTER module.exports is populated
try {
  const adminCheck = db.prepare('SELECT COUNT(*) as count FROM admins').get();
  if (!adminCheck || Number(adminCheck.count) === 0) {
    console.log('Database baru terdeteksi. Menjalankan auto-seeding data awal...');
    const runSeeder = require('../seed/seeder');
    runSeeder().catch(err => console.error('Auto-seed error:', err));
  }
} catch (err) {
  console.error('Check admin table error:', err);
}
