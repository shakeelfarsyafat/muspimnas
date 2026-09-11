const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { db, initializeDatabase } = require('../config/database');

async function runSeeder() {
  console.log('--- Memulai Database Seeding MUSPIMNAS ---');

  // Ensure tables exist
  initializeDatabase();

  // 1. Seed Default Admin
  const adminUsername = 'admin';
  const adminPassword = 'admin123';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(adminPassword, salt);

  const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(adminUsername);
  if (!existingAdmin) {
    db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(adminUsername, passwordHash);
    console.log(`[+] Admin default dibuat: ${adminUsername} / ${adminPassword}`);
  } else {
    // Refresh password hash to ensure admin123 works
    db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(passwordHash, adminUsername);
    console.log(`[*] Admin default diperbarui: ${adminUsername} / ${adminPassword}`);
  }

  // 2. Seed Master Court Rooms
  const roomsData = [
    {
      room_name: 'Ruang Sidang Pleno Utama (Graha Kencana)',
      session_title: 'Sesi Pembukaan & Sidang Pleno Muspimnas',
      capacity: 150,
      is_active: 1
    },
    {
      room_name: 'Ruang Sidang Komisi A (Ruang Mahoni)',
      session_title: 'Sidang Komisi Keorganisasian & AD/ART',
      capacity: 50,
      is_active: 1
    },
    {
      room_name: 'Ruang Sidang Komisi B (Ruang Cendana)',
      session_title: 'Sidang Komisi Program Kerja & Resolusi',
      capacity: 45,
      is_active: 1
    }
  ];

  const insertedRoomIds = [];
  for (const r of roomsData) {
    const existingRoom = db.prepare('SELECT id FROM court_rooms WHERE room_name = ?').get(r.room_name);
    if (!existingRoom) {
      const res = db.prepare(`
        INSERT INTO court_rooms (room_name, session_title, capacity, is_active)
        VALUES (?, ?, ?, ?)
      `).run(r.room_name, r.session_title, r.capacity, r.is_active);
      insertedRoomIds.push(Number(res.lastInsertRowid));
      console.log(`[+] Ruang Sidang dibuat: ${r.room_name}`);
    } else {
      insertedRoomIds.push(existingRoom.id);
    }
  }

  // 3. Seed Sample Participants
  const participantsData = [
    {
      name: 'Dr. Ahmad Fauzi, M.Si',
      identifier_num: 'NIP.198204152008011005',
      institution: 'Pengurus Wilayah DKI Jakarta',
      roomIdx: 0, // Pleno
      is_attended: 1
    },
    {
      name: 'Siti Nurhaliza, S.H., M.H.',
      identifier_num: 'NIM.20210710023',
      institution: 'Delegasi Jawa Barat (Bandung)',
      roomIdx: 0, // Pleno
      is_attended: 0
    },
    {
      name: 'Muhammad Rizky Pratama',
      identifier_num: 'NIM.20220815044',
      institution: 'Delegasi Jawa Timur (Surabaya)',
      roomIdx: 1, // Komisi A
      is_attended: 0
    },
    {
      name: 'Putri Rahmawati, S.Kom',
      identifier_num: 'NIK.3273016508990001',
      institution: 'Delegasi Jawa Tengah (Semarang)',
      roomIdx: 1, // Komisi A
      is_attended: 0
    },
    {
      name: 'Budi Santoso, S.T.',
      identifier_num: 'NIK.3175021203900004',
      institution: 'Pengurus Cabang D.I. Yogyakarta',
      roomIdx: 2, // Komisi B
      is_attended: 0
    },
    {
      name: 'Dewi Lestari, S.Pd',
      identifier_num: 'NIM.20200922019',
      institution: 'Delegasi Sumatera Utara (Medan)',
      roomIdx: 2, // Komisi B
      is_attended: 0
    },
    {
      name: 'H. Mochammad Ilham, M.M.',
      identifier_num: 'NIK.3578010405810002',
      institution: 'Delegasi Sulawesi Selatan (Makassar)',
      roomIdx: 0, // Pleno
      is_attended: 0
    },
    {
      name: 'Rian Hidayat, S.IP',
      identifier_num: 'NIM.20230114098',
      institution: 'Delegasi Kalimantan Timur (Samarinda)',
      roomIdx: 1, // Komisi A
      is_attended: 0
    },
    {
      name: 'Aisyah Putri Kusuma',
      identifier_num: 'NIM.20220311055',
      institution: 'Delegasi Bali & Nusa Tenggara',
      roomIdx: null, // Belum dialokasikan
      is_attended: 0
    },
    {
      name: 'Farhan Maulana Akbar',
      identifier_num: 'NIM.20240101012',
      institution: 'Delegasi Lampung & Bengkulu',
      roomIdx: null, // Belum dialokasikan
      is_attended: 0
    }
  ];

  for (const p of participantsData) {
    let participant = db.prepare('SELECT id, qr_token FROM participants WHERE identifier_num = ?').get(p.identifier_num);
    let participantId;

    if (!participant) {
      const qr_token = uuidv4();
      const res = db.prepare(`
        INSERT INTO participants (name, identifier_num, institution, qr_token)
        VALUES (?, ?, ?, ?)
      `).run(p.name, p.identifier_num, p.institution, qr_token);
      participantId = Number(res.lastInsertRowid);
      console.log(`[+] Peserta dibuat: ${p.name} (${p.identifier_num}) -> QR: ${qr_token.slice(0, 8)}...`);
    } else {
      participantId = participant.id;
    }

    // Allocate room if specified
    if (p.roomIdx !== null && insertedRoomIds[p.roomIdx]) {
      const targetRoomId = insertedRoomIds[p.roomIdx];
      const existingAlloc = db.prepare('SELECT id FROM room_allocations WHERE participant_id = ?').get(participantId);
      
      const attendedAt = p.is_attended ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;

      if (!existingAlloc) {
        db.prepare(`
          INSERT INTO room_allocations (participant_id, room_id, is_attended, attended_at)
          VALUES (?, ?, ?, ?)
        `).run(participantId, targetRoomId, p.is_attended, attendedAt);
      } else {
        db.prepare(`
          UPDATE room_allocations 
          SET room_id = ?, is_attended = ?, attended_at = ?
          WHERE id = ?
        `).run(targetRoomId, p.is_attended, attendedAt, existingAlloc.id);
      }
    }
  }

  console.log('--- Database Seeding Selesai Sukses! ---');
}

if (require.main === module) {
  runSeeder().catch(err => {
    console.error('Error saat seeding database:', err);
    process.exit(1);
  });
}

module.exports = runSeeder;
