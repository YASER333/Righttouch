// Schemas/JobBroadcast.js
import mongoose from "mongoose";

const jobBroadcastSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ServiceBooking",
      required: true,
      index: true,
    },

    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TechnicianProfile",
      required: true,
      index: true,
    },

    sentAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Business expiry: treat expiresAt < now as expired, even if TTL cleanup hasn't run yet.
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 1000), // 60s
    },

    status: {
      type: String,
      enum: ["sent", "accepted", "rejected", "expired"],
      default: "sent",
      index: true,
    },
  },
  { timestamps: true }
);

// 🚨 Prevent duplicate job sends
jobBroadcastSchema.index(
  { bookingId: 1, technicianId: 1 },
  { unique: true }
);

// TTL cleanup (not business logic)
jobBroadcastSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.JobBroadcast || mongoose.model("JobBroadcast", jobBroadcastSchema);
