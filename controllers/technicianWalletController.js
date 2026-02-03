import mongoose from "mongoose";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import WalletTransaction from "../Schemas/TechnicianWallet.js";
import WithdrawalRequest from "../Schemas/WithdrawalRequest.js";

const isValidObjectId = mongoose.Types.ObjectId.isValid;

const toMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const getConfig = () => {
  const minWithdrawal = toMoney(process.env.MIN_WITHDRAWAL_AMOUNT) ?? 500;
  const cooldownDays = toMoney(process.env.WITHDRAWAL_COOLDOWN_DAYS) ?? 7;
  return {
    minWithdrawal,
    cooldownMs: Math.max(0, cooldownDays) * 24 * 60 * 60 * 1000,
  };
};

// Add Wallet Transaction (Owner only)
export const createWalletTransaction = async (req, res) => {
  try {
    const { technicianId, bookingId, amount, type, source } = req.body;

    if (req.user?.role !== "Owner") {
      return res.status(403).json({
        success: false,
        message: "Owner access only",
        result: {},
      });
    }

    if (!technicianId || !isValidObjectId(technicianId)) {
      return res.status(400).json({
        success: false,
        message: "Valid technicianId is required",
        result: {},
      });
    }

    if (bookingId && !isValidObjectId(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bookingId",
        result: {},
      });
    }

    if (amount === undefined || Number.isNaN(Number(amount))) {
      return res.status(400).json({
        success: false,
        message: "Amount must be numeric",
        result: {},
      });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be positive",
        result: {},
      });
    }

    if (!["credit", "debit"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction type",
        result: {},
      });
    }

    if (!["job", "penalty"].includes(source)) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction source",
        result: {},
      });
    }

    const technician = await TechnicianProfile.findById(technicianId);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
        result: {},
      });
    }

    if (bookingId) {
      const booking = await ServiceBooking.findOne({ _id: bookingId, technicianId });
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Booking not found for technician",
          result: {},
        });
      }
    }

    const transaction = await WalletTransaction.create({
      technicianId,
      bookingId,
      amount: Number(amount),
      type,
      source,
    });

    res.status(201).json({
      success: true,
      message: "Wallet transaction recorded",
      result: transaction,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, result: { error: error.message } });
  }
};

// Get Technician Wallet History
export const getWalletHistory = async (req, res) => {
  try {
    const isOwner = req.user?.role === "Owner";
    const requestedTechnicianId = req.query?.technicianId;

    if (!req.user?.userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    let technicianId;

    if (isOwner && requestedTechnicianId) {
      if (!isValidObjectId(requestedTechnicianId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid technicianId",
          result: {},
        });
      }
      technicianId = requestedTechnicianId;
    } else {
      technicianId = req.user?.profileId;
      if (!technicianId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
          result: {},
        });
      }
    }

    const history = await WalletTransaction.find({ technicianId })
      .populate("technicianId", "firstName lastName skills status")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      message: "Wallet history fetched successfully",
      result: history,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, result: { error: error.message } });
  }
};

// Technician requests a payout (weekly/minimum rules)
export const requestWithdrawal = async (req, res) => {
  try {
    if (req.user?.role !== "Technician") {
      return res.status(403).json({ success: false, message: "Technician access only", result: {} });
    }

    const technicianId = req.user?.technicianProfileId;
    if (!technicianId || !isValidObjectId(technicianId)) {
      return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
    }

    const { minWithdrawal, cooldownMs } = getConfig();
    const amount = toMoney(req.body?.amount);
    if (amount == null || amount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be a positive number", result: {} });
    }
    if (amount < minWithdrawal) {
      return res.status(400).json({ success: false, message: `Minimum withdrawal is ${minWithdrawal}`, result: {} });
    }

    const technician = await TechnicianProfile.findById(technicianId).select("walletBalance");
    if (!technician) {
      return res.status(404).json({ success: false, message: "Technician not found", result: {} });
    }

    if (Number(technician.walletBalance || 0) < amount) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance", result: { walletBalance: technician.walletBalance || 0 } });
    }

    const active = await WithdrawalRequest.findOne({ technicianId, status: { $in: ["requested", "approved"] } });
    if (active) {
      return res.status(400).json({ success: false, message: "You already have an active withdrawal request", result: { requestId: active._id, status: active.status } });
    }

    const last = await WithdrawalRequest.findOne({ technicianId }).sort({ createdAt: -1 });
    if (last && cooldownMs > 0 && Date.now() - new Date(last.createdAt).getTime() < cooldownMs) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal cooldown active. Try later.",
        result: { lastRequestedAt: last.createdAt, cooldownDays: cooldownMs / (24 * 60 * 60 * 1000) },
      });
    }

    const reqDoc = await WithdrawalRequest.create({ technicianId, amount, status: "requested" });
    return res.status(201).json({ success: true, message: "Withdrawal requested", result: reqDoc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, result: { error: error.message } });
  }
};

export const getMyWithdrawals = async (req, res) => {
  try {
    if (req.user?.role !== "Technician") {
      return res.status(403).json({ success: false, message: "Technician access only", result: {} });
    }
    const technicianId = req.user?.technicianProfileId;
    if (!technicianId || !isValidObjectId(technicianId)) {
      return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
    }

    const list = await WithdrawalRequest.find({ technicianId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, message: "Withdrawals fetched", result: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, result: { error: error.message } });
  }
};

export const cancelMyWithdrawal = async (req, res) => {
  try {
    if (req.user?.role !== "Technician") {
      return res.status(403).json({ success: false, message: "Technician access only", result: {} });
    }
    const technicianId = req.user?.technicianProfileId;
    const { id } = req.params;
    if (!technicianId || !isValidObjectId(technicianId)) {
      return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
    }
    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid withdrawal id", result: {} });
    }

    const doc = await WithdrawalRequest.findOneAndUpdate(
      { _id: id, technicianId, status: "requested" },
      { $set: { status: "cancelled", decidedAt: new Date(), decisionNote: "Cancelled by technician" } },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Withdrawal not found or cannot be cancelled", result: {} });
    }
    return res.status(200).json({ success: true, message: "Withdrawal cancelled", result: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, result: { error: error.message } });
  }
};

// Owner views withdrawals (queue)
export const ownerListWithdrawals = async (req, res) => {
  try {
    if (req.user?.role !== "Owner") {
      return res.status(403).json({ success: false, message: "Owner access only", result: {} });
    }

    const status = req.query?.status;
    const filter = {};
    if (status && ["requested", "approved", "rejected", "paid", "cancelled"].includes(status)) {
      filter.status = status;
    }

    const list = await WithdrawalRequest.find(filter)
      .populate("technicianId", "firstName lastName mobileNumber walletBalance")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, message: "Withdrawals fetched", result: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message, result: { error: error.message } });
  }
};

// Owner approves/rejects/marks-paid a withdrawal
export const ownerDecideWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    if (req.user?.role !== "Owner") {
      return res.status(403).json({ success: false, message: "Owner access only", result: {} });
    }

    const { id } = req.params;
    const { action, note, payoutProvider, payoutReference } = req.body;

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid withdrawal id", result: {} });
    }
    if (!action || !["approve", "reject", "mark_paid"].includes(action)) {
      return res.status(400).json({ success: false, message: "action must be approve|reject|mark_paid", result: {} });
    }

    let updated;

    await session.withTransaction(async () => {
      const doc = await WithdrawalRequest.findById(id).session(session);
      if (!doc) {
        const err = new Error("Withdrawal not found");
        err.statusCode = 404;
        throw err;
      }

      if (action === "approve") {
        if (doc.status !== "requested") {
          const err = new Error("Only requested withdrawals can be approved");
          err.statusCode = 400;
          throw err;
        }

        const tech = await TechnicianProfile.findById(doc.technicianId).select("walletBalance").session(session);
        if (!tech) {
          const err = new Error("Technician not found");
          err.statusCode = 404;
          throw err;
        }

        if (Number(tech.walletBalance || 0) < Number(doc.amount)) {
          const err = new Error("Insufficient wallet balance to approve");
          err.statusCode = 400;
          throw err;
        }

        // Reserve funds immediately by debiting wallet (prevents double-spend)
        const tx = await WalletTransaction.create(
          [
            {
              technicianId: doc.technicianId,
              amount: Number(doc.amount),
              type: "debit",
              source: "withdrawal",
              note: "Withdrawal approved - funds reserved",
            },
          ],
          { session }
        );

        await TechnicianProfile.updateOne(
          { _id: doc.technicianId },
          { $inc: { walletBalance: -Number(doc.amount) } },
          { session }
        );

        doc.status = "approved";
        doc.decidedAt = new Date();
        doc.decidedBy = req.user?.userId || null;
        doc.decisionNote = note || null;
        doc.walletTransactionId = tx?.[0]?._id || null;
        updated = await doc.save({ session });
        return;
      }

      if (action === "reject") {
        if (doc.status !== "requested") {
          const err = new Error("Only requested withdrawals can be rejected");
          err.statusCode = 400;
          throw err;
        }
        doc.status = "rejected";
        doc.decidedAt = new Date();
        doc.decidedBy = req.user?.userId || null;
        doc.decisionNote = note || null;
        updated = await doc.save({ session });
        return;
      }

      if (action === "mark_paid") {
        if (doc.status !== "approved") {
          const err = new Error("Only approved withdrawals can be marked paid");
          err.statusCode = 400;
          throw err;
        }
        doc.status = "paid";
        doc.decidedAt = new Date();
        doc.decidedBy = req.user?.userId || null;
        doc.decisionNote = note || null;
        doc.payoutProvider = payoutProvider || doc.payoutProvider || "manual";
        doc.payoutReference = payoutReference || doc.payoutReference || null;
        updated = await doc.save({ session });
        return;
      }
    });

    return res.status(200).json({ success: true, message: "Withdrawal updated", result: updated });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error.message, result: { error: error.message } });
  } finally {
    session.endSession();
  }
};
