const { db } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');

const participantService = {
  /**
   * Create a new participant with unique UUID v4 qr_token
   */
  createParticipant({ name, identifier_num, institution = '', roomId = null }) {
    const qr_token = uuidv4();

    // Check unique identifier_num
    const existing = db.prepare('SELECT id FROM participants WHERE identifier_num = ?').get(identifier_num);
    if (existing) {
      throw new Error(`NIM/NIK ${identifier_num} sudah terdaftar dalam sistem.`);
    }

    const insertStmt = db.prepare(`
      INSERT INTO participants (name, identifier_num, institution, qr_token)
      VALUES (?, ?, ?, ?)
    `);

    const result = insertStmt.run(name.trim(), identifier_num.trim(), institution.trim(), qr_token);
    const participantId = Number(result.lastInsertRowid);

    if (roomId) {
      this.assignRoom(participantId, Number(roomId));
    }

    return this.getParticipantById(participantId);
  },

  /**
   * Update participant details and optional room allocation
   */
  updateParticipant(id, { name, identifier_num, institution = '', roomId = null }) {
    const existing = db.prepare('SELECT id FROM participants WHERE identifier_num = ? AND id != ?').get(identifier_num, id);
    if (existing) {
      throw new Error(`NIM/NIK ${identifier_num} sudah digunakan oleh peserta lain.`);
    }

    db.prepare(`
      UPDATE participants 
      SET name = ?, identifier_num = ?, institution = ?
      WHERE id = ?
    `).run(name.trim(), identifier_num.trim(), institution.trim(), id);

    if (roomId !== undefined) {
      if (roomId) {
        this.assignRoom(id, Number(roomId));
      } else {
        // Remove room allocation if cleared
        db.prepare('DELETE FROM room_allocations WHERE participant_id = ?').run(id);
      }
    }

    return this.getParticipantById(id);
  },

  /**
   * Delete participant
   */
  deleteParticipant(id) {
    db.prepare('DELETE FROM room_allocations WHERE participant_id = ?').run(id);
    const result = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * Assign or reassign participant to a room
   */
  assignRoom(participantId, roomId) {
    // Check if participant already has an allocation
    const existing = db.prepare('SELECT id, room_id FROM room_allocations WHERE participant_id = ?').get(participantId);
    if (existing) {
      db.prepare('UPDATE room_allocations SET room_id = ? WHERE participant_id = ?').run(roomId, participantId);
    } else {
      db.prepare('INSERT INTO room_allocations (participant_id, room_id, is_attended) VALUES (?, ?, 0)').run(participantId, roomId);
    }
  },

  /**
   * Bulk assign multiple participants to a room
   */
  bulkAssignRoom(participantIds, roomId) {
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      throw new Error('Tidak ada peserta yang dipilih untuk penugasan ruangan.');
    }

    // Verify room exists
    const room = db.prepare('SELECT id, room_name FROM court_rooms WHERE id = ?').get(roomId);
    if (!room) {
      throw new Error('Ruangan sidang yang dipilih tidak ditemukan.');
    }

    let updatedCount = 0;
    for (const pId of participantIds) {
      this.assignRoom(Number(pId), Number(roomId));
      updatedCount++;
    }

    return {
      updatedCount,
      roomName: room.room_name
    };
  },

  /**
   * Get single participant with full allocation details
   */
  getParticipantById(id) {
    return db.prepare(`
      SELECT 
        p.*,
        ra.room_id,
        ra.is_attended,
        ra.attended_at,
        cr.room_name,
        cr.session_title
      FROM participants p
      LEFT JOIN room_allocations ra ON p.id = ra.participant_id
      LEFT JOIN court_rooms cr ON ra.room_id = cr.id
      WHERE p.id = ?
    `).get(id);
  },

  /**
   * Find participant by QR Token
   */
  getParticipantByToken(token) {
    return db.prepare(`
      SELECT 
        p.*,
        ra.room_id,
        ra.is_attended,
        ra.attended_at,
        cr.room_name,
        cr.session_title
      FROM participants p
      LEFT JOIN room_allocations ra ON p.id = ra.participant_id
      LEFT JOIN court_rooms cr ON ra.room_id = cr.id
      WHERE p.qr_token = ?
    `).get(token);
  },

  /**
   * Get all participants with filters, search, and pagination
   */
  getAllParticipants({ search = '', roomId = '', attendanceStatus = '', page = 1, limit = 50 } = {}) {
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(p.name LIKE ? OR p.identifier_num LIKE ? OR p.institution LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (roomId) {
      if (roomId === 'unassigned') {
        conditions.push('ra.room_id IS NULL');
      } else {
        conditions.push('ra.room_id = ?');
        params.push(Number(roomId));
      }
    }

    if (attendanceStatus !== '') {
      if (attendanceStatus === 'attended') {
        conditions.push('ra.is_attended = 1');
      } else if (attendanceStatus === 'not_attended') {
        conditions.push('(ra.is_attended = 0 OR ra.is_attended IS NULL)');
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `
      SELECT COUNT(*) as total
      FROM participants p
      LEFT JOIN room_allocations ra ON p.id = ra.participant_id
      ${whereClause}
    `;
    const countRow = db.prepare(countSql).get(...params);
    const total = countRow ? Number(countRow.total) : 0;

    // Data query
    const offset = (page - 1) * limit;
    const dataSql = `
      SELECT 
        p.id,
        p.name,
        p.identifier_num,
        p.institution,
        p.qr_token,
        p.created_at,
        ra.room_id,
        ra.is_attended,
        ra.attended_at,
        cr.room_name,
        cr.session_title
      FROM participants p
      LEFT JOIN room_allocations ra ON p.id = ra.participant_id
      LEFT JOIN court_rooms cr ON ra.room_id = cr.id
      ${whereClause}
      ORDER BY p.id DESC
      LIMIT ? OFFSET ?
    `;
    
    const rows = db.prepare(dataSql).all(...params, limit, offset);

    return {
      participants: rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / limit) || 1
    };
  },

  /**
   * Get participants data for ID Card generation with rendered QR Codes
   */
  async getParticipantsForPrint(ids) {
    if (!ids || ids.length === 0) return [];
    
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
      SELECT 
        p.id,
        p.name,
        p.identifier_num,
        p.institution,
        p.qr_token,
        cr.room_name,
        cr.session_title
      FROM participants p
      LEFT JOIN room_allocations ra ON p.id = ra.participant_id
      LEFT JOIN court_rooms cr ON ra.room_id = cr.id
      WHERE p.id IN (${placeholders})
      ORDER BY p.id ASC
    `;

    const rows = db.prepare(sql).all(...ids.map(Number));

    // Generate DataURL QR Code for each
    const cards = await Promise.all(
      rows.map(async (p) => {
        const qrDataUrl = await QRCode.toDataURL(p.qr_token, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
          color: {
            dark: '#1e293b',
            light: '#ffffff'
          }
        });

        return {
          ...p,
          qrDataUrl,
          room_name: p.room_name || 'Belum Ditugaskan',
          session_title: p.session_title || 'Sesi Umum'
        };
      })
    );

    return cards;
  }
};

module.exports = participantService;
