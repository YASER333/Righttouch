import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import OwnerProfile from "../Schemas/OwnerProfile.js";
import AdminProfile from "../Schemas/AdminProfile.js";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import CustomerProfile from "../Schemas/CustomerProfile.js";

const roleModelMap = {
  Owner: OwnerProfile,
  Admin: AdminProfile,
  Technician: TechnicianProfile,
  Customer: CustomerProfile,
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;

const normalizeRole = (role) => {
  if (!role) return null;
  const normalized = role.toString().trim().toLowerCase();
  const match = Object.keys(roleModelMap).find(
    (r) => r.toLowerCase() === normalized
  );
  return match || null;
};

const findAnyProfileByEmail = async (email) => {
  const models = Object.values(roleModelMap);
  for (const Model of models) {
    const exists = await Model.findOne({ email }).select("_id");
    if (exists) return true;
  }
  return false;
};

const isDevRouteEnabled = () =>
  (process.env.ENABLE_DEV_USER_CREATION || "").toLowerCase() === "true";

const verifyDevSecret = (req) => {
  const expected = process.env.DEV_ROUTE_SECRET;
  if (!expected) return false;
  const provided = req.headers["x-dev-secret"];
  return typeof provided === "string" && provided === expected;
};

const isBcryptHash = (value) =>
  typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);

const parseUserId = (maybeId) => {
  if (maybeId === undefined || maybeId === null || maybeId === "") return null;
  if (!mongoose.Types.ObjectId.isValid(maybeId)) {
    const err = new Error("Invalid userId");
    err.statusCode = 400;
    throw err;
  }
  return new mongoose.Types.ObjectId(maybeId);
};

// DEV ONLY: Create a role profile directly (bypasses OTP). Disabled by default.
export const createDevUser = async (req, res) => {
  try {
    if (!isDevRouteEnabled()) {
      return res.status(404).json({
        success: false,
        message: "Not found",
        result: {},
      });
    }

    if (!verifyDevSecret(req)) {
      return res.status(401).json({
        success: false,
        message: "Invalid dev secret",
        result: {},
      });
    }

    const body = req.body || {};
    const identifier = body.email?.toLowerCase().trim();
    const normalizedRole = normalizeRole(body.role);

    if (!identifier || !normalizedRole) {
      return res.status(400).json({
        success: false,
        message: "Email and role required",
        result: {},
      });
    }

    if (!emailRegex.test(identifier)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
        result: {},
      });
    }

    const ProfileModel = roleModelMap[normalizedRole];
    if (!ProfileModel) {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
        result: {},
      });
    }

    const password = body.password;
    const confirmPassword = body.confirmPassword;
    let passwordToStore = null;

    // Allow either:
    // - bcrypt-hashed password (store as-is)
    // - plain password + confirmPassword (hash it)
    if (!password) {
      return res.status(400).json({
        success: false,
        message: "password is required",
        result: {},
      });
    }

    if (isBcryptHash(password)) {
      passwordToStore = password;
    } else {
      if (!confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "confirmPassword is required when password is not hashed",
          result: {},
        });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: "Passwords do not match",
          result: {},
        });
      }
      if (!passwordRegex.test(password)) {
        return res.status(400).json({
          success: false,
          message: "Weak password",
          result: {},
        });
      }
      passwordToStore = await bcrypt.hash(password, 10);
    }

    const emailExists = await findAnyProfileByEmail(identifier);
    if (emailExists) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
        result: {},
      });
    }

    const userId = parseUserId(body.userId) || new mongoose.Types.ObjectId();

    // Backwards compatible: allow either flat body fields OR body.profile object.
    const profileFields =
      body.profile && typeof body.profile === "object" ? body.profile : {};

    // Merge: profileFields override flat fields if both provided
    const merged = { ...body, ...profileFields };

    // Remove non-schema helper keys
    delete merged.role;
    delete merged.confirmPassword;
    delete merged.profile;

    // Force core identity fields and normalized email
    merged.userId = userId;
    merged.email = identifier;
    merged.password = passwordToStore;

    if (merged.status === undefined) merged.status = "Active";
    if (merged.profileComplete !== undefined) {
      merged.profileComplete = Boolean(merged.profileComplete);
    }

    const createdProfile = await ProfileModel.create(merged);

    const token = jwt.sign(
      {
        userId: createdProfile.userId,
        profileId: createdProfile._id,
        role: normalizedRole,
        email: createdProfile.email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success: true,
      message: "Dev user created (OTP bypass)",
      result: {
        token,
        role: normalizedRole,
        userId: createdProfile.userId,
        profileId: createdProfile._id,
        profileComplete: createdProfile.profileComplete,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      result: { error: error.message },
    });
  }
};
