import Cart from "../Schemas/Cart.js";
import Product from "../Schemas/Product.js";
import Service from "../Schemas/Service.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import ProductBooking from "../Schemas/ProductBooking.js";
import Address from "../Schemas/Address.js";
import CustomerProfile from "../Schemas/CustomerProfile.js";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import mongoose from "mongoose";
import { broadcastJobToTechnicians } from "../utils/sendNotification.js";
import { findEligibleTechniciansForService } from "../utils/technicianMatching.js";

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
    const { addressId, paymentMode, scheduledAt } = req.body;

    // Validate required fields
    if (!addressId || !paymentMode) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Address ID and payment mode are required",
        result: {},
      });
    }

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(addressId)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid address ID format",
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

    // Get address - verify it belongs to this user
    const address = await Address.findOne({ _id: addressId, customerProfileId }).session(session);

    if (!address) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Address not found or does not belong to you",
        result: {},
      });
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
        _id: address._id,
        name: address.name,
        phone: address.phone,
        addressLine: address.addressLine,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
      },
      serviceBookings: [],
      productBookings: [],
      totalAmount: 0,
      paymentMode,
    };

    const notificationsToSend = [];

    // Create Service Bookings
    for (const cartItem of validServiceItems) {
      const service = await Service.findById(cartItem.itemId).session(session);

      // Calculate amount
      const baseAmount = service.serviceCost * cartItem.quantity;

      const serviceBooking = await ServiceBooking.create([{
        customerProfileId,
        serviceId: cartItem.itemId,
        baseAmount,
        address: address.addressLine,
        scheduledAt: scheduledAt || new Date(),
        status: "broadcasted",
      }], { session });

      // Broadcast job to eligible technicians (KYC approved + profileComplete + workStatus approved + online + skill match + nearby/area match)
      // Geo selection runs outside the transaction session; writes remain transactional.
      const technicians = await findEligibleTechniciansForService({
        serviceId: cartItem.itemId,
        address: {
          city: address.city,
          state: address.state,
          pincode: address.pincode,
          latitude: address.latitude,
          longitude: address.longitude,
        },
        radiusMeters: 5000,
        limit: 50,
        enableGeo: true,
      });

      if (technicians.length > 0) {
        await JobBroadcast.insertMany(
          technicians.map((t) => ({
            bookingId: serviceBooking[0]._id,
            technicianId: t._id,
            status: "sent",
          })),
          { session, ordered: false }
        );

        notificationsToSend.push({
          technicianIds: technicians.map((t) => t._id.toString()),
          jobData: {
            bookingId: serviceBooking[0]._id,
            serviceId: service._id,
            serviceName: service.serviceName,
            baseAmount,
            address: address.addressLine,
            scheduledAt: scheduledAt || new Date(),
          },
        });
      }

      bookingResults.serviceBookings.push({
        bookingId: serviceBooking[0]._id,
        serviceId: cartItem.itemId,
        serviceName: service.serviceName,
        quantity: cartItem.quantity,
        baseAmount,
        status: "broadcasted",
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

    // Send notifications AFTER successful commit (non-blocking)
    try {
      for (const item of notificationsToSend) {
        await broadcastJobToTechnicians(req.io, item.technicianIds, item.jobData);
      }
    } catch (notifErr) {
      console.error("⚠️ Checkout notifications failed (non-blocking):", notifErr.message);
    }

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
