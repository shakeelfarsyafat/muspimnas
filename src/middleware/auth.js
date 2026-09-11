/**
 * Authentication Middleware for Closed Admin System
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.admin) {
    res.locals.currentAdmin = req.session.admin;
    return next();
  }
  
  // If API request, return JSON 401
  if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/api/')) {
    return res.status(401).json({
      success: false,
      message: 'Sesi telah berakhir atau Anda belum login sebagai Admin.'
    });
  }

  req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

function redirectIfAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = {
  requireAuth,
  redirectIfAuth
};
