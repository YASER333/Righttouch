import Payment from "../Schemas/Payment.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import mongoose from "mongoose";

export const createPayment = async (req, res) => {
  try {
    const { bookingId, baseAmount } = req.body;

    if (!bookingId || !baseAmount) {
      return res.status(400).json({
        success: false,
        message: "bookingId and baseAmount are required",
        result: {},
      });
    }

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID format",
        result: {},
      });
    }

    // 🔒 Check booking
    const booking = await ServiceBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        result: {},
      });
    }

    // 🔒 Only after completion
    if (booking.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Payment allowed only after job completion",
        result: {},
      });
    }

    // 🔒 Prevent duplicate payment
    const exists = await Payment.findOne({ bookingId });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Payment already exists for this booking",
        result: {},
      });
    }

    const totalAmount = baseAmount;
    const commissionAmount = totalAmount * 0.1; // 10%
    const technicianAmount = totalAmount - commissionAmount;

    const payment = await Payment.create({
      bookingId,
      baseAmount,
      totalAmount,
      commissionAmount,
      technicianAmount,
      paymentMode: "online",
    });

    return res.status(201).json({
      success: true,
      message: "Online payment created",
      result: payment,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      result: {error: error.message},
    });
  }
};

export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID format",
        result: {},
      });
    }

    if (!["pending", "success", "failed"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status",
        result: {},
      });
    }

    // 🔒 Only update if current status is "pending" (prevent race conditions)
    const payment = await Payment.findOneAndUpdate(
      { _id: id, status: "pending" },
      { status },
      { new: true }
    );

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found or already processed",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment status updated",
      result: payment,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      result: {error: error.message},
    });
  }
};
