const { db } = require('../config/database');

const verificationService = {
  /**
   * Verify QR token scan against selected room (Supports 'in' or 'out' mode)
   * 
   * @param {string} qrToken - Scanned QR token (UUID)
   * @param {number|string} roomId - Guarded court room ID
   * @param {string} mode - 'in' (Masuk/Hadir) or 'out' (Keluar Ruangan)
   * @returns {object} Verification result with status, message, and participant data
   */
  verifyScan(qrToken, roomId, mode = 'in') {
    if (!qrToken || typeof qrToken !== 'string') {
      return {
        status: 'INVALID_TOKEN',
        success: false,
        message: 'Kode QR kosong atau tidak terbaca dengan baik.'
      };
    }

    const cleanToken = qrToken.trim();
    const targetRoomId = Number(roomId);
    const scanMode = mode === 'out' ? 'out' : 'in';

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
        message: `SALAH RUANG SIDANG! Peserta "${participant.name}" seharusnya ke "${allocation.room_name}" (${allocation.session_title}).`,
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

    // ==========================================
    // MODE: PRESENSI KELUAR (Check-Out)
    // ==========================================
    if (scanMode === 'out') {
      if (allocation.is_attended !== 1) {
        return {
          status: 'NOT_ATTENDED',
          success: false,
          message: `DITOLAK! Peserta "${participant.name}" belum tercatat hadir di ruangan ini, sehingga tidak dapat presensi keluar.`,
          participant: {
            id: participant.id,
            name: participant.name,
            identifier_num: participant.identifier_num,
            institution: participant.institution
          }
        };
      }

      if (allocation.left_at) {
        return {
          status: 'ALREADY_LEFT',
          success: false,
          message: `PERINGATAN! Peserta "${participant.name}" sudah tercatat keluar sebelumnya pada ${allocation.left_at}.`,
          participant: {
            id: participant.id,
            name: participant.name,
            identifier_num: participant.identifier_num,
            institution: participant.institution,
            left_at: allocation.left_at
          }
        };
      }

      // Record exit timestamp
      db.prepare(`
        UPDATE room_allocations 
        SET left_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(allocation.id);

      const updatedAllocation = db.prepare('SELECT attended_at, left_at FROM room_allocations WHERE id = ?').get(allocation.id);

      return {
        status: 'SUCCESS_OUT',
        scan_type: 'KELUAR',
        success: true,
        message: `PRESENSI KELUAR BERHASIL! Peserta "${participant.name}" telah tercatat keluar dari ${targetRoom.room_name}.`,
        participant: {
          id: participant.id,
          name: participant.name,
          identifier_num: participant.identifier_num,
          institution: participant.institution,
          room_name: targetRoom.room_name,
          session_title: targetRoom.session_title,
          attended_at: updatedAllocation.attended_at,
          left_at: updatedAllocation.left_at
        }
      };
    }

    // ==========================================
    // MODE: PRESENSI MASUK / HADIR (Check-In)
    // ==========================================
    // Anti-Duplicate check: already inside and has NOT exited
    if (allocation.is_attended === 1 && !allocation.left_at) {
      return {
        status: 'ALREADY_ATTENDED',
        success: false,
        message: `PERINGATAN! Peserta "${participant.name}" sudah diverifikasi masuk dan sedang di dalam ruangan sejak ${allocation.attended_at}.`,
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

    // If re-entering after previously exiting
    const isReentry = allocation.is_attended === 1 && allocation.left_at;

    db.prepare(`
      UPDATE room_allocations 
      SET is_attended = 1, attended_at = CURRENT_TIMESTAMP, left_at = NULL
      WHERE id = ?
    `).run(allocation.id);

    const updatedAllocation = db.prepare('SELECT attended_at, left_at FROM room_allocations WHERE id = ?').get(allocation.id);

    return {
      status: isReentry ? 'SUCCESS_REENTRY' : 'SUCCESS',
      scan_type: 'MASUK',
      success: true,
      message: isReentry 
        ? `AKSES MASUK KEMBALI DITERIMA! Selamat datang kembali di ${targetRoom.room_name}.`
        : `AKSES DITERIMA! Selamat datang di ${targetRoom.room_name}.`,
      participant: {
        id: participant.id,
        name: participant.name,
        identifier_num: participant.identifier_num,
        institution: participant.institution,
        room_name: targetRoom.room_name,
        session_title: targetRoom.session_title,
        attended_at: updatedAllocation.attended_at,
        left_at: null
      }
    };
  },

  /**
   * Get recent scans for a specific room to display live feed (Both Masuk & Keluar)
   */
  getRecentScans(roomId, limit = 15) {
    return db.prepare(`
      SELECT 
        p.name,
        p.identifier_num,
        p.institution,
        ra.attended_at,
        ra.left_at,
        ra.is_attended,
        CASE 
          WHEN ra.left_at IS NOT NULL THEN 'KELUAR'
          WHEN ra.is_attended = 1 THEN 'MASUK'
          ELSE 'BELUM'
        END as scan_action,
        COALESCE(ra.left_at, ra.attended_at) as event_time
      FROM room_allocations ra
      JOIN participants p ON ra.participant_id = p.id
      WHERE ra.room_id = ? AND ra.is_attended = 1
      ORDER BY COALESCE(ra.left_at, ra.attended_at) DESC
      LIMIT ?
    `).all(Number(roomId), limit);
  },

  /**
   * Reset attendance for a participant (Admin override)
   */
  resetAttendance(participantId, roomId) {
    db.prepare(`
      UPDATE room_allocations 
      SET is_attended = 0, attended_at = NULL, left_at = NULL
      WHERE participant_id = ? AND room_id = ?
    `).run(participantId, roomId);
    return true;
  }
};

module.exports = verificationService;
