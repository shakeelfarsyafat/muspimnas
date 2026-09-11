const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});
const { requireAuth } = require('../middleware/auth');
const participantService = require('../services/participantService');
const roomService = require('../services/roomService');

// GET / or /dashboard (Requires Admin Auth)
router.get(['/', '/dashboard'], requireAuth, async (req, res) => {
  try {
    const { search = '', room = '', status = '', page = 1 } = req.query;

    const data = await participantService.getAllParticipants({
      search,
      roomId: room,
      attendanceStatus: status,
      page: parseInt(page, 10) || 1,
      limit: 25
    });

    const rooms = await roomService.getAllRooms({ activeOnly: true });
    const systemOverview = await roomService.getSystemOverview();

    res.render('dashboard', {
      title: 'Dashboard Manajemen Peserta Sidang',
      currentAdmin: req.session.admin,
      participants: data.participants,
      total: data.total,
      page: data.page,
      totalPages: data.totalPages,
      rooms,
      systemOverview,
      query: { search, room, status }
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Terjadi kesalahan memuat dashboard: ' + err.message);
  }
});

// Protect participant APIs
router.use('/api/participants', requireAuth);

// API: Add new participant
router.post('/api/participants', async (req, res) => {
  try {
    const { name, identifier_num, institution, room_id } = req.body;
    if (!name || !identifier_num) {
      return res.status(400).json({
        success: false,
        message: 'Nama Lengkap dan Nomor Identitas (NIM/NIK) wajib diisi.'
      });
    }

    const participant = await participantService.createParticipant({
      name,
      identifier_num,
      institution,
      roomId: room_id ? Number(room_id) : null
    });

    return res.json({
      success: true,
      message: 'Peserta berhasil didaftarkan!',
      participant
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Gagal menambahkan peserta.'
    });
  }
});

// API: Download Excel Template
router.get('/api/participants/template', async (req, res) => {
  try {
    const rooms = await roomService.getAllRooms();
    const roomNames = rooms.map(r => r.room_name);

    const headers = ['Nama Lengkap', 'Nomor Identitas', 'Instansi', 'Ruangan Sidang'];
    const data = [
      {
        'Nama Lengkap': 'Dr. H. Bambang Sudibyo, M.Si',
        'Nomor Identitas': '3201012304900001',
        'Instansi': 'DPW Jawa Barat',
        'Ruangan Sidang': roomNames[0] || 'Ruang Sidang Komisi A (Ruang Mahoni)'
      },
      {
        'Nama Lengkap': 'Siti Rahmawati, S.Pd',
        'Nomor Identitas': '20210811002',
        'Instansi': 'DPC Kota Bandung',
        'Ruangan Sidang': roomNames[1] || 'Ruang Sidang Komisi B (Ruang Cendana)'
      },
      {
        'Nama Lengkap': 'Ahmad Fauzi, S.T.',
        'Nomor Identitas': '198504122010011002',
        'Instansi': 'Universitas Indonesia',
        'Ruangan Sidang': ''
      }
    ];

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(data, { header: headers });
    ws['!cols'] = [{ wch: 32 }, { wch: 25 }, { wch: 30 }, { wch: 42 }];
    xlsx.utils.book_append_sheet(wb, ws, 'Template Peserta');

    // Sheet 2: Referensi Ruangan Sidang yang Terdaftar
    if (rooms.length > 0) {
      const roomSheetData = rooms.map(r => ({
        'ID Ruangan': r.id,
        'Nama Ruangan': r.room_name,
        'Judul Sesi': r.session_title,
        'Kapasitas': r.capacity
      }));
      const wsRooms = xlsx.utils.json_to_sheet(roomSheetData);
      wsRooms['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 40 }, { wch: 12 }];
      xlsx.utils.book_append_sheet(wb, wsRooms, 'Daftar Ruangan Referensi');
    }

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_peserta_muspimnas.xlsx"');
    return res.send(buffer);
  } catch (err) {
    console.error('Template export error:', err);
    return res.status(500).send('Gagal membuat template Excel: ' + err.message);
  }
});

// API: Import Participants via Excel
router.post('/api/participants/import-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'File Excel belum dipilih atau tidak valid.'
      });
    }

    const defaultRoomId = req.body.default_room_id ? Number(req.body.default_room_id) : null;
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File Excel kosong atau tidak ditemukan baris data peserta.'
      });
    }

    const result = await participantService.importParticipants(rows, defaultRoomId);

    return res.json({
      success: true,
      message: `Impor data selesai! ${result.imported} peserta berhasil ditambahkan, ${result.skipped} dilewati.`,
      result
    });
  } catch (err) {
    console.error('Import excel error:', err);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses file Excel: ' + (err.message || err)
    });
  }
});

// API: Get single participant
router.get('/api/participants/:id', async (req, res) => {
  try {
    const participant = await participantService.getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
    }
    return res.json({ success: true, participant });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// API: Update participant
router.put('/api/participants/:id', async (req, res) => {
  try {
    const { name, identifier_num, institution, room_id } = req.body;
    if (!name || !identifier_num) {
      return res.status(400).json({
        success: false,
        message: 'Nama Lengkap dan Nomor Identitas wajib diisi.'
      });
    }

    const updated = await participantService.updateParticipant(req.params.id, {
      name,
      identifier_num,
      institution,
      roomId: room_id ? Number(room_id) : null
    });

    return res.json({
      success: true,
      message: 'Data peserta berhasil diperbarui!',
      participant: updated
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Gagal memperbarui data peserta.'
    });
  }
});

// API: Delete participant
router.delete('/api/participants/:id', async (req, res) => {
  try {
    const success = await participantService.deleteParticipant(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Peserta berhasil dihapus.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// API: Bulk Assign Participants to a Room
router.post('/api/participants/bulk-assign', async (req, res) => {
  try {
    const { participant_ids, room_id } = req.body;

    if (!participant_ids || !Array.isArray(participant_ids) || participant_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Harap pilih minimal 1 peserta untuk ditugaskan.'
      });
    }

    if (!room_id) {
      return res.status(400).json({
        success: false,
        message: 'Harap pilih ruangan sidang tujuan.'
      });
    }

    const result = await participantService.bulkAssignRoom(participant_ids, room_id);

    return res.json({
      success: true,
      message: `Berhasil menugaskan ${result.updatedCount} peserta ke ${result.roomName}!`,
      data: result
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Gagal menugaskan peserta secara massal.'
    });
  }
});

// API: Reset attendance
router.post('/api/participants/:id/reset-attendance', async (req, res) => {
  try {
    const { room_id } = req.body;
    const participant = await participantService.getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
    }

    const targetRoomId = room_id || participant.room_id;
    if (!targetRoomId) {
      return res.status(400).json({ success: false, message: 'Peserta belum dialokasikan ke ruangan.' });
    }

    const verificationService = require('../services/verificationService');
    await verificationService.resetAttendance(participant.id, targetRoomId);

    return res.json({
      success: true,
      message: `Status kehadiran untuk ${participant.name} berhasil di-reset.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
