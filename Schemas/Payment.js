import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceBooking",
      required: true,
      unique: true, // one payment per booking
    },

    baseAmount: {
      type: Number,
      required: true,
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    commissionAmount: {
      type: Number,
      required: true,
    },

    technicianAmount: {
      type: Number,
      required: true,
    },

    paymentMode: {
      type: String,
      enum: ["online"], // ✅ ONLY ONLINE
      default: "online",
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export default mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
