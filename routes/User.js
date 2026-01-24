import express from "express";
import { upload } from "../utils/cloudinaryUpload.js";
import rateLimit from "express-rate-limit";

import {
  signupAndSendOtp,
  resendOtp,
  verifyOtp,
  setPassword,
  login,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
  getMyProfile,
  completeProfile,
  updateMyProfile,
  getUserById,
  getAllUsers,
} from "../controllers/User.js";

import {
  serviceCategory,
  uploadCategoryImage,
  removeCategoryImage,
  getAllCategory,
  getByIdCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/categoryController.js";

import {
  userRating,
  getAllRatings,
  getRatingById,
  updateRating,
  deleteRating,
} from "../controllers/ratingController.js";

import {
  userReport,
  getAllReports,
  getReportById,
} from "../controllers/reportController.js";

import {
  createService,
  uploadServiceImages,
  removeServiceImage,
  replaceServiceImages,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
} from "../controllers/serviceController.js";

import {
  createBooking,
  getBookings,
  getCustomerBookings,
  cancelBooking,
} from "../controllers/serviceBookController.js";


import {
  createProduct,
  getProduct,
  getOneProduct,
  deleteProduct,
  uploadProductImages,
  removeProductImage,
  replaceProductImages,
  updateProduct,
} from "../controllers/productController.js";

import {
  productBooking,
  getAllProductBooking,
  productBookingUpdate,
  productBookingCancel,
} from "../controllers/productBooking.js";

import {
  createPayment,
  createPaymentOrder,
  verifyPayment,
  razorpayWebhook,
  updatePaymentStatus,
} from "../controllers/paymentController.js";

import {
  addToCart,
  getMyCart,
  updateCartItem,
  removeFromCart,
  getCartById,
  updateCartById,
  checkout,
} from "../controllers/cartController.js";

import { Auth, authorizeRoles } from "../middleware/Auth.js";

const router = express.Router();

const getClientIp = (req) => {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  if (req.ip) return req.ip;
  return req.socket?.remoteAddress || "unknown";
};

// 🔒 Strict Rate Limiters for Authentication
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  //max: 50, // 50 attempts per window (increased for testing)
  message: {
    success: false,
    message: "Too many attempts, please try again after 15 minutes",
    result: {},
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: (req) => getClientIp(req),
  validate: { ip: false },
  keyGenerator: (req) => getClientIp(req),
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // max: 3, // 3 OTP requests per window
  message: {
    success: false,
    message: "Too many OTP requests, please try again after 15 minutes",
    result: {},
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ================= USER ================= */
router.post("/signup", authLimiter, signupAndSendOtp);
router.post("/resend-otp", otpLimiter, resendOtp);
router.post("/verify-otp", authLimiter, verifyOtp);
router.post("/set-password", authLimiter, setPassword);
router.post("/login", authLimiter, login);
router.post(
  "/request-password-reset-otp",
  otpLimiter,
  requestPasswordResetOtp
);
router.post(
  "/verify-password-reset-otp",
  authLimiter,
  verifyPasswordResetOtp
);
router.post("/reset-password", authLimiter, resetPassword);
router.get("/me", Auth, getMyProfile);
router.post("/complete-profile", Auth, completeProfile);
router.put("/me", Auth, updateMyProfile);
router.get("/users/:role/:id", Auth, getUserById);
router.get("/users/:role", Auth, getAllUsers);


/* ================= CATEGORY ================= */

router.post("/category", Auth, serviceCategory);
router.post(
  "/category/upload-image",
  Auth,
  upload.single("image"),
  uploadCategoryImage
);
router.delete("/category/remove-image", Auth, removeCategoryImage);
router.get("/getAllcategory", getAllCategory);
router.get("/getByIdcategory/:id", getByIdCategory);
router.put("/updatecategory/:id", Auth, updateCategory);
router.delete("/deletecategory/:id", Auth, deleteCategory);

/* ================= REPORT ================= */

router.post("/report", Auth, userReport);
router.get("/getAllReports", getAllReports);
router.get("/getReportById/:id", Auth, getReportById);

/* ================= SERVICE ================= */

router.post("/service", Auth, createService);
router.post(
  "/services/upload-images",
  Auth,
  upload.array("serviceImages", 5),
  uploadServiceImages
);
router.delete("/services/remove-image", Auth, removeServiceImage);
router.put(
  "/services/replace-images",
  Auth,
  upload.array("serviceImages", 5),
  replaceServiceImages
);
router.get("/getAllServices", getAllServices);
router.get("/getServiceById/:id", getServiceById);
router.put("/updateService/:id", Auth, updateService);
router.delete("/services/:id", Auth, deleteService);

/* ================= SERVICE BOOKING ================= */

// Booking creation happens via /checkout (cart)
// router.post("/serviceBook", Auth, createBooking);

// Admin / Technician / Customer view bookings
router.get("/service/booking", Auth,
  getBookings);

// Customer / Admin cancels booking
router.put("/booking/cancel/:id", Auth, cancelBooking);

router.get("/booking/getCustomerBookings", Auth, getCustomerBookings);

/* ================= RATING ================= */

router.post("/rating", Auth, userRating);
router.get("/getAllRatings", getAllRatings);
router.get("/getRatingById/:id", getRatingById);
router.put("/updateRating/:id", Auth, updateRating);
router.delete("/deleteRating/:id", Auth, deleteRating);

/* ================= PRODUCT ================= */

router.post("/product", Auth, createProduct);
router.post(
  "/product/upload-images",
  Auth,
  upload.array("productImages", 5),
  uploadProductImages
);
router.delete("/product/remove-image", Auth, removeProductImage);
router.put(
  "/product/replace-images",
  Auth,
  upload.array("productImages", 5),
  replaceProductImages
);
router.get("/getProduct", getProduct);
router.get("/getOneProduct/:id", getOneProduct);
router.put(
  "/updateProduct/:id",
  Auth,
  upload.array("productImages", 5),
  updateProduct
);
router.delete("/deleteProduct/:id", Auth, deleteProduct);

/* ================= PRODUCT BOOKING ================= */

// Booking creation happens via /checkout (cart)
// router.post("/productBooking", Auth, productBooking);
router.get("/getAllProductBooking", Auth, getAllProductBooking);
router.put("/productBookingUpdate/:id", Auth, productBookingUpdate);
router.put("/productBookingCancel/:id", Auth, productBookingCancel);

/* ================= PAYMENT ================= */

// Create online payment (Customer)
router.post("/payment", Auth, createPayment);

// ✅ New: Create gateway order (Customer)
router.post("/payment/order", Auth, createPaymentOrder);

// ✅ New: Verify signature (Customer)
router.post("/payment/verify", Auth, verifyPayment);

// ✅ New: Webhook (no Auth) - requires raw body capture in index.js
router.post("/payment/webhook/razorpay", razorpayWebhook);

// Update payment status (System/Admin/Webhook)
router.put("/payment/:id/status", Auth, updatePaymentStatus);

/* ================= CART ================= */
router.post("/cart/add", Auth, addToCart);
router.get("/cart/my-cart", Auth, getMyCart);
router.get("/cart/:id", Auth, getCartById);
router.put("/cart/update", Auth, updateCartItem);
router.put("/cart/:id", Auth, updateCartById);
router.delete("/cart/remove/:id", Auth, removeFromCart);

/* ================= CHECKOUT ================= */
router.post("/checkout", Auth, checkout);

export default router;
