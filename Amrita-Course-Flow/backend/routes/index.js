const { Router } = require("express");
const authRoutes = require("../modules/auth/auth.routes");

const router = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use(authRoutes);

module.exports = router;
