const { db } = require('../config/database');

const verificationService = {
  /**
   * Verify QR token scan against selected room
   * 
   * @param {string} qrToken - Scanned QR token (UUID)
   * @param {number|string} roomId - Guarded court room ID
   * @returns {object} Verification result with status, message, and participant data
   */
  verifyScan(qrToken, roomId) {
    if (!qrToken || typeof qrToken !== 'string') {
      return {
        status: 'INVALID_TOKEN',
        success: false,
        message: 'Kode QR kosong atau tidak terbaca dengan baik.'
      };
    }

    const cleanToken = qrToken.trim();
    const targetRoomId = Number(roomId);

    // Verify room exists and active
    const targetRoom = db.prepare('SELECT * FROM court_rooms WHERE id = ?').get(targetRoomId);
    if (!targetRoom) {
      return {
        status: 'ROOM_NOT_FOUND',
        success: false,
        message: 'Ruangan sidang yang dipilih tidak valid atau sudah dihapus.'
      };
    }

    // 1. Find participant by token
    const participant = db.prepare('SELECT * FROM participants WHERE qr_token = ?').get(cleanToken);
    if (!participant) {
      return {
        status: 'INVALID_TOKEN',
        success: false,
        message: 'Akses Ditolak! QR Code tidak terdaftar dalam sistem peserta sidang.'
      };
    }

    // 2. Check room allocation
    const allocation = db.prepare(`
      SELECT ra.*, cr.room_name, cr.session_title 
      FROM room_allocations ra
      JOIN court_rooms cr ON ra.room_id = cr.id
      WHERE ra.participant_id = ?
    `).get(participant.id);

    if (!allocation) {
      return {
        status: 'UNALLOCATED',
        success: false,
        message: `Akses Ditolak! Peserta "${participant.name}" (${participant.identifier_num}) belum dialokasikan ke ruangan sidang manapun.`,
        participant: {
          id: participant.id,
          name: participant.name,
          identifier_num: participant.identifier_num,
          institution: participant.institution
        }
      };
    }

    // Check if participant is in the wrong room
    if (allocation.room_id !== targetRoomId) {
      return {
        status: 'WRONG_ROOM',
        success: false,
        message: `SALAH RUANG SIDANG! Peserta "${participant.name}" seharusnya masuk ke "${allocation.room_name}" (${allocation.session_title}).`,
        participant: {
          id: participant.id,
          name: participant.name,
          identifier_num: participant.identifier_num,
          institution: participant.institution,
          correct_room: allocation.room_name,
          correct_session: allocation.session_title
        }
      };
    }

    // 3. Anti-Duplicate check: already attended
    if (allocation.is_attended === 1) {
      return {
        status: 'ALREADY_ATTENDED',
        success: false,
        message: `PERINGATAN! Peserta "${participant.name}" sudah diverifikasi masuk sebelumnya pada ${allocation.attended_at}.`,
        participant: {
          id: participant.id,
          name: participant.name,
          identifier_num: participant.identifier_num,
          institution: participant.institution,
          attended_at: allocation.attended_at,
          room_name: targetRoom.room_name
        }
      };
    }

    // 4. Access Granted: update is_attended & attended_at
    const now = new Date().toLocaleString('sv-SE', { timeZoneName: 'short' }).replace(' ', 'T').slice(0, 19).replace('T', ' ');
    db.prepare(`
      UPDATE room_allocations 
      SET is_attended = 1, attended_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(allocation.id);

    // Fetch updated record with current timestamp
    const updatedAllocation = db.prepare('SELECT attended_at FROM room_allocations WHERE id = ?').get(allocation.id);

    return {
      status: 'SUCCESS',
      success: true,
      message: `AKSES DITERIMA! Selamat datang di ${targetRoom.room_name}.`,
      participant: {
        id: participant.id,
        name: participant.name,
        identifier_num: participant.identifier_num,
        institution: participant.institution,
        room_name: targetRoom.room_name,
        session_title: targetRoom.session_title,
        attended_at: updatedAllocation.attended_at
      }
    };
  },

  /**
   * Get recent scans for a specific room to display live feed
   */
  getRecentScans(roomId, limit = 10) {
    return db.prepare(`
      SELECT 
        p.name,
        p.identifier_num,
        p.institution,
        ra.attended_at,
        ra.is_attended
      FROM room_allocations ra
      JOIN participants p ON ra.participant_id = p.id
      WHERE ra.room_id = ? AND ra.is_attended = 1
      ORDER BY ra.attended_at DESC
      LIMIT ?
    `).all(Number(roomId), limit);
  },

  /**
   * Reset attendance for a participant (Admin override)
   */
  resetAttendance(participantId, roomId) {
    db.prepare(`
      UPDATE room_allocations 
      SET is_attended = 0, attended_at = NULL 
      WHERE participant_id = ? AND room_id = ?
    `).run(participantId, roomId);
    return true;
  }
};

module.exports = verificationService;
