import Cart from "../Schemas/Cart.js";
import Product from "../Schemas/Product.js";
import Service from "../Schemas/Service.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import ProductBooking from "../Schemas/ProductBooking.js";
import Address from "../Schemas/Address.js";
import CustomerProfile from "../Schemas/CustomerProfile.js";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import mongoose from "mongoose";
import { broadcastJobToTechnicians } from "../utils/sendNotification.js";

// Cleanup old indexes on startup
const cleanupOldIndexes = async () => {
  try {
    const indexes = await Cart.collection.getIndexes();
    for (const indexName of Object.keys(indexes)) {
      if (indexName.includes("userId") || indexName.includes("productId")) {
        await Cart.collection.dropIndex(indexName);
        console.log(`Dropped old index: ${indexName}`);
      }
    }
  } catch (err) {
    console.error("Index cleanup error:", err);
  }
};

// Run cleanup once
cleanupOldIndexes();

const ensureCustomer = (req) => {
  if (!req.user || req.user.role !== "Customer") {
    const err = new Error("Customer access only");
    err.statusCode = 403;
    throw err;
  }
  if (!req.user.profileId || !mongoose.Types.ObjectId.isValid(req.user.profileId)) {
    const err = new Error("Invalid token profile");
    err.statusCode = 401;
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
  if (typeof v !== "string") return v || null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
};

/* ================= ADD TO CART ================= */
export const addToCart = async (req, res) => {
  try {
    ensureCustomer(req);
    const { itemId, itemType, quantity = 1 } = req.body;
    const customerProfileId = req.user.profileId;

    // Debug: Log what we're receiving
    console.log("Add to cart - customerProfileId:", customerProfileId);
    console.log("Add to cart - itemId:", itemId);
    console.log("Add to cart - itemType:", itemType);

    if (!customerProfileId) {
      return res.status(401).json({
        success: false,
        message: "Customer profile ID not found in token",
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
    const item =
      itemType === "product"
        ? await Product.findById(itemId)
        : await Service.findById(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: `${itemType} not found`,
        result: {},
      });
    }

    // Add or update cart item
    const cartItem = await Cart.findOneAndUpdate(
      { customerProfileId, itemType, itemId },
      { quantity },
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
      result: {error: error.message},
    });
  }
};

/* ================= GET MY CART ================= */
export const getMyCart = async (req, res) => {
  try {
    ensureCustomer(req);
    const customerProfileId = req.user.profileId;

    const cartItems = await Cart.find({ customerProfileId });

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
      result: {error: error.message},
    });
  }
};

/* ================= UPDATE CART ITEM ================= */
export const updateCartItem = async (req, res) => {
  try {
    ensureCustomer(req);
    const { itemId, itemType, quantity } = req.body;
    const customerProfileId = req.user.profileId;

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
      await Cart.findOneAndDelete({ customerProfileId, itemType, itemId });
      return res.status(200).json({
        success: true,
        message: "Item removed from cart",
        result: {},
      });
    }

    const cartItem = await Cart.findOneAndUpdate(
      { customerProfileId, itemType, itemId },
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
      result: {error: error.message},
    });
  }
};

/* ================= GET CART BY ID ================= */
export const getCartById = async (req, res) => {
  try {
    ensureCustomer(req);
    const { id } = req.params;
    const customerProfileId = req.user.profileId;

    const cartItem = await Cart.findOne({ _id: id, customerProfileId });

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
      result: {error: error.message},
    });
  }
};

/* ================= UPDATE CART BY ID ================= */
export const updateCartById = async (req, res) => {
  try {
    ensureCustomer(req);
    const { id } = req.params;
    const { quantity } = req.body;
    const customerProfileId = req.user.profileId;

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
      const deletedItem = await Cart.findOneAndDelete({ _id: id, customerProfileId });
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
      { _id: id, customerProfileId },
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
      result: {error: error.message},
    });
  }
};

/* ================= REMOVE FROM CART ================= */
export const removeFromCart = async (req, res) => {
  try {
    ensureCustomer(req);
    const { id } = req.params;
    const customerProfileId = req.user.profileId;

    const cartItem = await Cart.findOneAndDelete({ _id: id, customerProfileId });

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
      result: {error: error.message},
    });
  }
};

/* ================= CHECKOUT (WITH TRANSACTION & VALIDATION) ================= */
export const checkout = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    ensureCustomer(req);
    const customerProfileId = req.user.profileId;

    // Optional safety: ensure profile still exists
    const customerProfile = await CustomerProfile.findById(customerProfileId).session(session);
    if (!customerProfile) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Customer profile not found",
        result: {},
      });
    }
    const addressId = normalizeAddressId(req.body?.addressId);
    const paymentMode = req.body?.paymentMode;
    const scheduledAt = req.body?.scheduledAt;

    const addressLineInput = typeof req.body?.addressLine === "string" ? req.body.addressLine.trim() : "";
    const cityInput = typeof req.body?.city === "string" ? req.body.city.trim() : undefined;
    const stateInput = typeof req.body?.state === "string" ? req.body.state.trim() : undefined;
    const pincodeInput = typeof req.body?.pincode === "string" ? req.body.pincode.trim() : undefined;

    // Support both top-level lat/lng and nested location { latitude, longitude }
    const latInput =
      req.body?.latitude !== undefined
        ? toFiniteNumber(req.body.latitude)
        : toFiniteNumber(req.body?.location?.latitude);
    const lngInput =
      req.body?.longitude !== undefined
        ? toFiniteNumber(req.body.longitude)
        : toFiniteNumber(req.body?.location?.longitude);

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

    // Resolve address snapshot (from saved Address or from direct input)
    let address = null;
    let addressSnapshot = null;

    if (addressId) {
      // 🔒 Validate ObjectId
      if (!mongoose.Types.ObjectId.isValid(addressId)) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Invalid addressId format",
          result: {},
        });
      }

      address = await Address.findOne({ _id: addressId, customerProfileId }).session(session);
      if (!address) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: "Address not found or does not belong to you",
          result: {},
        });
      }

      addressSnapshot = {
        _id: address._id,
        name: address.name,
        phone: address.phone,
        addressLine: address.addressLine,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        latitude: address.latitude,
        longitude: address.longitude,
      };
    } else {
      const derivedName = [customerProfile.firstName, customerProfile.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

      const derivedPhone = customerProfile.mobileNumber;

      const finalAddressLine = addressLineInput || "Pinned Location";

      if (!derivedName || !derivedPhone) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Please complete your profile (firstName, mobileNumber) before checkout",
          result: {},
        });
      }

      // Basic range validation when coordinates are provided
      if (hasCoords) {
        if (latInput < -90 || latInput > 90 || lngInput < -180 || lngInput > 180) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: "Invalid latitude/longitude range",
            result: { latitude: latInput, longitude: lngInput },
          });
        }
      }

      addressSnapshot = {
        _id: null,
        name: derivedName,
        phone: derivedPhone,
        addressLine: finalAddressLine,
        city: cityInput,
        state: stateInput,
        pincode: pincodeInput,
        latitude: hasCoords ? latInput : undefined,
        longitude: hasCoords ? lngInput : undefined,
      };
    }

    // Get all cart items for the user
    const cartItems = await Cart.find({ customerProfileId }).session(session);

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
          await Cart.findByIdAndDelete(cartItem._id).session(session);
          removedItems.push({ id: cartItem.itemId, type: "service", reason: "not found or inactive" });
        } else {
          validServiceItems.push(cartItem);
        }
      } else if (cartItem.itemType === "product") {
        const product = await Product.findById(cartItem.itemId).session(session);
        if (!product || !product.isActive) {
          await Cart.findByIdAndDelete(cartItem._id).session(session);
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
        customerProfileId,
        serviceId: cartItem.itemId,
        baseAmount,
        address: addressSnapshot.addressLine,
        addressId: addressSnapshot._id,
        scheduledAt: scheduledAt || new Date(),
        status: "requested", // phase 1: booking created, broadcast happens post-commit
      };

      if (hasCoordsForBooking) {
        serviceBookingDoc.location = {
          type: "Point",
          coordinates: [addressSnapshot.longitude, addressSnapshot.latitude],
        };
      }

      const serviceBooking = await ServiceBooking.create([serviceBookingDoc], { session });

      // Phase 2 happens after commit: match technicians + create JobBroadcast + emit sockets/push
      serviceBroadcastTasks.push({
        bookingId: serviceBooking[0]._id,
        serviceId: cartItem.itemId,
        serviceName: service.serviceName,
        baseAmount,
        scheduledAt: scheduledAt || new Date(),
        addressSnapshot: {
          addressLine: addressSnapshot.addressLine,
          city: addressSnapshot.city,
          state: addressSnapshot.state,
          pincode: addressSnapshot.pincode,
          latitude: addressSnapshot.latitude,
          longitude: addressSnapshot.longitude,
        },
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
        customerProfileId,
        amount: finalAmount,
        paymentStatus: paymentMode === "online" ? "pending" : "pending",
        status: "active",
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
    await Cart.deleteMany({ customerProfileId }).session(session);

    await session.commitTransaction();

    // Phase 2: after commit, run broadcast asynchronously (non-blocking)
    setImmediate(async () => {
      try {
        // Fetch ALL technicians (NO VALIDATION per requirement)
        const allTechnicians = await TechnicianProfile.find({}, { _id: 1 }).lean();
        const allTechnicianIds = (Array.isArray(allTechnicians) ? allTechnicians : [])
          .map((t) => t?._id)
          .filter(Boolean)
          .map((id) => id.toString());

        const hasTechnicians = allTechnicianIds.length > 0;

        const chunk = (arr, size) => {
          const out = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        };

        for (const task of serviceBroadcastTasks) {
          // Skip broadcasting if booking already got assigned/cancelled in the meantime.
          // We allow both "requested" and already-"broadcasted" bookings here to make retries safe.
          const bookingStillOpen = await ServiceBooking.findOne(
            {
              _id: task.bookingId,
              status: { $in: ["requested", "broadcasted"] },
              technicianId: null,
            },
            { _id: 1 }
          );

          if (!bookingStillOpen) {
            continue;
          }

          // Mark booking broadcasted only if it hasn't been assigned yet.
          // Do this BEFORE inserting broadcasts so technicians fetching quickly can still populate.
          await ServiceBooking.updateOne(
            { _id: task.bookingId, status: { $in: ["requested", "broadcasted"] }, technicianId: null },
            { $set: { status: "broadcasted" } }
          );

          const now = new Date();

          const technicianIds = allTechnicianIds;

          if (hasTechnicians) {
            for (const batch of chunk(technicianIds, 1000)) {
              try {
                await JobBroadcast.insertMany(
                  batch.map((technicianId) => ({
                    bookingId: task.bookingId,
                    technicianId,
                    status: "sent",
                    sentAt: now,
                  })),
                  { ordered: false }
                );
              } catch (e) {
                // Ignore duplicate key errors due to unique (bookingId, technicianId)
                if (e?.code !== 11000) {
                  throw e;
                }
              }
            }
          }

          // Fire-and-forget notifications (non-blocking)
          Promise.resolve(
            broadcastJobToTechnicians(req.io, technicianIds, {
              bookingId: task.bookingId,
              serviceId: task.serviceId,
              serviceName: task.serviceName,
              baseAmount: task.baseAmount,
              address: task.addressSnapshot.addressLine,
              scheduledAt: task.scheduledAt,
            })
          ).catch((err) => {
            console.error("⚠️ Broadcast notification failed (non-blocking):", err);
          });
        }
      } catch (notifErr) {
        console.error("⚠️ Post-commit broadcast failed (non-blocking):", notifErr);
      }
    });

    res.status(201).json({
      success: true,
      message: "Checkout completed successfully",
      result: bookingResults,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Checkout error:", error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: "Checkout failed: " + error.message,
      result: {error: error.message},
    });
  } finally {
    session.endSession();
  }
};
