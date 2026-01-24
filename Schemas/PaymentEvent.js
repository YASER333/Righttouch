import mongoose from "mongoose";

const paymentEventSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["razorpay"],
      required: true,
      index: true,
    },

    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceBooking",
      default: null,
      index: true,
    },

    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
      index: true,
    },

    eventType: {
      type: String,
      required: true,
      index: true,
    },

    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.models.PaymentEvent ||
  mongoose.model("PaymentEvent", paymentEventSchema);
