    // Get all users by role
    export const getAllUsers = async (req, res) => {
      try {
        const { role } = req.params;
        if (!role) {
          return res.status(400).json({ success: false, message: "Role is required", result: {} });
        }
        const users = await User.find({ role });
        return res.status(200).json({ success: true, message: "Users fetched", result: users });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message, result: {} });
      }
    };

    // Get user by id and role
    export const getUserById = async (req, res) => {
      try {
        const { role, id } = req.params;
        if (!role || !id) {
          return res.status(400).json({ success: false, message: "Role and id are required", result: {} });
        }
        const user = await User.findOne({ _id: id, role });
        if (!user) {
          return res.status(404).json({ success: false, message: "User not found", result: {} });
        }
        return res.status(200).json({ success: true, message: "User fetched", result: user });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message, result: {} });
      }
    };
    // Owner-only login
    export const ownerLogin = async (req, res) => {
      try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
          return fail(res, 400, "Mobile & password required", "VALIDATION_ERROR");
        }
        // Only allow Owner role
        const user = await User.findOne({ mobileNumber: identifier, role: "Owner" }).select("+password role");
        if (!user) return fail(res, 404, "Invalid credentials", "INVALID_CREDENTIALS");
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return fail(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");
        await User.updateOne(
          { _id: user._id },
          { $set: { lastLoginAt: new Date() } }
        );
        const token = jwt.sign(
          {
            userId: user._id,
            role: user.role,
          },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );
        return ok(res, 200, "Login successful", {
          token,
          userId: user._id,
          role: user.role,
        });
      } catch (err) {
        return fail(res, 500, err.message, "SERVER_ERROR");
      }
    };
    // Technician-only login
    export const technicianLogin = async (req, res) => {
      try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
          return fail(res, 400, "Mobile & password required", "VALIDATION_ERROR");
        }
        // Only allow Technician role
        const user = await User.findOne({ mobileNumber: identifier, role: "Technician" }).select("+password role");
        if (!user) return fail(res, 404, "Invalid credentials", "INVALID_CREDENTIALS");
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return fail(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");
        await User.updateOne(
          { _id: user._id },
          { $set: { lastLoginAt: new Date() } }
        );
        const tech = await TechnicianProfile.findOne({ userId: user._id }).select("_id");
        const technicianProfileId = tech?._id || null;
        const token = jwt.sign(
          {
            userId: user._id,
            role: user.role,
            technicianProfileId,
          },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );
        return ok(res, 200, "Login successful", {
          token,
          userId: user._id,
          role: user.role,
          technicianProfileId,
          identifier: user.mobileNumber,
        });
      } catch (err) {
        return fail(res, 500, err.message, "SERVER_ERROR");
      }
    };
    import bcrypt from "bcryptjs";
    import jwt from "jsonwebtoken";
    import mongoose from "mongoose";

    import Otp from "../Schemas/Otp.js";
    import TempUser from "../Schemas/TempUser.js";

    import User from "../Schemas/User.js";
    import TechnicianProfile from "../Schemas/TechnicianProfile.js";
    import TechnicianKyc from "../Schemas/TechnicianKYC.js";
    import crypto from "crypto";

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

    // roleModelMap removed. Only TechnicianProfile is used for technician extra data.

    const generateOtp = () =>
      Math.floor(1000 + Math.random() * 9000).toString();

    const toFiniteNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const passwordRegex =
      /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;

    const normalizeRole = (role) => {
      if (!role) return null;
      const normalized = role.toString().trim().toLowerCase();
      if (["owner", "admin", "customer", "technician"].includes(normalized)) {
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
      }
      return null;
    };

    const findAnyProfileByMobileNumber = async (mobileNumber) => {
      const exists = await User.findOne({ mobileNumber }).select("_id");
      return !!exists;
    };

    // applyRolePopulates removed. Only used for TechnicianProfile in profile APIs if needed.

    // Helper to build GeoJSON Point
    const buildLocation = (lat, lng) => {
      if (
        typeof lat === "number" && typeof lng === "number" &&
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      ) {
        return { type: "Point", coordinates: [lng, lat] };
      }
      return null;
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

        // Prevent re-registering an existing mobile number (across any role)
        const mobileExists = await findAnyProfileByMobileNumber(mobileNumber);
        if (mobileExists) {
          return fail(
            res,
            409,
            "Mobile number already registered. Please login.",
            "MOBILE_ALREADY_EXISTS",
            { mobileNumber }
          );
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

        // If user already exists, do not allow resend for signup flow
        const mobileExists = await findAnyProfileByMobileNumber(identifier);
        if (mobileExists) {
          return fail(
            res,
            409,
            "Mobile number already registered. Please login.",
            "MOBILE_ALREADY_EXISTS",
            { mobileNumber: identifier }
          );
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

        // ATOMIC OTP verification
          const record = await Otp.findOneAndUpdate(
            {
              identifier,
              role: normalizedRole,
              verified: false,
              otp: { $exists: true },
              createdAt: { $gte: Date.now() - 10 * 60 * 1000 }
            },
            { $set: { verified: true } },
            { new: true }
          );

        if (!record) {
          return fail(res, 400, "OTP expired, invalid, or already used", "OTP_INVALID_OR_EXPIRED");
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
        const { password, confirmPassword, mobileNumber, role } = req.body;

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

        // Find verified TempUser for this identifier and role
        const identifier = mobileNumber?.trim();
        const normalizedRole = normalizeRole(role);
        const tempUser = await TempUser.findOne({ identifier, role: normalizedRole, tempstatus: "Verified" });
        if (!tempUser) {
          return fail(
            res,
            403,
            "OTP not verified. Please complete OTP verification first.",
            "OTP_NOT_VERIFIED"
          );
        }

        // Check if user already exists
        const userExists = await User.findOne({ mobileNumber: identifier });
        if (userExists) {
          return fail(res, 409, "User with this mobile number already exists", "MOBILE_ALREADY_EXISTS");
        }

        // Transaction: create User, then TechnicianProfile if needed
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
          const hashedPassword = await bcrypt.hash(password, 10);
          const userDoc = await User.create([
            {
              role: normalizedRole,
              mobileNumber: identifier,
              password: hashedPassword,
              status: "Active",
            },
          ], { session });
          const user = userDoc[0];

          let technicianProfile = null;
          if (normalizedRole === "Technician") {
            technicianProfile = await TechnicianProfile.create([
              {
                userId: user._id,
                location: null, // do not use [0,0] placeholder
                workStatus: "pending",
                profileComplete: false,
              },
            ], { session });
          }

          await TempUser.deleteOne({ _id: tempUser._id }, { session });
          await Otp.deleteMany({ identifier, role: normalizedRole }, { session });

          await session.commitTransaction();
          session.endSession();

          // JWT: userId = User._id, technicianProfileId = TechnicianProfile._id (if technician)
          const tokenPayload = {
            userId: user._id,
            role: normalizedRole,
          };
          if (technicianProfile && technicianProfile[0]) {
            tokenPayload.technicianProfileId = technicianProfile[0]._id;
          }
          const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: "7d" });

          return res.status(201).json({
            success: true,
            message: "Account created successfully",
            token,
            userId: user._id,
            role: normalizedRole,
            technicianProfileId: technicianProfile && technicianProfile[0] ? technicianProfile[0]._id : null,
          });
        } catch (err) {
          await session.abortTransaction();
          session.endSession();
          return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
        }
      } catch (err) {
        return fail(res, 500, err.message || "Internal server error", "SERVER_ERROR");
      }
    };

  /* ======================================================
    5️⃣ LOGIN (Role-specific)
  ====================================================== */

  export const login = async (req, res) => {
    try {
      const { identifier, password } = req.body;

      if (!identifier || !password) {
        return fail(res, 400, "Mobile & password required", "VALIDATION_ERROR");
      }

      // LOGIN VIA USER
      const user = await User.findOne({ mobileNumber: identifier }).select("+password role");
      if (!user) return fail(res, 404, "Invalid credentials", "INVALID_CREDENTIALS");

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) return fail(res, 401, "Invalid credentials", "INVALID_CREDENTIALS");

      // Update lastLoginAt
      await User.updateOne(
        { _id: user._id },
        { $set: { lastLoginAt: new Date() } }
      );

      let technicianProfileId = null;
      if (user.role === "Technician") {
        const tech = await TechnicianProfile.findOne({ userId: user._id }).select("_id");
        technicianProfileId = tech?._id || null;
      }

      const token = jwt.sign(
        {
          userId: user._id,
          role: user.role,
          technicianProfileId,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return ok(res, 200, "Login successful", {
        token,
        userId: user._id,
        role: user.role,
        technicianProfileId,
      });
    } catch (err) {
      return fail(res, 500, err.message, "SERVER_ERROR");
    }
  };

    /* ======================================================
      6️⃣ PASSWORD RESET FLOW
    ====================================================== */

    /* ======================================================
      7️⃣ PROFILE APIs
    ====================================================== */
    export const getMyProfile = async (req, res) => {
      const { userId, role } = req.user;
      if (!userId || !role) {
        return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
      }
      if (role === "Technician") {
        const profile = await TechnicianProfile.findOne({ userId }).select("-password");
        if (!profile) return fail(res, 404, "Profile not found", "PROFILE_NOT_FOUND");
        const result = profile.toObject();
        // Optionally fetch KYC
        const kyc = await TechnicianKyc.findOne({ technicianId: profile._id }).select("bankDetails bankVerified bankUpdateRequired");
        if (kyc && kyc.bankDetails) {
          result.bankDetails = kyc.bankDetails;
          result.bankVerified = kyc.bankVerified || false;
          result.bankUpdateRequired = kyc.bankUpdateRequired || false;
        }
        return ok(res, 200, "Profile fetched successfully", result);
      } else {
        const user = await User.findById(userId).select("-password");
        if (!user) return fail(res, 404, "User not found", "USER_NOT_FOUND");
        return ok(res, 200, "Profile fetched successfully", user.toObject());
      }
    };

    export const completeProfile = async (req, res) => {
      const { userId, role } = req.user;
      if (!userId || !role) {
        return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
      }
      let allowedFields = [];
      if (role === "Technician") {
        allowedFields = [
          "firstName",
          "lastName",
          "gender",
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
        const updateData = {};
        allowedFields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
          }
        });
        // Technician geo location (optional) -> stored as GeoJSON Point + display strings
        if (updateData.latitude !== undefined || updateData.longitude !== undefined) {
          const latString = updateData.latitude;
          const lngString = updateData.longitude;
          updateData.latitude = latString;
          updateData.longitude = lngString;
          const lat = toFiniteNumber(latString);
          const lng = toFiniteNumber(lngString);
          const loc = buildLocation(lat, lng);
          if (loc) updateData.location = loc;
        }
        updateData.profileComplete = true;
        const updated = await TechnicianProfile.findOneAndUpdate(
          { userId },
          updateData,
          { new: true, runValidators: true }
        ).select("-password");
        return ok(res, 200, "Profile completed successfully", updated || {});
      } else {
        allowedFields = ["fname", "lname", "gender", "email"];
        const updateData = {};
        allowedFields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
          }
        });
        const updated = await User.findByIdAndUpdate(
          userId,
          updateData,
          { new: true, runValidators: true }
        ).select("-password");
        return ok(res, 200, "Profile completed successfully", updated || {});
      }
    };


    export const updateMyProfile = async (req, res) => {
      const { userId, role } = req.user;
      if (!userId || !role) {
        return fail(res, 401, "Unauthorized", "UNAUTHORIZED");
      }
      // Technician can update bank details here (stored in TechnicianKyc)
      if (role === "Technician" && req.body?.bankDetails) {
        const technicianProfile = await TechnicianProfile.findOne({ userId });
        if (!technicianProfile) return fail(res, 404, "Technician profile not found", "PROFILE_NOT_FOUND");
        const bankDetails = req.body.bankDetails || {};
        let kyc = await TechnicianKyc.findOne({ technicianId: technicianProfile._id });
        if (!kyc) {
          kyc = new TechnicianKyc({ technicianId: technicianProfile._id });
        }
        if (kyc.bankVerified && !kyc.bankUpdateRequired) {
          return fail(res, 403, "Bank details are verified and cannot be edited", "BANK_EDIT_BLOCKED");
        }
        const errors = [];
        if (bankDetails.accountHolderName && !/^[a-zA-Z\s]{3,}$/.test(bankDetails.accountHolderName)) {
          errors.push("Account holder name must be 3+ characters, alphabets and spaces only");
        }
        if (bankDetails.bankName && !/^[a-zA-Z\s]{3,}$/.test(bankDetails.bankName)) {
          errors.push("Bank name must be 3+ characters, alphabets and spaces only");
        }
        if (bankDetails.accountNumber && !/^\d{9,18}$/.test(bankDetails.accountNumber)) {
          errors.push("Account number must be 9-18 digits only");
        }
        if (bankDetails.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bankDetails.ifscCode).toUpperCase())) {
          errors.push("Invalid IFSC code format");
        }
        if (bankDetails.branchName && String(bankDetails.branchName).trim().length < 3) {
          errors.push("Branch name must be at least 3 characters");
        }
        if (bankDetails.upiId && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(bankDetails.upiId)) {
          errors.push("Invalid UPI ID format");
        }
        if (errors.length) {
          return fail(res, 400, "Invalid bank details", "VALIDATION_ERROR", { errors });
        }
        if (bankDetails.accountNumber) {
          const accountNumberHash = crypto
            .createHash("sha256")
            .update(String(bankDetails.accountNumber))
            .digest("hex");
          const dup = await TechnicianKyc.findOne({
            "bankDetails.accountNumberHash": accountNumberHash,
            technicianId: { $ne: technicianProfile._id },
          });
          if (dup) {
            return fail(res, 400, "Account number already registered with another technician", "DUPLICATE_ACCOUNT");
          }
        }
        const processed = {
          accountHolderName: bankDetails.accountHolderName
            ? String(bankDetails.accountHolderName)
                .toLowerCase()
                .split(" ")
                .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
                .join(" ")
            : bankDetails.accountHolderName,
          bankName: bankDetails.bankName ? String(bankDetails.bankName).trim() : bankDetails.bankName,
          accountNumber: bankDetails.accountNumber ? String(bankDetails.accountNumber).trim() : bankDetails.accountNumber,
          accountNumberHash: bankDetails.accountNumber
            ? crypto.createHash("sha256").update(String(bankDetails.accountNumber).trim()).digest("hex")
            : kyc.bankDetails?.accountNumberHash,
          ifscCode: bankDetails.ifscCode ? String(bankDetails.ifscCode).toUpperCase().trim() : bankDetails.ifscCode,
          branchName: bankDetails.branchName ? String(bankDetails.branchName).trim() : bankDetails.branchName,
          upiId: bankDetails.upiId ? String(bankDetails.upiId).toLowerCase().trim() : bankDetails.upiId,
        };
        kyc.bankDetails = { ...(kyc.bankDetails || {}), ...processed };
        kyc.bankVerified = false;
        kyc.bankUpdateRequired = false;
        kyc.bankVerificationStatus = "pending";
        kyc.bankEditableUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await kyc.save();
      }
      if (role === "Technician") {
        let allowedFields = [
          "firstName",
          "lastName",
          "gender",
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
        const updateData = {};
        allowedFields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updateData[field] = req.body[field];
          }
        });
        if (updateData.latitude !== undefined || updateData.longitude !== undefined) {
          const latString = updateData.latitude;
          const lngString = updateData.longitude;
          updateData.latitude = latString;
          updateData.longitude = lngString;
          const lat = toFiniteNumber(latString);
          const lng = toFiniteNumber(lngString);
          const loc = buildLocation(lat, lng);
          if (loc) updateData.location = loc;
        }
        const updated = await TechnicianProfile.findOneAndUpdate(
          { userId },
          updateData,
          { new: true, runValidators: true }
        ).select("-password");
        return ok(res, 200, "Profile updated successfully", updated || {});
      } else {
        let allowedFields = ["fname", "lname", "gender", "email"];
        const forbidden = new Set(["password", "status", "userId", "profileComplete"]);
        const updateData = {};
        Object.keys(req.body || {}).forEach((k) => {
          if (!forbidden.has(k) && allowedFields.includes(k)) updateData[k] = req.body[k];
        });
        const updated = await User.findByIdAndUpdate(
          userId,
          updateData,
          { new: true, runValidators: true }
        ).select("-password");
        return ok(res, 200, "Profile updated successfully", updated || {});
      }
    };

    // getUserById and getAllUsers removed: use User or TechnicianProfile directly in routes/controllers as needed.
