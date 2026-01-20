import mongoose from "mongoose";

const ownerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email"],
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
      select: false,
    },

    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },

    firstName: {
      type: String,
      trim: true,
    },

    lastName: {
      type: String,
      trim: true,
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    mobileNumber: {
      type: String,
      unique: true,
      sparse: true,
      match: [/^[0-9]{10}$/, "Invalid mobile number"],
    },

    /* ==========================
       🏢 BUSINESS DETAILS
    ========================== */
    companyName: {
      type: String,
      trim: true,
    },

    businessType: {
      type: String,
      trim: true,
    },

    /* ==========================
       📍 REGISTERED ADDRESS
    ========================== */
    address: {
      type: String,
      trim: true,
    },

    city: {
      type: String,
      trim: true,
    },

    state: {
      type: String,
      trim: true,
    },

    pincode: {
      type: String,
      match: [/^[0-9]{6}$/, "Invalid pincode"],
    },

    gstNumber: {
      type: String,
      trim: true,
    },

    profileComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export default mongoose.models.OwnerProfile ||
  mongoose.model("OwnerProfile", ownerProfileSchema);
