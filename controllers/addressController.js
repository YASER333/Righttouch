import mongoose from "mongoose";

import Address from "../Schemas/Address.js";
import User from "../Schemas/User.js";

const ensureCustomer = (req) => {
  if (!req.user || req.user.role !== "Customer") {
    const err = new Error("Customer access only");
    err.statusCode = 403;
    throw err;
  }
  if (!req.user.userId || !mongoose.Types.ObjectId.isValid(req.user.userId)) {
    const err = new Error("Invalid token profile");
    err.statusCode = 401;
    throw err;
  }
};

const getAddressIdFromReq = (req) => req.params?.id || req.body?.addressId || req.body?.id;

/* ================= CREATE ADDRESS ================= */
export const createAddress = async (req, res) => {
  try {
    ensureCustomer(req);
    const customerId = req.user.userId;

    const {
      label,
      addressLine,
      city,
      state,
      pincode,
      latitude,
      longitude,
      isDefault,
    } = req.body;

    if (!addressLine) {
      return res.status(400).json({
        success: false,
        message: "Address line is required",
        result: {},
      });
    }

    // 🔒 Optional safety limit
    const count = await Address.countDocuments({ customerId });
    if (count >= 10) {
      return res.status(400).json({
        success: false,
        message: "Address limit reached",
        result: {},
      });
    }

    // 🔒 Ensure single default address
    if (isDefault) {
      await Address.updateMany(
        { customerId },
        { isDefault: false }
      );
    }

    // ✅ Take name + phone from User (not from request body)
    const customer = await User.findById(customerId).select(
      "fname lname mobileNumber email"
    );

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer profile not found",
        result: {},
      });
    }

    const derivedName = [customer.fname, customer.lname]
      .filter(Boolean)
      .join(" ")
      .trim();

    const derivedPhone = customer.mobileNumber;

    if (!derivedName || !derivedPhone) {
      return res.status(400).json({
        success: false,
        message: "Please complete your profile (firstName, mobileNumber) before adding an address",
        result: {},
      });
    }

    const address = await Address.create({
      customerId,
      label: label || "home",
      name: derivedName,
      phone: derivedPhone,
      addressLine,
      city,
      state,
      pincode,
      latitude,
      longitude,
      isDefault: Boolean(isDefault),
    });

    return res.status(201).json({
      success: true,
      message: "Address created successfully",
      result: address,
    });
  } catch (error) {
    console.error("Create address error:", error);
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create address",
      result: {},
    });
  }
};


/* ================= GET ALL ADDRESSES ================= */
export const getMyAddresses = async (req, res) => {
  try {
    ensureCustomer(req);

    const addresses = await Address.find({
      customerId: req.user.userId,
    })
      .populate("customerId", "fname lname mobileNumber email")
      .sort({ isDefault: -1, createdAt: -1 });

    res.json({
      success: true,
      result: addresses,
    });
  } catch (err) {
    res.status(err?.statusCode || 500).json({
      success: false,
      message: err.message,
      result: {},
    });
  }
};


/* ================= GET SINGLE ADDRESS ================= */
export const getAddressById = async (req, res) => {
  try {
    ensureCustomer(req);

    const addressId = getAddressIdFromReq(req);
    if (!addressId) {
      return res.status(400).json({
        success: false,
        message: "addressId is required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address id",
        result: {},
      });
    }

    const address = await Address.findOne({
      _id: addressId,
      customerId: req.user.userId,
    }).populate("customerId", "fname lname mobileNumber email");

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
        result: {},
      });
    }

    res.json({ success: true, result: address });
  } catch (err) {
    res.status(err?.statusCode || 500).json({
      success: false,
      message: err.message,
      result: {},
    });
  }
};

/* ================= UPDATE ADDRESS ================= */
export const updateAddress = async (req, res) => {
  try {
    ensureCustomer(req);

    const id = getAddressIdFromReq(req);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "addressId is required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address id",
        result: {},
      });
    }

    const address = await Address.findOne({
      _id: id,
      customerId: req.user.userId,
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
        result: {},
      });
    }

    if (req.body.isDefault) {
      await Address.updateMany(
        { customerId: req.user.userId, _id: { $ne: id } },
        { isDefault: false }
      );
    }

    // Only allow safe updates
    const allowed = [
      "label",
      "addressLine",
      "city",
      "state",
      "pincode",
      "latitude",
      "longitude",
      "isDefault",
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) address[key] = req.body[key];
    }

    await address.save();

    res.json({ success: true, result: address });
  } catch (err) {
    res.status(err?.statusCode || 500).json({
      success: false,
      message: err.message,
      result: {},
    });
  }
};


/* ================= DELETE ADDRESS ================= */
export const deleteAddress = async (req, res) => {
  try {
    ensureCustomer(req);

    const id = getAddressIdFromReq(req);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "addressId is required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address id",
        result: {},
      });
    }

    const address = await Address.findOneAndDelete({
      _id: id,
      customerId: req.user.userId,
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
        result: {},
      });
    }

    res.status(200).json({
      success: true,
      message: "Address deleted successfully",
      result: {},
    });
  } catch (error) {
    console.error("Delete address error:", error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete address",
      result: {error: error.message},
    });
  }
};

/* ================= SET DEFAULT ADDRESS ================= */
export const setDefaultAddress = async (req, res) => {
  try {
    ensureCustomer(req);

    const id = getAddressIdFromReq(req);
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "addressId is required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid address id",
        result: {},
      });
    }

    // Check if address exists and belongs to customer
    const address = await Address.findOne({
      _id: id,
      customerId: req.user.userId,
    });

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
        result: {},
      });
    }

    // Unset all other defaults
    await Address.updateMany(
      { customerId: req.user.userId, _id: { $ne: id } },
      { isDefault: false }
    );

    // Set this as default
    const updatedAddress = await Address.findByIdAndUpdate(
      id,
      { isDefault: true },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Default address updated",
      result: updatedAddress,
    });
  } catch (error) {
    console.error("Set default address error:", error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to set default address",
      result: {error: error.message},
    });
  }
};

/* ================= GET DEFAULT ADDRESS ================= */
export const getDefaultAddress = async (req, res) => {
  try {
    ensureCustomer(req);

    const address = await Address.findOne({
      customerId: req.user.userId,
      isDefault: true,
    }).populate("customerId", "fname lname mobileNumber email");

    if (!address) {
      return res.status(404).json({
        success: false,
        message: "No default address set",
        result: {},
      });
    }

    res.status(200).json({
      success: true,
      message: "Default address fetched successfully",
      result: address,
    });
  } catch (error) {
    console.error("Get default address error:", error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch default address",
      result: {error: error.message},
    });
  }
};

/* ================= ADMIN: GET ALL ADDRESSES ================= */
export const adminGetAllAddresses = async (req, res) => {
  try {
    const addresses = await Address.find()
      .populate("customerId", "fname lname mobileNumber email")
      .sort({ createdAt: -1 });
    res.json({ success: true, result: addresses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, result: {} });
  }
};

/* ================= ADMIN: GET ADDRESS BY ID ================= */
export const adminGetAddressById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid address id", result: {} });
    }

    const address = await Address.findById(id).populate(
      "customerId",
      "fname lname mobileNumber email"
    );
    if (!address) {
      return res.status(404).json({ success: false, message: "Address not found", result: {} });
    }

    res.json({ success: true, result: address });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message, result: {} });
  }
};
