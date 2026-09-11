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
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim());
    if (!admin) {
      req.session.loginError = 'Username atau password salah!';
      return res.redirect('/login');
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
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
