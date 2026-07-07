function requireAuth(req, res, next) {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.userId || req.session.userRole !== role) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
