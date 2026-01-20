import mongoose from "mongoose";

const cartSchema = new mongoose.Schema(
  {
    customerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CustomerProfile",
      required: true,
    },
    itemType: {
      type: String,
      enum: ["product", "service"],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
  },
  { timestamps: true }
);

// Ensure unique cart item per customer profile per item
cartSchema.index({ customerProfileId: 1, itemType: 1, itemId: 1 }, { unique: true });

export default mongoose.models.Cart || mongoose.model("Cart", cartSchema);