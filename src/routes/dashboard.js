const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const participantService = require('../services/participantService');
const roomService = require('../services/roomService');

// GET / or /dashboard (Requires Admin Auth)
router.get(['/', '/dashboard'], requireAuth, (req, res) => {
  const { search = '', room = '', status = '', page = 1 } = req.query;

  const data = participantService.getAllParticipants({
    search,
    roomId: room,
    attendanceStatus: status,
    page: parseInt(page, 10) || 1,
    limit: 25
  });

  const rooms = roomService.getAllRooms({ activeOnly: true });
  const systemOverview = roomService.getSystemOverview();

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
});

// Protect participant APIs
router.use('/api/participants', requireAuth);

// API: Add new participant
router.post('/api/participants', (req, res) => {
  try {
    const { name, identifier_num, institution, room_id } = req.body;
    if (!name || !identifier_num) {
      return res.status(400).json({
        success: false,
        message: 'Nama Lengkap dan Nomor Identitas (NIM/NIK) wajib diisi.'
      });
    }

    const participant = participantService.createParticipant({
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

// API: Get single participant
router.get('/api/participants/:id', (req, res) => {
  const participant = participantService.getParticipantById(req.params.id);
  if (!participant) {
    return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
  }
  return res.json({ success: true, participant });
});

// API: Update participant
router.put('/api/participants/:id', (req, res) => {
  try {
    const { name, identifier_num, institution, room_id } = req.body;
    if (!name || !identifier_num) {
      return res.status(400).json({
        success: false,
        message: 'Nama Lengkap dan Nomor Identitas wajib diisi.'
      });
    }

    const updated = participantService.updateParticipant(req.params.id, {
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
router.delete('/api/participants/:id', (req, res) => {
  try {
    const success = participantService.deleteParticipant(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Peserta berhasil dihapus.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// API: Bulk Assign Participants to a Room
router.post('/api/participants/bulk-assign', (req, res) => {
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

    const result = participantService.bulkAssignRoom(participant_ids, room_id);

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
router.post('/api/participants/:id/reset-attendance', (req, res) => {
  try {
    const { room_id } = req.body;
    const participant = participantService.getParticipantById(req.params.id);
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Peserta tidak ditemukan.' });
    }

    const targetRoomId = room_id || participant.room_id;
    if (!targetRoomId) {
      return res.status(400).json({ success: false, message: 'Peserta belum dialokasikan ke ruangan.' });
    }

    const verificationService = require('../services/verificationService');
    verificationService.resetAttendance(participant.id, targetRoomId);

    return res.json({
      success: true,
      message: `Status kehadiran untuk ${participant.name} berhasil di-reset.`
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
