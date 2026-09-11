require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initializeDatabase } = require('./src/config/database');

// Initialize database schema
initializeDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Session Configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'muspimnas-super-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Template Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global View Variables (e.g. current path, current admin)
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.currentAdmin = req.session.admin || null;
  next();
});

// Mount Routes
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const roomsRoutes = require('./src/routes/rooms');
const printRoutes = require('./src/routes/print');
const verifyRoutes = require('./src/routes/verify');

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(roomsRoutes);
app.use(printRoutes);
app.use(verifyRoutes);

// 404 Handler
app.use((req, res) => {
  res.status(404).render('login', {
    title: 'Halaman Tidak Ditemukan - 404',
    error: 'Halaman yang Anda cari tidak ditemukan.'
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan sistem internal.' });
  }
  res.status(500).send('Terjadi kesalahan pada server. Silakan coba beberapa saat lagi.');
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  SISTEM MANAJEMEN SIDANG & VERIFIKASI QR CODE`);
    console.log(`  Server aktif di: http://localhost:${PORT}`);
    console.log(`  Dashboard:       http://localhost:${PORT}/dashboard`);
    console.log(`  Gate Scanner:    http://localhost:${PORT}/scanner`);
    console.log(`  Admin Default:   admin / admin123`);
    console.log(`====================================================`);
  });
}

module.exports = app;
