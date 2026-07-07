const { Router } = require("express");
const { asyncHandler } = require("../../middleware/asyncHandler");
const { requireAuth } = require("../../middleware/auth");
const authController = require("./auth.controller");

const router = Router();

router.post("/auth/login", asyncHandler(authController.login));
router.post("/auth/logout", authController.logout);
router.get("/auth/me", requireAuth, asyncHandler(authController.me));

module.exports = router;
