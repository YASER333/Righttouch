import Cart from "../Schemas/Cart.js";
import Product from "../Schemas/Product.js";
import Service from "../Schemas/Service.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import ProductBooking from "../Schemas/ProductBooking.js";
import Address from "../Schemas/Address.js";
// import CustomerProfile from "../Schemas/CustomerProfile.js";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import mongoose from "mongoose";
import { broadcastJobToTechnicians } from "../utils/sendNotification.js";
import { matchAndBroadcastBooking } from "../utils/technicianMatching.js";



const ensureCustomer = (req) => {
  if (!req.user || req.user.role !== "Customer" || !req.user.userId || !mongoose.Types.ObjectId.isValid(req.user.userId)) {
    const err = new Error("Customer access only or invalid userId");
    err.statusCode = 403;
    throw err;
  }
};

const toFiniteNumber = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normalizeAddressId = (v) => {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" || trimmed === "null" || trimmed === "undefined" ? null : trimmed;
};

/* ================= ADD TO CART ================= */
export const addToCart = async (req, res) => {
  try {

    ensureCustomer(req);
    const { itemId, itemType, quantity = 1 } = req.body;
    const customerId = req.user.userId;

    // Debug: Log what we're receiving
    console.log("Add to cart - customerId:", customerId);
    console.log("Add to cart - itemId:", itemId);
    console.log("Add to cart - itemType:", itemType);

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Customer ID not found in token",
        result: {},
      });
    }

    if (!itemId || !itemType) {
      return res.status(400).json({
        success: false,
        message: "Item ID and item type are required",
        result: {},
      });
    }

    if (!["product", "service"].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'product' or 'service'",
        result: {},
      });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive integer",
        result: {},
      });
    }

    // Check if item exists
    const item = itemType === "product"
      ? await Product.findById(itemId)
      : await Service.findById(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: `${itemType} not found`,
        result: {},
      });
    }

    // Add or update cart item (enforce unique per user/item)
    const cartItem = await Cart.findOneAndUpdate(
      { customerId, itemType, itemId },
      { $set: { quantity } },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: `${itemType} added to cart`,
      result: cartItem,
    });
  } catch (error) {
    console.error("Add to cart error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      result: { error: error.message },
    });
  }
};

/* ================= GET MY CART ================= */
export const getMyCart = async (req, res) => {
  try {
    ensureCustomer(req);
    const customerId = req.user.userId;

    const cartItems = await Cart.find({ customerId });

    // Populate items based on type (uses populate; keeps response shape the same)
    await Promise.all(
      cartItems.map(async (cartItem) => {
        const model = cartItem.itemType === "product" ? "Product" : "Service";
        await cartItem.populate({ path: "itemId", model });
      })
    );

    const populatedItems = cartItems.map((cartItem) => {
      const obj = cartItem.toObject();
      const isPopulated = obj.itemId && typeof obj.itemId === "object" && obj.itemId._id;

      return {
        ...obj,
        itemId: isPopulated ? obj.itemId._id : obj.itemId,
        item: isPopulated ? obj.itemId : null,
      };
    });

    res.status(200).json({
      success: true,
      message: "Cart fetched successfully",
      result: populatedItems,
    });
  } catch (error) {
    console.error("Get my cart error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      result: { error: error.message },
    });
  }
};

/* ================= UPDATE CART ITEM ================= */
export const updateCartItem = async (req, res) => {
  try {
    ensureCustomer(req);
    const { itemId, itemType, quantity } = req.body;
    const customerId = req.user.userId;

    if (!itemId || !itemType || quantity == null) {
      return res.status(400).json({
        success: false,
        message: "Item ID, item type, and quantity are required",
        result: {},
      });
    }

    if (!["product", "service"].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'product' or 'service'",
        result: {},
      });
    }

    if (!Number.isInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be an integer",
        result: {},
      });
    }

    if (quantity <= 0) {
      // If quantity is 0 or negative, remove the item
      await Cart.findOneAndDelete({ customerId, itemType, itemId });
      return res.status(200).json({
        success: true,
        message: "Item removed from cart",
        result: {},
      });
    }

    const cartItem = await Cart.findOneAndUpdate(
      { customerId, itemType, itemId },
      { quantity },
      { new: true, runValidators: true }
    );

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
        result: {},
      });
    }

    res.status(200).json({
      success: true,
      message: "Cart item updated",
      result: cartItem,
    });
  } catch (error) {
    console.error("Update cart item error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      result: { error: error.message },
    });
  }
};

/* ================= GET CART BY ID ================= */
export const getCartById = async (req, res) => {
  try {
    ensureCustomer(req);
    const { id } = req.params;
    const customerId = req.user.userId;

    const cartItem = await Cart.findOne({ _id: id, customerId });

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
        result: {},
      });
    }

    // Populate the item (uses populate; keeps response shape the same)
    const model = cartItem.itemType === "product" ? "Product" : "Service";
    await cartItem.populate({ path: "itemId", model });

    const obj = cartItem.toObject();
    const isPopulated = obj.itemId && typeof obj.itemId === "object" && obj.itemId._id;
    const item = isPopulated ? obj.itemId : null;

    res.status(200).json({
      success: true,
      message: "Cart item fetched",
      result: {
        ...obj,
        itemId: isPopulated ? obj.itemId._id : obj.itemId,
        item,
      },
    });
  } catch (error) {
    console.error("Get cart by id error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      result: { error: error.message },
    });
  }
};

/* ================= UPDATE CART BY ID ================= */
export const updateCartById = async (req, res) => {
  try {
    ensureCustomer(req);
    const { id } = req.params;
    const { quantity } = req.body;
    const customerId = req.user.userId;

    if (quantity == null) {
      return res.status(400).json({
        success: false,
        message: "Quantity is required",
        result: {},
      });
    }

    if (!Number.isInteger(quantity)) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be an integer",
        result: {},
      });
    }

    if (quantity <= 0) {
      // Remove the item
      const deletedItem = await Cart.findOneAndDelete({ _id: id, customerId });
      if (!deletedItem) {
        return res.status(404).json({
          success: false,
          message: "Cart item not found",
          result: {},
        });
      }
      return res.status(200).json({
        success: true,
        message: "Cart item removed",
        result: {},
      });
    }

    const cartItem = await Cart.findOneAndUpdate(
      { _id: id, customerId },
      { quantity },
      { new: true, runValidators: true }
    );

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
        result: {},
      });
    }

    res.status(200).json({
      success: true,
      message: "Cart item updated",
      result: cartItem,
    });
  } catch (error) {
    console.error("Update cart by id error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      result: { error: error.message },
    });
  }
};

/* ================= REMOVE FROM CART ================= */
export const removeFromCart = async (req, res) => {
  try {
    ensureCustomer(req);
    const { id } = req.params;
    const customerId = req.user.userId;

    const cartItem = await Cart.findOneAndDelete({ _id: id, customerId });

    if (!cartItem) {
      return res.status(404).json({
        success: false,
        message: "Cart item not found",
        result: {},
      });
    }

    res.status(200).json({
      success: true,
      message: "Item removed from cart",
      result: {},
    });
  } catch (error) {
    console.error("Remove from cart error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      result: { error: error.message },
    });
  }
};

/* ================= CHECKOUT (WITH TRANSACTION & VALIDATION) ================= */
export const checkout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    ensureCustomer(req);
    const customerId = req.user.userId;

    // Optional safety: ensure user still exists
    if (!req.user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "User not found",
        result: {},
      });
    }
    // Check for required user fields - REMOVED to allow ad-hoc checkout with provided name/phone
    // Logical validation happens later with derivedName/derivedPhone

    const addressId = normalizeAddressId(req.body?.addressId);
    const paymentMode = req.body?.paymentMode;
    const scheduledAt = req.body?.scheduledAt;

    // Check for nested address object (Frontend sends this)
    const addressPayload = req.body?.address || req.body || {};

    const addressLineInput = typeof addressPayload.addressLine === "string" ? addressPayload.addressLine.trim() : "";
    const cityInput = typeof addressPayload.city === "string" ? addressPayload.city.trim() : undefined;
    const stateInput = typeof addressPayload.state === "string" ? addressPayload.state.trim() : undefined;
    const pincodeInput = typeof addressPayload.pincode === "string" ? addressPayload.pincode.trim() : undefined;

    // Support both top-level lat/lng and nested location { latitude, longitude } and address.latitude
    const latInput =
      toFiniteNumber(addressPayload.latitude) ??
      toFiniteNumber(addressPayload.location?.latitude) ??
      toFiniteNumber(req.body?.latitude);

    const lngInput =
      toFiniteNumber(addressPayload.longitude) ??
      toFiniteNumber(addressPayload.location?.longitude) ??
      toFiniteNumber(req.body?.longitude);

    // Validate required fields
    if (!paymentMode) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "paymentMode is required",
        result: {},
      });
    }

    const hasCoords = latInput !== null && lngInput !== null;
    const hasAnyAddressInput = Boolean(addressId) || Boolean(addressLineInput) || hasCoords;
    if (!hasAnyAddressInput) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Provide either addressId or addressLine or latitude/longitude",
        result: {},
      });
    }

    // Validate payment mode
    if (!["online", "cod"].includes(paymentMode)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Payment mode must be 'online' or 'cod'",
        result: {},
      });
    }

    // 🔁 Decision Logic: Address ID vs Current Location
    let resolvedLocation;
    try {
      resolvedLocation = await resolveUserLocation({
        locationType: req.body.locationType,
        addressId: req.body.addressId,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        userId: customerId,
      });
    } catch (locErr) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: locErr.message,
        result: {},
      });
    }

    // Address Snapshot for both Products and Services
    const addressSnapshot = resolvedLocation.addressSnapshot;

    // Legacy support: ensure some address text exists
    if (!addressSnapshot.addressLine) {
      addressSnapshot.addressLine = "Pinned Location";
    }

    // Name/Phone Fallback (if not in address, e.g. GPS flow)
    // GPS flow might not have name/phone in snapshot initially effectively
    // But resolveUserLocation returns what it found. 
    // If Source=GPS, name/phone in snapshot are undefined.
    // We should fill them from User Profile if missing.
    if (!addressSnapshot.name || !addressSnapshot.phone) {
      addressSnapshot.name = [req.user.fname, req.user.lname].filter(Boolean).join(" ").trim();
      addressSnapshot.phone = req.user.mobileNumber;
    }

    // Get all cart items for the user
    const cartItems = await Cart.find({ customerId }).session(session);

    if (cartItems.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Cart is empty",
        result: {},
      });
    }

    // 🔒 VALIDATE: Remove deleted/inactive items and check for price changes
    const validServiceItems = [];
    const validProductItems = [];
    const removedItems = [];

    for (const cartItem of cartItems) {
      if (cartItem.itemType === "service") {
        const service = await Service.findById(cartItem.itemId).session(session);
        if (!service || !service.isActive) {
          await Cart.findByIdAndDelete({ _id: cartItem._id, customerId }).session(session);
          removedItems.push({ id: cartItem.itemId, type: "service", reason: "not found or inactive" });
        } else {
          validServiceItems.push(cartItem);
        }
      } else if (cartItem.itemType === "product") {
        const product = await Product.findById(cartItem.itemId).session(session);
        if (!product || !product.isActive) {
          await Cart.findByIdAndDelete({ _id: cartItem._id, customerId }).session(session);
          removedItems.push({ id: cartItem.itemId, type: "product", reason: "not found or inactive" });
        } else {
          validProductItems.push(cartItem);
        }
      }
    }

    // 🔒 Block checkout if items were removed
    if (removedItems.length > 0) {
      await session.commitTransaction();
      return res.status(400).json({
        success: false,
        message: "Some items in your cart are no longer available",
        result: { removedItems },
      });
    }

    if (validServiceItems.length === 0 && validProductItems.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "No valid items in cart",
        result: {},
      });
    }

    const bookingResults = {
      address: {
        _id: addressSnapshot._id,
        name: addressSnapshot.name,
        phone: addressSnapshot.phone,
        addressLine: addressSnapshot.addressLine,
        city: addressSnapshot.city,
        state: addressSnapshot.state,
        pincode: addressSnapshot.pincode,
        latitude: addressSnapshot.latitude,
        longitude: addressSnapshot.longitude,
      },
      serviceBookings: [],
      productBookings: [],
      totalAmount: 0,
      paymentMode,
    };

    const serviceBroadcastTasks = [];

    // Create Service Bookings
    for (const cartItem of validServiceItems) {
      const service = await Service.findById(cartItem.itemId).session(session);

      // Calculate amount
      const baseAmount = service.serviceCost * cartItem.quantity;

      const hasCoordsForBooking =
        typeof addressSnapshot?.latitude === "number" &&
        Number.isFinite(addressSnapshot.latitude) &&
        typeof addressSnapshot?.longitude === "number" &&
        Number.isFinite(addressSnapshot.longitude);

      const serviceBookingDoc = {
        customerId,
        serviceId: cartItem.itemId,
        baseAmount,
        address: addressSnapshot.addressLine,
        addressId: resolvedLocation.addressId || null,
        scheduledAt: scheduledAt || new Date(),
        status: "requested", // phase 1: booking created, broadcast happens post-commit

        // Swiggy-Style Fields
        locationType: resolvedLocation.locationType,
        addressSnapshot: addressSnapshot,
      };

      // GeoJSON Location
      serviceBookingDoc.location = {
        type: "Point",
        coordinates: [resolvedLocation.longitude, resolvedLocation.latitude],
      };

      const serviceBooking = await ServiceBooking.create([serviceBookingDoc], { session });

      // Queue for post-transaction broadcast
      serviceBroadcastTasks.push({
        bookingId: serviceBooking[0]._id,
      });

      bookingResults.serviceBookings.push({
        bookingId: serviceBooking[0]._id,
        serviceId: cartItem.itemId,
        serviceName: service.serviceName,
        quantity: cartItem.quantity,
        baseAmount,
        status: "requested",
      });

      bookingResults.totalAmount += baseAmount;
    }

    // Create Product Bookings
    for (const cartItem of validProductItems) {
      const product = await Product.findById(cartItem.itemId).session(session);

      // Calculate amount with discount and GST
      const basePrice = product.productPrice * cartItem.quantity;
      const discountAmount =
        (basePrice * (product.productDiscountPercentage || 0)) / 100;
      const discountedPrice = basePrice - discountAmount;
      const gstAmount = (discountedPrice * (product.productGst || 0)) / 100;
      const finalAmount = discountedPrice + gstAmount;

      const productBooking = await ProductBooking.create([{
        productId: cartItem.itemId,
        customerId,
        amount: finalAmount,
        paymentStatus: paymentMode === "online" ? "pending" : "pending",
        status: "active",

        // Swiggy-Style Fields
        locationType: resolvedLocation.locationType,
        addressSnapshot: addressSnapshot,
        location: {
          type: "Point",
          coordinates: [resolvedLocation.longitude, resolvedLocation.latitude],
        }
      }], { session });

      bookingResults.productBookings.push({
        bookingId: productBooking[0]._id,
        productId: cartItem.itemId,
        productName: product.productName,
        quantity: cartItem.quantity,
        basePrice,
        discount: discountAmount,
        gst: gstAmount,
        finalAmount,
        paymentStatus: "pending",
      });

      bookingResults.totalAmount += finalAmount;
    }

    // Clear the cart only after all bookings are created successfully
    await Cart.deleteMany({ customerId }).session(session);

    await session.commitTransaction();

    // 7️⃣ Post-Transaction: Broadcast Jobs (Safe & Smart)
    // We do this OUTSIDE the transaction because it involves heavy logic/sockets
    if (serviceBroadcastTasks.length > 0) {
      // Run in background (fire & forget) or await if you want to report status
      (async () => {
        for (const task of serviceBroadcastTasks) {
          await matchAndBroadcastBooking(task.bookingId, req.io);
        }
      })();
    }

    return res.status(200).json({
      success: true,
      message: "Order placed successfully",
      result: bookingResults,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Checkout error:", error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: "Checkout failed: " + error.message,
      result: { error: error.message },
    });
  } finally {
    session.endSession();
  }
};
