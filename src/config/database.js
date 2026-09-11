const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'muspimnas.db');

// Use Node's built-in node:sqlite (available in Node 22+ / 24+)
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

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
      UNIQUE(participant_id, room_id),
      FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES court_rooms(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_participants_qr ON participants(qr_token);
    CREATE INDEX IF NOT EXISTS idx_allocations_room ON room_allocations(room_id);
    CREATE INDEX IF NOT EXISTS idx_allocations_participant ON room_allocations(participant_id);
  `);
}

initializeDatabase();

module.exports = {
  db,
  initializeDatabase,
  dbPath
};
