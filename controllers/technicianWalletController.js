import mongoose from "mongoose";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import WalletTransaction from "../Schemas/TechnicianWallet.js";

const isValidObjectId = mongoose.Types.ObjectId.isValid;

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

    if (![ "job", "penalty"].includes(source)) {
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
    res.status(500).json({ success: false, message: error.message, result: {error: error.message} });
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
    res.status(500).json({ success: false, message: error.message, result: {error: error.message} });
  }
};
