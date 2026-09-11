const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const roomService = require('../services/roomService');
const verificationService = require('../services/verificationService');

// Store active SSE clients: roomId -> Set of response objects
const sseClients = new Map();

function broadcastScanEvent(roomId, data) {
  const clients = sseClients.get(Number(roomId));
  if (clients && clients.size > 0) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(client => {
      try {
        client.write(payload);
      } catch (err) {
        console.error('Error writing to SSE client:', err);
      }
    });
  }
}

// GET /scanner - Main Monitor Display & Database History Table (Requires Admin Auth)
router.get('/scanner', requireAuth, async (req, res) => {
  try {
    const rooms = await roomService.getAllRooms({ activeOnly: true });
    const selectedRoomId = req.query.room_id || (rooms.length > 0 ? rooms[0].id : null);

    let currentRoomStats = null;
    let recentScans = [];

    if (selectedRoomId) {
      currentRoomStats = await roomService.getRoomStats(selectedRoomId);
      recentScans = await verificationService.getRecentScans(selectedRoomId, 15);
    }

    res.render('scanner', {
      title: 'Monitor Display & Riwayat Sidang (Kiosk Display)',
      currentAdmin: req.session.admin,
      rooms,
      selectedRoomId: Number(selectedRoomId),
      currentRoomStats,
      recentScans
    });
  } catch (err) {
    console.error('Scanner page error:', err);
    res.status(500).send('Terjadi kesalahan memuat scanner: ' + err.message);
  }
});

// GET /scanner/camera - Dedicated Camera Scanner (For Guard Phone / Mobile Device)
router.get('/scanner/camera', async (req, res) => {
  try {
    const rooms = await roomService.getAllRooms({ activeOnly: true });
    const selectedRoomId = req.query.room_id || (rooms.length > 0 ? rooms[0].id : null);

    let currentRoomStats = null;
    if (selectedRoomId) {
      currentRoomStats = await roomService.getRoomStats(selectedRoomId);
    }

    res.render('scanner-camera', {
      title: 'Kamera Pemindai Pintu Sidang (HP / Mobile Gate)',
      currentAdmin: req.session.admin,
      rooms,
      selectedRoomId: Number(selectedRoomId),
      currentRoomStats
    });
  } catch (err) {
    console.error('Scanner camera error:', err);
    res.status(500).send('Terjadi kesalahan memuat kamera: ' + err.message);
  }
});

// POST /api/verify/scan - Core scan verification API
router.post('/api/verify/scan', async (req, res) => {
  try {
    const { qr_token, room_id, mode = 'in' } = req.body;

    if (!qr_token) {
      return res.status(400).json({
        success: false,
        status: 'EMPTY_TOKEN',
        message: 'Token QR Code tidak boleh kosong.'
      });
    }

    if (!room_id) {
      return res.status(400).json({
        success: false,
        status: 'NO_ROOM_SELECTED',
        message: 'Silakan pilih ruangan sidang yang sedang dijaga terlebih dahulu.'
      });
    }

    const result = await verificationService.verifyScan(qr_token, room_id, mode);
    const roomStats = await roomService.getRoomStats(room_id);

    const responseData = {
      ...result,
      roomStats
    };

    // Broadcast realtime event to all connected Monitor/Display screens for this room!
    broadcastScanEvent(room_id, responseData);

    return res.json(responseData);
  } catch (err) {
    console.error('Scan error:', err);
    return res.status(500).json({
      success: false,
      status: 'SERVER_ERROR',
      message: 'Terjadi kesalahan sistem saat memvalidasi QR Code.'
    });
  }
});

// GET /api/verify/live-events/:roomId - SSE Stream for Live Display Screen
router.get('/api/verify/live-events/:roomId', (req, res) => {
  const roomId = Number(req.params.roomId);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');

  if (!sseClients.has(roomId)) {
    sseClients.set(roomId, new Set());
  }
  sseClients.get(roomId).add(res);

  // Send initial ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', roomId })}\n\n`);

  req.on('close', () => {
    const clients = sseClients.get(roomId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(roomId);
      }
    }
  });
});

// GET /api/verify/recent/:roomId - Get recent scans for live feed
router.get('/api/verify/recent/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const recent = await verificationService.getRecentScans(roomId, 15);
    const stats = await roomService.getRoomStats(roomId);

    return res.json({
      success: true,
      recent,
      stats
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
