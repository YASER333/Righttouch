import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    customerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerProfile",
      required: true,
      index: true,
    },

    label: {
      type: String,
      enum: ["home", "office", "other"],
      default: "home",
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      match: [/^[0-9]{10}$/, "Phone must be 10 digits"],
    },

    addressLine: {
      type: String,
      required: true,
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

    latitude: {
      type: String,
      trim: true,
    },

    longitude: {
      type: String,
      trim: true,
    },

    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

/**
 * Only ONE default address per customer
 */
addressSchema.index(
  { customerProfileId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export default mongoose.models.Address ||
  mongoose.model("Address", addressSchema);
