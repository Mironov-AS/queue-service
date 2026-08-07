function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

module.exports = { requireAdmin };