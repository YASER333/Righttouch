import mongoose from "mongoose";

const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function (v) {
          return (
            Array.isArray(v) &&
            v.length === 2 &&
            typeof v[0] === "number" &&
            Number.isFinite(v[0]) &&
            typeof v[1] === "number" &&
            Number.isFinite(v[1])
          );
        },
        message: "location.coordinates must be [longitude, latitude]",
      },
    },
  },
  { _id: false }
);

const serviceBookingSchema = new mongoose.Schema(
  {
    // 👤 CUSTOMER
    customerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerProfile",
      required: true,
      index: true,
    },

    // 🛠 SERVICE
    serviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: true,
      index: true,
    },

    // 👨‍🔧 TECHNICIAN (assigned after accept)
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TechnicianProfile",
      default: null,
      index: true,
    },

    // 💰 PRICE SNAPSHOT
    baseAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // 📍 ADDRESS
    address: {
      type: String,
      required: true,
      trim: true,
    },

    // 📍 ADDRESS REFERENCE (for customer details)
    addressId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Address",
      default: null,
      index: true,
    },

    // ⏰ SCHEDULE
    scheduledAt: {
      type: Date,
    },

    // 💳 PAYMENT
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded"],
      default: "pending",
      index: true,
    },

    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
    },

    // 📌 STATUS FLOW
    status: {
      type: String,
      enum: [
        "requested",
        "broadcasted",
        "accepted",
        "on_the_way",
        "reached",
        "in_progress",
        "completed",
        "cancelled",
      ],
      default: "requested",
      index: true,
    },

    assignedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

// Helpful index for technician dashboard
serviceBookingSchema.index({ technicianId: 1, status: 1 });

// 2dsphere index for geo queries (optional, but required when using $near for bookings)
serviceBookingSchema.index({ location: "2dsphere" });

export default mongoose.models.ServiceBooking || mongoose.model("ServiceBooking", serviceBookingSchema);
