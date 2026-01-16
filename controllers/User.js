import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Otp from "../Schemas/Otp.js";
import TempUser from "../Schemas/TempUser.js";

import OwnerProfile from "../Schemas/OwnerProfile.js";
import AdminProfile from "../Schemas/AdminProfile.js";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import CustomerProfile from "../Schemas/CustomerProfile.js";

import sendSms from "../utils/sendSMS.js";

/* ======================================================
   RESPONSE HELPERS (Consistent API shape)
====================================================== */

const ok = (res, status, message, result = {}) =>
  res.status(status).json({
    success: true,
    message,
    result,
  });

const fail = (res, status, message, code, details) =>
  res.status(status).json({
    success: false,
    message,
    result: {},
    ...(code ? { error: { code, ...(details !== undefined ? { details } : {}) } } : {}),
  });

/* ======================================================
   CONSTANTS & HELPERS
====================================================== */

const roleModelMap = {
  Owner: OwnerProfile,
  Admin: AdminProfile,
  Technician: TechnicianProfile,
  Customer: CustomerProfile,
};

const generateOtp = () =>
  Math.floor(1000 + Math.random() * 9999).toString();

const toFiniteNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const passwordRegex =
  /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;

const normalizeRole = (role) => {
  if (!role) return null;
  const normalized = role.toString().trim().toLowerCase();
  const match = Object.keys(roleModelMap).find(
    (r) => r.toLowerCase() === normalized
  );
  return match || null;
};

const findAnyProfileByMobileNumber = async (mobileNumber) => {
  const models = Object.values(roleModelMap);
  for (const Model of models) {
    const exists = await Model.findOne({ mobileNumber }).select("_id");
    if (exists) return true;
  }
  return false;
};

/* ======================================================
   1️⃣ SIGNUP + SEND OTP (SMS ONLY)
====================================================== */
export const signupAndSendOtp = async (req, res) => {
  try {
    let { mobileNumber, role } = req.body;

    role = normalizeRole(role);
    mobileNumber = mobileNumber?.trim();

    if (!mobileNumber || !role) {
      return fail(res, 400, "Mobile number and role required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role"],
      });
    }

    // Step 1: Create / update temp user (FIRST)
    const tempUser = await TempUser.findOneAndUpdate(
      { identifier: mobileNumber, role },
      { identifier: mobileNumber, role, tempstatus: "Pending" },
      { upsert: true, new: true }
    );

    if (!tempUser) {
      return fail(res, 500, "Failed to create signup record", "TEMPUSER_CREATE_FAILED");
    }

    // Step 2: Remove old OTPs
    await Otp.deleteMany({
      identifier: mobileNumber,
      role,
      purpose: "SIGNUP",
    });

    // Step 3: Generate and hash OTP
    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Step 4: Store OTP
    await Otp.create({
      identifier: mobileNumber,
      role,
      purpose: "SIGNUP",
      otp: hashedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
    });

    // Step 5: SEND OTP VIA SMS (AFTER storing in database)
    try {
      await sendSms(mobileNumber, otp);
    } catch (smsErr) {
      console.error("SMS sending failed:", smsErr.message);
      // OTP is stored, SMS will retry or user can request resend
      return fail(res, 500, "Failed to send OTP. Please try again.", "SMS_SEND_FAILED");
    }

    return ok(res, 200, "OTP sent successfully", {
      mobileNumber,
      role,
      purpose: "SIGNUP",
      expiresInSeconds: 300,
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};


/* ======================================================
   2️⃣ RESEND OTP (COMMON)
====================================================== */
export const resendOtp = async (req, res) => {
  try {
    const { mobileNumber, role } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);

    if (!identifier || !normalizedRole) {
      return fail(res, 400, "Mobile number and role required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role"],
      });
    }

    const tempUser = await TempUser.findOne({
      identifier,
      role: normalizedRole,
    });

    if (!tempUser) {
      return fail(res, 404, "Signup not found", "SIGNUP_NOT_FOUND");
    }

    const lastOtp = await Otp.findOne({
      identifier,
      role: normalizedRole,
      purpose: "SIGNUP",
    }).sort({ createdAt: -1 });

    // ⏳ 60 sec cooldown
    if (lastOtp && Date.now() - lastOtp.createdAt < 60 * 1000) {
      return fail(res, 429, "Please wait before retrying", "OTP_COOLDOWN");
    }

    // Remove old OTPs
    await Otp.deleteMany({
      identifier,
      role: normalizedRole,
      purpose: "SIGNUP",
    });

    // Generate and hash OTP
    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Store new OTP
    await Otp.create({
      identifier,
      role: normalizedRole,
      purpose: "SIGNUP",
      otp: hashedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Send SMS (AFTER storing in database)
    try {
      await sendSms(identifier, otp);
    } catch (smsErr) {
      console.error("SMS sending failed:", smsErr.message);
      return fail(res, 500, "Failed to send OTP. Please try again.", "SMS_SEND_FAILED");
    }

    return ok(res, 200, "OTP resent successfully", {
      mobileNumber: identifier,
      role: normalizedRole,
      purpose: "SIGNUP",
      expiresInSeconds: 300,
      cooldownSeconds: 60,
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};


/* ======================================================
   3️⃣ VERIFY OTP
====================================================== */
export const verifyOtp = async (req, res) => {
  try {
    const { mobileNumber, role, otp } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);

    if (!identifier || !normalizedRole || !otp) {
      return fail(res, 400, "Mobile number, role and otp required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role", "otp"],
      });
    }

    const record = await Otp.findOne({
      identifier,
      role: normalizedRole,
      purpose: "SIGNUP",
      expiresAt: { $gt: Date.now() },
    }).sort({ createdAt: -1 });

    if (!record) {
      return fail(res, 400, "OTP expired or invalid", "OTP_INVALID_OR_EXPIRED");
    }

    if (record.attempts >= 5) {
      return fail(res, 429, "Too many attempts. Request new OTP.", "OTP_TOO_MANY_ATTEMPTS");
    }

    const isMatch = await bcrypt.compare(otp, record.otp);
    if (!isMatch) {
      record.attempts++;
      await record.save();
      return fail(res, 400, "Invalid OTP", "OTP_INVALID", {
        attemptsRemaining: Math.max(0, 5 - record.attempts),
      });
    }

    // Mark OTP as verified
    record.isVerified = true;
    await record.save();

    // Update TempUser status
    const tempUserUpdate = await TempUser.updateOne(
      { identifier, role: normalizedRole },
      { tempstatus: "Verified" }
    );

    if (tempUserUpdate.modifiedCount === 0) {
      return fail(res, 500, "Failed to verify user status", "TEMPUSER_STATUS_UPDATE_FAILED");
    }

    return ok(res, 200, "OTP verified successfully", {
      mobileNumber: identifier,
      role: normalizedRole,
      nextStep: "set-password",
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};

/* ======================================================
   4️⃣ SET PASSWORD + CREATE PROFILE
====================================================== */
export const setPassword = async (req, res) => {
  try {
    const { mobileNumber, role, password, confirmPassword } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);

    if (!identifier || !normalizedRole) {
      return fail(res, 400, "Mobile number and role required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role"],
      });
    }

    if (!roleModelMap[normalizedRole]) {
      return fail(res, 400, "Invalid role", "INVALID_ROLE");
    }

    if (!password || !confirmPassword) {
      return fail(res, 400, "Password and confirm password required", "VALIDATION_ERROR", {
        required: ["password", "confirmPassword"],
      });
    }

    if (password !== confirmPassword) {
      return fail(res, 400, "Passwords do not match", "PASSWORD_MISMATCH");
    }

    if (!passwordRegex.test(password)) {
      return fail(
        res,
        400,
        "Password must be at least 8 characters with letters, numbers, and special characters",
        "WEAK_PASSWORD"
      );
    }

    // Check if OTP is verified
    const tempUser = await TempUser.findOne({
      identifier,
      role: normalizedRole,
      tempstatus: "Verified",
    });

    if (!tempUser) {
      return fail(
        res,
        403,
        "OTP not verified. Please complete OTP verification first.",
        "OTP_NOT_VERIFIED"
      );
    }

    // Check if user already exists
    const mobileExists = await findAnyProfileByMobileNumber(identifier);
    if (mobileExists) {
      return fail(res, 409, "User with this mobile number already exists", "MOBILE_ALREADY_EXISTS");
    }

    // Create profile
    const hashedPassword = await bcrypt.hash(password, 10);
    const Profile = roleModelMap[normalizedRole];
    const userId = new mongoose.Types.ObjectId();

    // Different roles use different status field names
    const profileData = {
      userId,
      mobileNumber: identifier,
      password: hashedPassword,
      profileComplete: false,
    };

    // Technician uses 'workStatus', others use 'status'
    if (normalizedRole === "Technician") {
      profileData.workStatus = "pending";
      // Prevent geo index error: don't create location object without coordinates
      profileData.location = undefined;
    } else {
      profileData.status = "Active";
    }

    const profile = await Profile.create(profileData);

    if (!profile) {
      return fail(res, 500, "Failed to create user account", "PROFILE_CREATE_FAILED");
    }

    // Cleanup temp data
    await TempUser.deleteOne({ _id: tempUser._id });
    await Otp.deleteMany({ identifier, role: normalizedRole });

    // Generate token
    const token = jwt.sign(
      {
        userId: profile.userId,
        profileId: profile._id,
        role: normalizedRole,
        mobileNumber: profile.mobileNumber,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Keep backward compatibility: top-level token exists, AND result.token exists
    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      token,
      role: normalizedRole,
      profileComplete: profile.profileComplete,
      result: {
        token,
        role: normalizedRole,
        profileId: profile._id,
        userId: profile.userId,
        mobileNumber: profile.mobileNumber,
        profileComplete: profile.profileComplete,
      },
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};

/* ======================================================
   5️⃣ LOGIN
====================================================== */
export const login = async (req, res) => {
  try {
    const { mobileNumber, password, role } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);
    const Profile = normalizedRole ? roleModelMap[normalizedRole] : null;

    if (!Profile) return fail(res, 400, "Invalid role", "INVALID_ROLE");

    if (!identifier || !password) {
      return fail(res, 400, "Mobile number and password required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "password"],
      });
    }

    const user = await Profile.findOne({ mobileNumber: identifier }).select("+password");
    if (!user) return fail(res, 404, "Invalid credentials", "INVALID_CREDENTIALS");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return fail(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");

    const token = jwt.sign(
      {
        userId: user.userId || user._id,
        profileId: user._id,
        role: normalizedRole,
        mobileNumber: user.mobileNumber,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Keep backward compatibility: top-level token exists, AND result.token exists
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      role: normalizedRole,
      profileComplete: user.profileComplete,
      result: {
        token,
        role: normalizedRole,
        profileId: user._id,
        userId: user.userId || user._id,
        mobileNumber: user.mobileNumber,
        profileComplete: user.profileComplete,
      },
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};

/* ======================================================
   6️⃣ PASSWORD RESET FLOW
====================================================== */
export const requestPasswordResetOtp = async (req, res) => {
  try {
    const { mobileNumber, role } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);

    if (!identifier || !normalizedRole) {
      return fail(res, 400, "Mobile number and role required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role"],
      });
    }

    const Profile = roleModelMap[normalizedRole];
    if (!Profile) {
      return fail(res, 400, "Invalid role", "INVALID_ROLE");
    }

    const user = await Profile.findOne({ mobileNumber: identifier });
    if (!user) {
      return fail(res, 404, "User not found", "USER_NOT_FOUND");
    }

    // Remove old OTPs
    await Otp.deleteMany({ identifier, role: normalizedRole, purpose: "RESET_PASSWORD" });

    // Generate and hash OTP
    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);

    // Store OTP
    await Otp.create({
      identifier,
      role: normalizedRole,
      purpose: "RESET_PASSWORD",
      otp: hashedOtp,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Send SMS (AFTER storing in database)
    try {
      await sendSms(identifier, otp);
    } catch (smsErr) {
      console.error("SMS sending failed:", smsErr.message);
      return fail(res, 500, "Failed to send OTP. Please try again.", "SMS_SEND_FAILED");
    }

    return ok(res, 200, "OTP sent successfully", {
      mobileNumber: identifier,
      role: normalizedRole,
      purpose: "RESET_PASSWORD",
      expiresInSeconds: 300,
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};

export const verifyPasswordResetOtp = async (req, res) => {
  try {
    const { mobileNumber, role, otp } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);

    if (!identifier || !normalizedRole || !otp) {
      return fail(res, 400, "Mobile number, role and otp required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role", "otp"],
      });
    }

    const record = await Otp.findOne({
      identifier,
      role: normalizedRole,
      purpose: "RESET_PASSWORD",
      expiresAt: { $gt: Date.now() },
    }).sort({ createdAt: -1 });

    if (!record) return fail(res, 400, "OTP expired or invalid", "OTP_INVALID_OR_EXPIRED");

    const isMatch = await bcrypt.compare(otp, record.otp);
    if (!isMatch) return fail(res, 400, "Invalid OTP", "OTP_INVALID");

    record.isVerified = true;
    await record.save();

    return ok(res, 200, "OTP verified", {
      mobileNumber: identifier,
      role: normalizedRole,
      nextStep: "reset-password",
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { mobileNumber, role, newPassword } = req.body;
    const identifier = mobileNumber?.trim();
    const normalizedRole = normalizeRole(role);

    if (!identifier || !normalizedRole || !newPassword) {
      return fail(res, 400, "Mobile number, role and newPassword required", "VALIDATION_ERROR", {
        required: ["mobileNumber", "role", "newPassword"],
      });
    }

    if (!passwordRegex.test(newPassword)) {
      return fail(
        res,
        400,
        "Password must be at least 8 characters with letters, numbers, and special characters",
        "WEAK_PASSWORD"
      );
    }

    const Profile = roleModelMap[normalizedRole];
    if (!Profile) {
      return fail(res, 400, "Invalid role", "INVALID_ROLE");
    }

    // Check if OTP is verified
    const record = await Otp.findOne({
      identifier,
      role: normalizedRole,
      purpose: "RESET_PASSWORD",
      isVerified: true,
    });

    if (!record) {
      return fail(
        res,
        403,
        "OTP not verified. Please complete OTP verification first.",
        "OTP_NOT_VERIFIED"
      );
    }

    // Update password
    const hashed = await bcrypt.hash(newPassword, 10);
    const updatedUser = await Profile.findOneAndUpdate(
      { mobileNumber: identifier },
      { password: hashed },
      { new: true }
    );

    if (!updatedUser) {
      return fail(res, 404, "User not found", "USER_NOT_FOUND");
    }

    // Cleanup OTP records
    await Otp.deleteMany({ identifier, role: normalizedRole, purpose: "RESET_PASSWORD" });

    return ok(res, 200, "Password reset successful", {
      mobileNumber: identifier,
      role: normalizedRole,
    });
  } catch (err) {
    return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
  }
};

/* ======================================================
   7️⃣ PROFILE APIs
====================================================== */
export const getMyProfile = async (req, res) => {
  const { profileId, role } = req.user;
  const Profile = roleModelMap[role];

  if (!Profile || !profileId) {
    return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
  }

  const profile = await Profile.findById(profileId).select("-password");
  return ok(res, 200, "Profile fetched successfully", profile || {});
};

export const completeProfile = async (req, res) => {
  const { profileId, role } = req.user;
  const Profile = roleModelMap[role];

  if (!Profile || !profileId) {
    return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
  }

  let allowedFields = [];

  if (role === "Customer") {
    allowedFields = ["firstName", "lastName", "gender", "mobileNumber"];
  }

  if (role === "Technician") {
    allowedFields = [
      "firstName",
      "lastName",
      "gender",
      "mobileNumber",
      "address",
      "city",
      "state",
      "pincode",
      "latitude",
      "longitude",
      "locality",
      "experienceYears",
      "specialization",
    ];
  }

  if (role === "Owner") {
    allowedFields = [
      "firstName",
      "lastName",
      "gender",
      "mobileNumber",
      "companyName",
      "businessType",
      "address",
      "city",
      "state",
      "pincode",
      "gstNumber",
    ];
  }

  if (role === "Admin") {
    allowedFields = [
      "firstName",
      "lastName",
      "gender",
      "mobileNumber",
      "designation",
      "department",
      "address",
      "city",
      "state",
    ];
  }

  const updateData = {};
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  });

  // Technician geo location (optional) -> stored as GeoJSON Point
  if (role === "Technician" && (updateData.latitude !== undefined || updateData.longitude !== undefined)) {
    const lat = toFiniteNumber(updateData.latitude);
    const lng = toFiniteNumber(updateData.longitude);

    delete updateData.latitude;
    delete updateData.longitude;

    if (lat === null || lng === null) {
      return fail(res, 400, "latitude and longitude must be valid numbers", "VALIDATION_ERROR", {
        required: ["latitude", "longitude"],
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return fail(res, 400, "Invalid latitude/longitude range", "VALIDATION_ERROR", {
        latitude: lat,
        longitude: lng,
      });
    }

    updateData.location = { type: "Point", coordinates: [lng, lat] };
  }

  updateData.profileComplete = true;

  const updated = await Profile.findByIdAndUpdate(
    profileId,
    updateData,
    { new: true, runValidators: true }
  ).select("-password");

  return ok(res, 200, "Profile completed successfully", updated || {});
};


export const updateMyProfile = async (req, res) => {
  const { profileId, role } = req.user;
  const Profile = roleModelMap[role];

  if (!Profile || !profileId) {
    return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
  }

  // Customers must manage addresses via Address APIs only
  if (role === "Customer") {
    const addressKeys = ["address", "city", "state", "pincode"];
    const hasAddressFields = addressKeys.some((k) => req.body?.[k] !== undefined);
    if (hasAddressFields) {
      return fail(
        res,
        400,
        "Customer address must be managed via address endpoints (/api/addresses) only",
        "ADDRESS_UPDATE_NOT_ALLOWED"
      );
    }
  }

  // Prevent sensitive updates
  const forbidden = new Set(["password", "email", "status", "userId", "profileComplete"]);
  const updateData = {};
  Object.keys(req.body || {}).forEach((k) => {
    if (!forbidden.has(k)) updateData[k] = req.body[k];
  });

  // Technician geo location (optional) -> stored as GeoJSON Point
  if (role === "Technician" && (updateData.latitude !== undefined || updateData.longitude !== undefined)) {
    const lat = toFiniteNumber(updateData.latitude);
    const lng = toFiniteNumber(updateData.longitude);

    delete updateData.latitude;
    delete updateData.longitude;

    if (lat === null || lng === null) {
      return fail(res, 400, "latitude and longitude must be valid numbers", "VALIDATION_ERROR", {
        required: ["latitude", "longitude"],
      });
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return fail(res, 400, "Invalid latitude/longitude range", "VALIDATION_ERROR", {
        latitude: lat,
        longitude: lng,
      });
    }

    updateData.location = { type: "Point", coordinates: [lng, lat] };
  }

  const updated = await Profile.findByIdAndUpdate(profileId, updateData, {
    new: true,
    runValidators: true,
  }).select("-password");

  return ok(res, 200, "Profile updated successfully", updated || {});
};

export const getUserById = async (req, res) => {
  const { role, id } = req.params;
  const Profile = roleModelMap[role];

  const user = await Profile.findById(id).select("-password");
  return ok(res, 200, "User fetched successfully", user || {});
};

export const getAllUsers = async (req, res) => {
  const { role } = req.params;
  const Profile = roleModelMap[role];

  const users = await Profile.find().select("-password");
  return ok(res, 200, "Users fetched successfully", users || []);
};
