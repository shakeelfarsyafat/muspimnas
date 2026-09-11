require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const { initializeDatabase } = require('./src/config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure database schema and seeding are complete before handling requests
let dbInitPromise = null;
function ensureDbReady() {
  if (!dbInitPromise) {
    dbInitPromise = initializeDatabase().catch(err => {
      console.error('[Server] Critical DB Init Error:', err);
      dbInitPromise = null; // allow retry
      throw err;
    });
  }
  return dbInitPromise;
}

app.use(async (req, res, next) => {
  // Static assets don't require database
  if (req.path.startsWith('/css') || req.path.startsWith('/js') || req.path.startsWith('/images')) {
    return next();
  }
  try {
    await ensureDbReady();
    next();
  } catch (err) {
    res.status(500).send('Database Initialization Error: ' + err.message);
  }
});

// Body Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Trust Proxy (Required for Vercel HTTPS reverse proxy)
app.set('trust proxy', 1);

// Cookie-based Session Configuration (Ensures sessions persist across Vercel serverless lambdas)
const cookieSession = require('cookie-session');
app.use(cookieSession({
  name: 'muspimnas_session',
  keys: [process.env.SESSION_SECRET || 'muspimnas-super-secret-key-2026'],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  sameSite: 'lax',
  httpOnly: true
}));

// Session safety middleware: ensure req.session is always an object
app.use((req, res, next) => {
  if (!req.session) {
    req.session = {};
  }
  next();
});

// Template Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global View Variables (e.g. current path, current admin)
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.currentAdmin = (req.session && req.session.admin) ? req.session.admin : null;
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
  console.error('[Global Server Error]', err);
  if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/api/')) {
    return res.status(500).json({ 
      success: false, 
      message: err.message || 'Terjadi kesalahan sistem internal.' 
    });
  }

  const errorMsg = err?.message || String(err);
  res.status(500).send(`
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kendala Sistem - MUSPIMNAS</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: #151d2f; border: 1px solid #1e293b; border-radius: 16px; max-width: 500px; width: 100%; padding: 32px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); text-align: center; }
        .icon { width: 56px; height: 56px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 20px; }
        h1 { font-size: 20px; font-weight: 700; margin: 0 0 10px 0; color: #f8fafc; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin: 0 0 18px 0; }
        .error-box { background: #0b0f19; border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 12px 14px; font-family: monospace; font-size: 13px; color: #fca5a5; text-align: left; word-break: break-all; margin-bottom: 24px; }
        .btn { display: inline-block; background: #4f46e5; color: #ffffff; text-decoration: none; font-weight: 600; padding: 11px 24px; border-radius: 10px; font-size: 14px; transition: background 0.2s; }
        .btn:hover { background: #4338ca; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">⚠️</div>
        <h1>Terjadi Kendala pada Server</h1>
        <p>Sistem mengalami kendala saat memproses permintaan Anda:</p>
        <div class="error-box">${errorMsg}</div>
        <a href="/login" class="btn">Kembali ke Halaman Login</a>
      </div>
    </body>
    </html>
  `);
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
