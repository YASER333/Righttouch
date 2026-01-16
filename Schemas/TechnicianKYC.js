import mongoose from "mongoose";

const technicianKycSchema = new mongoose.Schema(
  {
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TechnicianProfile",
      required: true,
      unique: true,
      index: true,
    },

    aadhaarNumber: {
      type: String,
      trim: true,
    },

    panNumber: {
      type: String,
      trim: true,
    },

    drivingLicenseNumber: {
      type: String,
      trim: true,
    },

    documents: {
      aadhaarUrl: String,
      panUrl: String,
      dlUrl: String,
    },

    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    rejectionReason: {
      type: String,
      trim: true,
    },

    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // admin
    },

    verifiedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.models.TechnicianKyc || mongoose.model("TechnicianKyc", technicianKycSchema);
