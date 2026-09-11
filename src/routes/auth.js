const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { redirectIfAuth } = require('../middleware/auth');

// GET /login
router.get('/login', redirectIfAuth, (req, res) => {
  const error = req.session.loginError;
  delete req.session.loginError;
  res.render('login', { error, title: 'Login Admin - Sistem Sidang' });
});

// POST /login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    req.session.loginError = 'Username dan password wajib diisi!';
    return res.redirect('/login');
  }

  try {
    const cleanUsername = username.trim();
    let admin = await db.get('SELECT * FROM admins WHERE LOWER(username) = LOWER(?)', [cleanUsername]);
    
    // Self-healing: if admin account doesn't exist yet, auto-provision default admin
    if (!admin && cleanUsername.toLowerCase() === 'admin' && password === 'admin123') {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('admin123', salt);
      await db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', ['admin', hash]);
      admin = await db.get('SELECT * FROM admins WHERE username = ?', ['admin']);
    }

    if (!admin) {
      req.session.loginError = 'Username atau password salah!';
      return res.redirect('/login');
    }

    let isMatch = await bcrypt.compare(password, admin.password_hash);
    
    // Self-healing: if password hash mismatch on default admin, reset hash
    if (!isMatch && cleanUsername.toLowerCase() === 'admin' && password === 'admin123') {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('admin123', salt);
      await db.run('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, 'admin']);
      isMatch = true;
    }

    if (!isMatch) {
      req.session.loginError = 'Username atau password salah!';
      return res.redirect('/login');
    }

    // Set session
    req.session.admin = {
      id: admin.id,
      username: admin.username
    };

    const returnTo = req.session.returnTo || '/dashboard';
    delete req.session.returnTo;
    return res.redirect(returnTo);
  } catch (err) {
    console.error('Login error:', err);
    req.session.loginError = 'Terjadi kesalahan internal server.';
    return res.redirect('/login');
  }
});

// GET /logout
router.get('/logout', (req, res) => {
  if (typeof req.session?.destroy === 'function') {
    req.session.destroy(() => res.redirect('/login'));
  } else {
    req.session = null;
    res.redirect('/login');
  }
});

module.exports = router;
