import crypto from "node:crypto";
import https from "node:https";
import mongoose from "mongoose";

import Payment from "../Schemas/Payment.js";
import PaymentEvent from "../Schemas/PaymentEvent.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import Service from "../Schemas/Service.js";
import { settleBookingEarningsIfEligible } from "../utils/settlement.js";

const ok = (res, status, message, result = {}) =>
  res.status(status).json({ success: true, message, result });

const fail = (res, status, message, result = {}) =>
  res.status(status).json({ success: false, message, result });

// ... existing code ...

export const retryPaymentSettlement = async (req, res) => {
  try {
    // Only Admin or Owner can force retry
    if (!["Admin", "Owner"].includes(req.user?.role)) {
      return fail(res, 403, "Admin/Owner access only", {});
    }

    const { bookingId } = req.body;
    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return fail(res, 400, "Valid bookingId is required", {});
    }

    const { settled, reason } = await settleBookingEarningsIfEligible(bookingId);

    if (settled) {
      return ok(res, 200, "Settlement successful", { reason });
    } else {
      return fail(res, 400, "Settlement not applicable or failed", { reason });
    }

  } catch (error) {
    return fail(res, 500, error.message, { error: error?.message });
  }
};


const toMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const razorpayRequest = async ({ method, path, body }) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const err = new Error("Razorpay keys not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)");
    err.statusCode = 500;
    throw err;
  }

  const payload = body ? JSON.stringify(body) : "";

  const options = {
    hostname: "api.razorpay.com",
    path,
    method,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
  };

  return await new Promise((resolve, reject) => {
    const req = https.request(options, (resp) => {
      let data = "";
      resp.on("data", (chunk) => (data += chunk));
      resp.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : {};
        } catch {
          json = { raw: data };
        }
        if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
          return resolve(json);
        }
        const err = new Error(json?.error?.description || json?.message || "Razorpay request failed");
        err.statusCode = resp.statusCode || 502;
        err.details = json;
        return reject(err);
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
};

const computeSplitFromService = ({ service, payableAmount }) => {
  const totalAmount = round2(payableAmount);
  const pct = toMoney(service?.commissionPercentage) ?? 0;
  const commissionAmount = round2((totalAmount * pct) / 100);
  const technicianAmount = round2(totalAmount - commissionAmount);
  return {
    commissionPercentage: pct,
    totalAmount,
    commissionAmount,
    technicianAmount,
  };
};


// 1) Customer creates an online payment order (platform collects 100%)
export const createPaymentOrder = async (req, res) => {
  try {
    if (req.user?.role !== "Customer") {
      return fail(res, 403, "Customer access only", {});
    }

    const { bookingId } = req.body;
    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return fail(res, 400, "Valid bookingId is required", {});
    }

    const booking = await ServiceBooking.findById(bookingId);
    if (!booking) return fail(res, 404, "Booking not found", {});

    if (booking.customerId?.toString() !== req.user.userId?.toString()) {
      return fail(res, 403, "Access denied for this booking", {});
    }

    if (booking.paymentStatus === "paid") {
      return ok(res, 200, "Booking already paid", {
        bookingId: booking._id,
        paymentStatus: booking.paymentStatus,
        orderId: booking.paymentOrderId,
      });
    }

    // Swiggy-style: payment happens after technician accepts (or later), but never before booking exists
    const allowedBookingStatuses = ["accepted", "on_the_way", "reached", "in_progress", "completed"];
    if (!allowedBookingStatuses.includes(booking.status)) {
      return fail(res, 400, `Payment not allowed in status: ${booking.status}`, {});
    }

    const service = await Service.findById(booking.serviceId);
    if (!service) return fail(res, 404, "Service not found", {});

    const payableAmount = toMoney(booking.baseAmount);
    if (payableAmount == null || payableAmount < 0) {
      return fail(res, 400, "Invalid booking baseAmount", {});
    }

    const split = computeSplitFromService({ service, payableAmount });

    // Idempotency: reuse existing pending Payment + orderId if present
    let payment = await Payment.findOne({ bookingId: booking._id });
    if (!payment) {
      payment = await Payment.create({
        bookingId: booking._id,
        baseAmount: split.totalAmount,
        totalAmount: split.totalAmount,
        commissionAmount: split.commissionAmount,
        technicianAmount: split.technicianAmount,
        paymentMode: "online",
        provider: "razorpay",
        currency: "INR",
      });
    }

    // Create Razorpay order only if not already created
    if (!payment.providerOrderId) {
      const amountInPaise = Math.round(split.totalAmount * 100);
      const receipt = `booking_${booking._id.toString()}`;
      const order = await razorpayRequest({
        method: "POST",
        path: "/v1/orders",
        body: {
          amount: amountInPaise,
          currency: "INR",
          receipt,
          payment_capture: 1,
          notes: {
            bookingId: booking._id.toString(),
            customerId: booking.customerId.toString(),
          },
        },
      });

      payment.providerOrderId = order.id;
      await payment.save();

      booking.paymentOrderId = order.id;
      booking.paymentProvider = "razorpay";
      booking.paidAmount = 0;
      booking.commissionPercentage = split.commissionPercentage;
      booking.commissionAmount = split.commissionAmount;
      booking.technicianAmount = split.technicianAmount;
      booking.paymentId = payment._id;
      await booking.save();
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    return ok(res, 201, "Payment order created", {
      provider: "razorpay",
      keyId,
      bookingId: booking._id,
      orderId: payment.providerOrderId,
      amount: payment.totalAmount,
      currency: payment.currency,
      commissionAmount: payment.commissionAmount,
      technicianAmount: payment.technicianAmount,
    });
  } catch (error) {
    return fail(res, error?.statusCode || 500, error.message || "Failed to create payment order", {
      error: error?.details || error?.message,
    });
  }
};

// 2) Customer payment verification (server-side) after checkout success
export const verifyPayment = async (req, res) => {
  try {
    if (req.user?.role !== "Customer") {
      return fail(res, 403, "Customer access only", {});
    }

    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return fail(res, 400, "Valid bookingId is required", {});
    }
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return fail(res, 400, "razorpay_order_id, razorpay_payment_id, razorpay_signature are required", {});
    }

    const booking = await ServiceBooking.findById(bookingId);
    if (!booking) return fail(res, 404, "Booking not found", {});
    if (booking.customerId?.toString() !== req.user.userId?.toString()) {
      return fail(res, 403, "Access denied for this booking", {});
    }

    const payment = await Payment.findOne({ bookingId: booking._id });
    if (!payment) return fail(res, 404, "Payment record not found", {});

    if (payment.status === "success") {
      await settleBookingEarningsIfEligible(booking._id);
      return ok(res, 200, "Payment already verified", { paymentId: payment._id, status: payment.status });
    }

    if (payment.providerOrderId !== razorpay_order_id) {
      return fail(res, 400, "OrderId mismatch", {});
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return fail(res, 500, "Razorpay secret not configured", {});

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      await Payment.updateOne(
        { _id: payment._id, status: "pending" },
        { $set: { status: "failed", failureReason: "Invalid signature" } }
      );
      return fail(res, 400, "Payment verification failed", { reason: "Invalid signature" });
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await Payment.findOneAndUpdate(
          { _id: payment._id, status: "pending" },
          {
            $set: {
              status: "success",
              providerPaymentId: razorpay_payment_id,
              providerSignature: razorpay_signature,
              verifiedAt: new Date(),
            },
          },
          { new: true, session }
        );

        if (!updated) return;

        await ServiceBooking.updateOne(
          { _id: booking._id },
          {
            $set: {
              paymentStatus: "paid",
              paymentProvider: "razorpay",
              paymentOrderId: razorpay_order_id,
              paymentProviderPaymentId: razorpay_payment_id,
              paidAmount: updated.totalAmount,
              paymentId: updated._id,
            },
          },
          { session }
        );
      });
    } finally {
      session.endSession();
    }

    await settleBookingEarningsIfEligible(booking._id);
    return ok(res, 200, "Payment verified successfully", {
      bookingId: booking._id,
      paymentStatus: "paid",
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
    });
  } catch (error) {
    return fail(res, error?.statusCode || 500, error.message || "Failed to verify payment", {
      error: error?.details || error?.message,
    });
  }
};

// 3) Razorpay webhook (server-to-server) for audit + future refunds
export const razorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) return fail(res, 500, "Webhook secret not configured", {});

    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.rawBody;
    if (!signature || !rawBody) return fail(res, 400, "Missing webhook signature/body", {});

    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (expected !== signature) return fail(res, 400, "Invalid webhook signature", {});

    const event = req.body;
    const eventId = event?.event_id || event?.id;
    const eventType = event?.event;
    if (!eventId || !eventType) return fail(res, 400, "Invalid webhook payload", {});

    const existing = await PaymentEvent.findOne({ eventId });
    if (existing) return ok(res, 200, "Webhook already processed", {});

    // Best-effort linking
    const orderId = event?.payload?.payment?.entity?.order_id;
    const paymentId = event?.payload?.payment?.entity?.id;

    let paymentDoc = null;
    if (orderId) paymentDoc = await Payment.findOne({ provider: "razorpay", providerOrderId: orderId });
    if (!paymentDoc && paymentId) paymentDoc = await Payment.findOne({ provider: "razorpay", providerPaymentId: paymentId });

    await PaymentEvent.create({
      provider: "razorpay",
      eventId,
      bookingId: paymentDoc?.bookingId || null,
      paymentId: paymentDoc?._id || null,
      eventType,
      payload: event,
    });

    // If webhook says captured/authorized, we still do NOT mark paid without signature verification flow.
    // Webhook is used for audit + future refunds/disputes.

    return ok(res, 200, "Webhook processed", {});
  } catch (error) {
    return fail(res, 500, error.message || "Webhook processing failed", { error: error?.message });
  }
};

// Legacy endpoint: keep route but guide callers to new endpoints
export const createPayment = async (req, res) => {
  return fail(res, 410, "Deprecated. Use /api/user/payment/order", {});
};

// Legacy status update: owner/system can still mark failed/success (admin tooling)
export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, failureReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return fail(res, 400, "Invalid payment ID format", {});
    }

    if (!["pending", "success", "failed"].includes(status)) {
      return fail(res, 400, "Invalid payment status", {});
    }

    const payment = await Payment.findOneAndUpdate(
      { _id: id },
      { $set: { status, ...(status === "failed" ? { failureReason: failureReason || "manual" } : {}) } },
      { new: true }
    );

    if (!payment) return fail(res, 404, "Payment not found", {});
    if (status === "success") {
      await ServiceBooking.updateOne(
        { _id: payment.bookingId },
        { $set: { paymentStatus: "paid", paymentId: payment._id } }
      );
      await settleBookingEarningsIfEligible(payment.bookingId);
    }
    return ok(res, 200, "Payment status updated", payment);
  } catch (error) {
    return fail(res, 500, error.message, { error: error?.message });
  }
};

export const __internal = { settleBookingEarningsIfEligible };
