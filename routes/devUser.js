import express from "express";
import { createDevUser } from "../controllers/devUserController.js";

const router = express.Router();

// DEV ONLY (disabled by default): create a role profile without OTP
// POST /api/dev/users
router.post("/users", createDevUser);

export default router;
