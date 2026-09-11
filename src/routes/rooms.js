const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const roomService = require('../services/roomService');

// GET /rooms - Room management page (Requires Admin Auth)
router.get('/rooms', requireAuth, async (req, res) => {
  try {
    const rooms = await roomService.getAllRooms();
    const roomStats = await Promise.all(rooms.map(r => roomService.getRoomStats(r.id)));

    res.render('rooms', {
      title: 'Manajemen Ruang Sidang & Sesi',
      currentAdmin: req.session.admin,
      rooms: roomStats
    });
  } catch (err) {
    console.error('Rooms page error:', err);
    res.status(500).send('Terjadi kesalahan memuat ruangan: ' + err.message);
  }
});

// Protect Room APIs
router.use('/api/rooms', requireAuth);

// API: Create room
router.post('/api/rooms', async (req, res) => {
  try {
    const { room_name, session_title, capacity, is_active } = req.body;
    if (!room_name || !session_title) {
      return res.status(400).json({
        success: false,
        message: 'Nama Ruangan dan Judul Sesi Sidang wajib diisi.'
      });
    }

    const newRoom = await roomService.createRoom({
      room_name,
      session_title,
      capacity: capacity ? Number(capacity) : 50,
      is_active: is_active !== undefined ? Number(is_active) : 1
    });

    return res.json({
      success: true,
      message: 'Ruangan sidang berhasil ditambahkan!',
      room: newRoom
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// API: Get room by ID
router.get('/api/rooms/:id', async (req, res) => {
  try {
    const room = await roomService.getRoomById(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Ruangan tidak ditemukan.' });
    }
    return res.json({ success: true, room });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// API: Update room
router.put('/api/rooms/:id', async (req, res) => {
  try {
    const { room_name, session_title, capacity, is_active } = req.body;
    if (!room_name || !session_title) {
      return res.status(400).json({
        success: false,
        message: 'Nama Ruangan dan Judul Sesi Sidang wajib diisi.'
      });
    }

    const updated = await roomService.updateRoom(req.params.id, {
      room_name,
      session_title,
      capacity: Number(capacity) || 50,
      is_active: Number(is_active)
    });

    return res.json({
      success: true,
      message: 'Data ruangan berhasil diperbarui!',
      room: updated
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// API: Delete room
router.delete('/api/rooms/:id', async (req, res) => {
  try {
    const success = await roomService.deleteRoom(req.params.id);
    if (!success) {
      return res.status(404).json({ success: false, message: 'Ruangan tidak ditemukan.' });
    }
    return res.json({ success: true, message: 'Ruangan berhasil dihapus.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
