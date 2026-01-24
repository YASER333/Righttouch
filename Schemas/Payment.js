import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceBooking",
      required: true,
      unique: true, // one payment per booking
    },

    provider: {
      type: String,
      enum: ["razorpay"],
      default: "razorpay",
      index: true,
    },

    currency: {
      type: String,
      default: "INR",
    },

    providerOrderId: {
      type: String,
      default: null,
      index: true,
    },

    providerPaymentId: {
      type: String,
      default: null,
      index: true,
    },

    providerSignature: {
      type: String,
      default: null,
      select: false,
    },

    verifiedAt: {
      type: Date,
      default: null,
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
      index: true,
    },

    failureReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

paymentSchema.index(
  { provider: 1, providerOrderId: 1 },
  { unique: true, partialFilterExpression: { providerOrderId: { $type: "string" } } }
);

paymentSchema.index(
  { provider: 1, providerPaymentId: 1 },
  { unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } } }
);

export default mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
