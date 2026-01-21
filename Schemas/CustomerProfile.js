import mongoose from "mongoose";

const customerProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      default: undefined,
      set: (v) => (v === null || v === undefined || v === "" ? undefined : v),
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
    firstName: String,
    lastName: String,
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },
    mobileNumber: {
      type: String,
      match: [/^[0-9]{10}$/, "Invalid mobile number"],
    },
    profileComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Unique email only when a real string email exists (allows many users without email)
customerProfileSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $exists: true, $type: "string" },
    },
  }
);

// Ensure customer addresses are stored only in the Address collection.
// Strip any legacy stored fields from API responses.
const stripLegacyAddressFields = (_doc, ret) => {
  delete ret.address;
  delete ret.city;
  delete ret.state;
  delete ret.pincode;
  return ret;
};

customerProfileSchema.set("toJSON", { transform: stripLegacyAddressFields });
customerProfileSchema.set("toObject", { transform: stripLegacyAddressFields });

export default mongoose.models.CustomerProfile ||
  mongoose.model("CustomerProfile", customerProfileSchema);
