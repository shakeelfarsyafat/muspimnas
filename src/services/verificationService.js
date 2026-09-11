const { db } = require('../config/database');

function getNowFormatted() {
  const d = new Date();
  try {
    const parts = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(d);
    return parts.replace(/\./g, ':');
  } catch (e) {
    return d.toLocaleTimeString('id-ID');
  }
}

const verificationService = {
  /**
   * Verify QR token scan against selected room (Supports 'in' or 'out' mode - High-Speed Query)
   */
  async verifyScan(qrToken, roomId, mode = 'in') {
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

    // Parallel fetch: room data & participant with allocation info
    const [targetRoom, allocData] = await Promise.all([
      db.get('SELECT id, room_name, session_title FROM court_rooms WHERE id = ?', [targetRoomId]),
      db.get(`
        SELECT 
          p.id AS participant_id,
          p.name,
          p.identifier_num,
          p.institution,
          ra.id AS allocation_id,
          ra.room_id,
          ra.is_attended,
          ra.attended_at,
          ra.left_at,
          cr.room_name AS alloc_room_name,
          cr.session_title AS alloc_session_title
        FROM participants p
        LEFT JOIN room_allocations ra ON ra.participant_id = p.id
        LEFT JOIN court_rooms cr ON cr.id = ra.room_id
        WHERE p.qr_token = ?
        ORDER BY (CASE WHEN ra.room_id = ? THEN 0 ELSE 1 END) ASC
        LIMIT 1
      `, [cleanToken, targetRoomId])
    ]);

    if (!targetRoom) {
      return {
        status: 'ROOM_NOT_FOUND',
        success: false,
        message: 'Ruangan sidang yang dipilih tidak valid atau sudah dihapus.'
      };
    }

    if (!allocData) {
      return {
        status: 'INVALID_TOKEN',
        success: false,
        message: 'Akses Ditolak! QR Code tidak terdaftar dalam sistem peserta sidang.'
      };
    }

    if (!allocData.allocation_id) {
      return {
        status: 'UNALLOCATED',
        success: false,
        message: `Akses Ditolak! Peserta "${allocData.name}" (${allocData.identifier_num}) belum dialokasikan ke ruangan sidang manapun.`,
        participant: {
          id: allocData.participant_id,
          name: allocData.name,
          identifier_num: allocData.identifier_num,
          institution: allocData.institution
        }
      };
    }

    // Check if participant is in the wrong room
    if (allocData.room_id !== targetRoomId) {
      return {
        status: 'WRONG_ROOM',
        success: false,
        message: `SALAH RUANG SIDANG! Peserta "${allocData.name}" seharusnya ke "${allocData.alloc_room_name}" (${allocData.alloc_session_title}).`,
        participant: {
          id: allocData.participant_id,
          name: allocData.name,
          identifier_num: allocData.identifier_num,
          institution: allocData.institution,
          correct_room: allocData.alloc_room_name,
          correct_session: allocData.alloc_session_title
        }
      };
    }

    const currentLocalTime = getNowFormatted();

    // ==========================================
    // MODE: PRESENSI KELUAR (Check-Out)
    // ==========================================
    if (scanMode === 'out') {
      if (allocData.is_attended !== 1) {
        return {
          status: 'NOT_ATTENDED',
          success: false,
          message: `DITOLAK! Peserta "${allocData.name}" belum tercatat hadir di ruangan ini, sehingga tidak dapat presensi keluar.`,
          participant: {
            id: allocData.participant_id,
            name: allocData.name,
            identifier_num: allocData.identifier_num,
            institution: allocData.institution
          }
        };
      }

      if (allocData.left_at) {
        return {
          status: 'ALREADY_LEFT',
          success: false,
          message: `PERINGATAN! Peserta "${allocData.name}" sudah tercatat keluar sebelumnya.`,
          participant: {
            id: allocData.participant_id,
            name: allocData.name,
            identifier_num: allocData.identifier_num,
            institution: allocData.institution,
            left_at: allocData.left_at
          }
        };
      }

      // Record exit timestamp
      await db.run('UPDATE room_allocations SET left_at = CURRENT_TIMESTAMP WHERE id = ?', [allocData.allocation_id]);

      return {
        status: 'SUCCESS_OUT',
        scan_type: 'KELUAR',
        success: true,
        message: `PRESENSI KELUAR BERHASIL! Peserta "${allocData.name}" telah tercatat keluar dari ${targetRoom.room_name}.`,
        participant: {
          id: allocData.participant_id,
          name: allocData.name,
          identifier_num: allocData.identifier_num,
          institution: allocData.institution,
          room_name: targetRoom.room_name,
          session_title: targetRoom.session_title,
          attended_at: allocData.attended_at,
          left_at: new Date().toISOString(),
          time_display: currentLocalTime
        }
      };
    }

    // ==========================================
    // MODE: PRESENSI MASUK / HADIR (Check-In)
    // ==========================================
    // Anti-Duplicate check: already inside and has NOT exited
    if (allocData.is_attended === 1 && !allocData.left_at) {
      return {
        status: 'ALREADY_ATTENDED',
        success: false,
        message: `PERINGATAN! Peserta "${allocData.name}" sudah diverifikasi masuk dan sedang di dalam ruangan.`,
        participant: {
          id: allocData.participant_id,
          name: allocData.name,
          identifier_num: allocData.identifier_num,
          institution: allocData.institution,
          attended_at: allocData.attended_at,
          room_name: targetRoom.room_name
        }
      };
    }

    // If re-entering after previously exiting
    const isReentry = allocData.is_attended === 1 && allocData.left_at;

    await db.run('UPDATE room_allocations SET is_attended = 1, attended_at = CURRENT_TIMESTAMP, left_at = NULL WHERE id = ?', [allocData.allocation_id]);

    return {
      status: isReentry ? 'SUCCESS_REENTRY' : 'SUCCESS',
      scan_type: 'MASUK',
      success: true,
      message: isReentry 
        ? `AKSES MASUK KEMBALI DITERIMA! Selamat datang kembali di ${targetRoom.room_name}.`
        : `AKSES DITERIMA! Selamat datang di ${targetRoom.room_name}.`,
      participant: {
        id: allocData.participant_id,
        name: allocData.name,
        identifier_num: allocData.identifier_num,
        institution: allocData.institution,
        room_name: targetRoom.room_name,
        session_title: targetRoom.session_title,
        attended_at: new Date().toISOString(),
        left_at: null,
        time_display: currentLocalTime
      }
    };
  },

  /**
   * Get recent scans for a specific room to display live feed (Both Masuk & Keluar)
   */
  async getRecentScans(roomId, limit = 15) {
    return await db.all(`
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
    `, [Number(roomId), limit]);
  },

  /**
   * Reset attendance for a participant (Admin override)
   */
  async resetAttendance(participantId, roomId) {
    await db.run(`
      UPDATE room_allocations 
      SET is_attended = 0, attended_at = NULL, left_at = NULL
      WHERE participant_id = ? AND room_id = ?
    `, [participantId, roomId]);
    return true;
  }
};

module.exports = verificationService;
