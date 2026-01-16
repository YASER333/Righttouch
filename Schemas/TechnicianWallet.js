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
      enum: ["job", "penalty"],
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.models.WalletTransaction || mongoose.model("WalletTransaction", walletTransactionSchema);
                