import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TechnicianProfile",
      required: true,
    },

    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceBooking",
    },

    amount: {
      type: Number,
      required: true,
    },

    type: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },

    source: {
      type: String,
      enum: ["job", "penalty", "withdrawal", "adjustment"],
      required: true,
    },

    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
      index: true,
    },

    note: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

// ✅ One job-credit per booking (prevents double-credit)
walletTransactionSchema.index(
  { bookingId: 1, type: 1, source: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bookingId: { $type: "objectId" },
      type: "credit",
      source: "job",
    },
  }
);

export default mongoose.models.WalletTransaction || mongoose.model("WalletTransaction", walletTransactionSchema);
                