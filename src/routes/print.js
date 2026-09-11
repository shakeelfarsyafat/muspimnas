const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const participantService = require('../services/participantService');
const { db } = require('../config/database');

// GET /print (Requires Admin Auth)
router.get('/print', requireAuth, async (req, res) => {
  try {
    let ids = [];
    const { ids: idsParam, id: singleId } = req.query;

    if (singleId) {
      ids = [Number(singleId)];
    } else if (idsParam) {
      if (idsParam === 'all') {
        const all = db.prepare('SELECT id FROM participants ORDER BY id ASC').all();
        ids = all.map(p => p.id);
      } else {
        ids = idsParam
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => !isNaN(n) && n > 0);
      }
    }

    if (ids.length === 0) {
      return res.status(400).send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h2>Tidak Ada ID Card yang Dipilih</h2>
          <p>Silakan centang peserta di dashboard atau klik tombol cetak pada salah satu peserta.</p>
          <a href="/dashboard" style="display:inline-block; padding:8px 16px; background:#4f46e5; color:#fff; text-decoration:none; border-radius:6px;">Kembali ke Dashboard</a>
        </div>
      `);
    }

    const cards = await participantService.getParticipantsForPrint(ids);

    res.render('print-cards', {
      title: `Cetak ID Card Peserta (${cards.length} Kartu)`,
      cards,
      isBulk: cards.length > 1
    });
  } catch (err) {
    console.error('Print generation error:', err);
    res.status(500).send('Terjadi kesalahan saat memproses data cetak ID Card.');
  }
});

module.exports = router;
