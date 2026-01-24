import ServiceBooking from "../Schemas/ServiceBooking.js";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import Service from "../Schemas/Service.js";
import Address from "../Schemas/Address.js";
import mongoose from "mongoose";
import { broadcastJobToTechnicians } from "../utils/sendNotification.js";
import { findEligibleTechniciansForService } from "../utils/technicianMatching.js";
import { settleBookingEarningsIfEligible } from "../utils/settlement.js";

const toNumber = value => {
  const num = Number(value);
  return Number.isNaN(num) ? NaN : num;
};

const toFiniteNumber = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};


export const createBooking = async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ success: false, message: "Unauthorized", result: {} });
    }
    if (req.user?.role !== "Customer") {
      return res.status(403).json({ success: false, message: "Customer access only", result: {} });
    }
    if (!req.user.profileId || !mongoose.Types.ObjectId.isValid(req.user.profileId)) {
      return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
    }
    const customerProfileId = req.user.profileId;

    const { serviceId, baseAmount, address, scheduledAt } = req.body;
    const addressId = typeof req.body?.addressId === "string" ? req.body.addressId.trim() : req.body?.addressId;

    const addressLineInput = typeof req.body?.addressLine === "string" ? req.body.addressLine.trim() : "";
    const cityInput = typeof req.body?.city === "string" ? req.body.city.trim() : undefined;
    const stateInput = typeof req.body?.state === "string" ? req.body.state.trim() : undefined;
    const pincodeInput = typeof req.body?.pincode === "string" ? req.body.pincode.trim() : undefined;

    const latInput =
      req.body?.latitude !== undefined
        ? toFiniteNumber(req.body.latitude)
        : toFiniteNumber(req.body?.location?.latitude);
    const lngInput =
      req.body?.longitude !== undefined
        ? toFiniteNumber(req.body.longitude)
        : toFiniteNumber(req.body?.location?.longitude);

    const hasCoords = latInput !== null && lngInput !== null;

    if (!serviceId || baseAmount == null || (!address && !addressId && !addressLineInput && !hasCoords)) {
      return res.status(400).json({
        success: false,
        message: "All fields required",
        result: {},
      });
    }

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, message: "Invalid serviceId format", result: {} });
    }

    const baseAmountNum = toNumber(baseAmount);
    if (Number.isNaN(baseAmountNum) || baseAmountNum < 0) {
      return res.status(400).json({ success: false, message: "baseAmount must be a non-negative number", result: {} });
    }

    const service = await Service.findById(serviceId);
    if (!service || !service.isActive) {
      return res.status(404).json({ success: false, message: "Service not found or inactive", result: {} });
    }

    // Optional: if addressId is provided, use Address collection (supports nearby matching)
    let addressForBooking = address || addressLineInput || (hasCoords ? "Pinned Location" : undefined);
    let addressForMatching = {
      city: cityInput,
      state: stateInput,
      pincode: pincodeInput,
      latitude: hasCoords ? latInput : undefined,
      longitude: hasCoords ? lngInput : undefined,
    };

    if (addressId) {
      if (!mongoose.Types.ObjectId.isValid(addressId)) {
        return res.status(400).json({ success: false, message: "Invalid addressId format", result: {} });
      }

      const addressDoc = await Address.findOne({
        _id: addressId,
        customerProfileId,
      });

      if (!addressDoc) {
        return res.status(404).json({ success: false, message: "Address not found", result: {} });
      }

      addressForBooking = addressDoc.addressLine;
      addressForMatching = {
        city: addressDoc.city,
        state: addressDoc.state,
        pincode: addressDoc.pincode,
        latitude: addressDoc.latitude,
        longitude: addressDoc.longitude,
      };
    }

    if (!addressForBooking) {
      return res.status(400).json({
        success: false,
        message: "addressLine or addressId is required",
        result: {},
      });
    }

    // 1️⃣ Create booking
    const bookingDoc = {
      customerProfileId,
      serviceId,
      baseAmount: baseAmountNum,
      address: addressForBooking,
      scheduledAt,
      status: "broadcasted",
    };

    const hasCoordsForBooking =
      typeof addressForMatching?.latitude === "number" &&
      Number.isFinite(addressForMatching.latitude) &&
      typeof addressForMatching?.longitude === "number" &&
      Number.isFinite(addressForMatching.longitude);

    if (hasCoordsForBooking) {
      bookingDoc.location = {
        type: "Point",
        coordinates: [addressForMatching.longitude, addressForMatching.latitude],
      };
    }

    const booking = await ServiceBooking.create(bookingDoc);

    // 2️⃣ Find eligible technicians (KYC approved + profileComplete + workStatus approved + online + skill match + nearby/area match)
    const technicians = await findEligibleTechniciansForService({
      serviceId,
      address: addressForMatching,
      radiusMeters: 5000,
      limit: 50,
      enableGeo: true,
    });

    // 3️⃣ Create broadcast records
    if (technicians.length > 0) {
      // Create JobBroadcast documents
      await JobBroadcast.insertMany(
        technicians.map((t) => ({
          bookingId: booking._id,
          technicianId: t._id,
          status: "sent",
        }))
      );

      // 4️⃣ Send notifications to all eligible technicians
      const technicianIds = technicians.map((t) => t._id.toString());
      await broadcastJobToTechnicians(
        req.io, // Socket.io instance (pass from index.js)
        technicianIds,
        {
          bookingId: booking._id,
          serviceId: service._id,
          serviceName: service.serviceName,
          baseAmount: baseAmountNum,
          address: addressForBooking,
          scheduledAt,
        }
      );

      console.log(`✅ Broadcasted to ${technicians.length} matching, online technicians`);
    } else {
      console.log("⚠️ No matching, online technicians found for this service");
    }

    return res.status(201).json({
      success: true,
      message:
        technicians.length > 0
          ? "Booking created & broadcasted"
          : "Booking created (no technicians available for this service)",
      result: {
        booking,
        broadcastCount: technicians.length,
        status: technicians.length > 0 ? "broadcasted" : "no_technicians_available",
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
      result: {error: error.message},
    });
  }
};


/* =====================================================
   GET BOOKINGS (ROLE BASED)
===================================================== */
export const getBookings = async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === "Customer") {
      if (!req.user.profileId || !mongoose.Types.ObjectId.isValid(req.user.profileId)) {
        return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
      }
      filter.customerProfileId = req.user.profileId;
    }

    if (req.user.role === "Technician") {
      const technicianProfileId = req.user?.profileId;
      if (!technicianProfileId || !mongoose.Types.ObjectId.isValid(technicianProfileId)) {
        return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
      }
      filter.technicianId = technicianProfileId;
    }

    const bookings = await ServiceBooking.find(filter)
      .populate("serviceId", "serviceName")
      .populate("customerProfileId", "firstName lastName mobileNumber")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Bookings fetched successfully",
      result: bookings,
    });
  } catch (error) {
    console.error("getBookings:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      result: {error: error.message},
    });
  }
};

/* =====================================================
   GET BOOKING FOR (CUSTOMER)
===================================================== */

export const getCustomerBookings = async (req, res) => {
  try {
    if (req.user?.role !== "Customer") {
      return res.status(403).json({ success: false, message: "Customer access only", result: {} });
    }
    if (!req.user.profileId || !mongoose.Types.ObjectId.isValid(req.user.profileId)) {
      return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
    }
    const bookings = await ServiceBooking.find({
      customerProfileId: req.user.profileId,
    })
      .populate("serviceId", "serviceName")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Customer booking history",
      result: bookings,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      result: {error: err.message},
    });
  }
};

/* =====================================================
   GET JOB FOR (TECHNICIAN)
===================================================== */

export const getTechnicianJobHistory = async (req, res) => {
  try {
    if (req.user?.role !== "Technician") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        result: {},
      });
    }

    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    const jobs = await ServiceBooking.find({
      technicianId: technicianProfileId,
      status: { $in: ["completed", "cancelled"] },
    })
      // .populate("bookingId")
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Job history fetched",
      result: jobs,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      result: {error: err.message},
    });
  }
};


/* =====================================================
   GET JOB FOR (TECHNICIAN)
===================================================== */
export const getTechnicianCurrentJobs = async (req, res) => {
  try {
    if (req.user.role !== "Technician") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        result: {},
      });
    }

    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    const jobs = await ServiceBooking.find({
      technicianId: technicianProfileId,
      status: { $in: ["accepted", "on_the_way", "reached", "in_progress"] },
    })
    .populate({
      path: "customerProfileId",
      select: "firstName lastName mobileNumber",
    })
    .populate({
      path: "addressId",
      select: "name phone addressLine city state pincode latitude longitude",
    })
    .populate({
      path: "serviceId",
      select: "serviceName",
    })
    .sort({ createdAt: -1 });
      

    return res.status(200).json({
      success: true,
      message: "Active jobs fetched",
      result: jobs,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      result: {error: err.message},
    });
  }
};


/* =====================================================
   UPDATE BOOKING STATUS (TECHNICIAN)
===================================================== */
export const updateBookingStatus = async (req, res) => {
  try {
    const userRole = req.user?.role;

    const bookingId = req.params.id;
    const { status } = req.body;

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID format",
        result: {},
      });
    }

    const allowedStatus = [
      "on_the_way",
      "reached",
      "in_progress",
      "completed",
    ];

    if (!bookingId || !allowedStatus.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
        result: {},
      });
    }

    const booking = await ServiceBooking.findById(bookingId);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        result: {},
      });
    }

    if (userRole !== "Technician") {
      return res.status(403).json({ success: false, message: "Only technician can update status", result: {} });
    }

    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId || !booking.technicianId || booking.technicianId.toString() !== technicianProfileId.toString()) {
      return res.status(403).json({ success: false, message: "Access denied for this booking", result: {} });
    }

    // Check technician approval status
    const technician = await TechnicianProfile.findById(technicianProfileId);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician profile not found",
        result: {},
      });
    }

    if (!technician.profileComplete) {
      return res.status(403).json({
        success: false,
        message: "Please complete your profile first",
        result: { profileComplete: false },
      });
    }

    // Check KYC status
    const TechnicianKyc = mongoose.model('TechnicianKyc');
    const kyc = await TechnicianKyc.findOne({ technicianId: technicianProfileId });
    if (!kyc || kyc.verificationStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your KYC must be approved before updating job status. Status: " + (kyc?.verificationStatus || "not_submitted"),
        result: { kycStatus: kyc?.verificationStatus || "not_submitted" },
      });
    }

    // Check workStatus
    if (technician.workStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your account must be approved by owner before working. Status: " + technician.workStatus,
        result: { workStatus: technician.workStatus },
      });
    }

    booking.status = status;
    await booking.save();

    if (status === "completed") {
      // If payment is already verified, credit technician wallet (idempotent)
      await settleBookingEarningsIfEligible(booking._id);
    }

    return res.status(200).json({
      success: true,
      message: "Status updated",
      result: booking,
    });
  } catch (error) {
    console.error("updateBookingStatus:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      result: {error: error.message},
    });
  }
};


/* =====================================================
   CANCEL BOOKING (CUSTOMER)
===================================================== */
export const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking ID format",
        result: {},
      });
    }

    // 1️⃣ Find booking
    const booking = await ServiceBooking.findById(id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
        result: {},
      });
    }

    // 2️⃣ Only CUSTOMER who created booking can cancel
    if (req.user.role !== "Customer") {
      return res.status(403).json({
        success: false,
        message: "Only customer can cancel booking",
        result: {},
      });
    }

    if (!req.user.profileId || !mongoose.Types.ObjectId.isValid(req.user.profileId)) {
      return res.status(401).json({ success: false, message: "Invalid token profile", result: {} });
    }

    if (booking.customerProfileId.toString() !== req.user.profileId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
        result: {},
      });
    }

    // 3️⃣ Prevent double cancel
    if (booking.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Booking already cancelled",
        result: {},
      });
    }

    // 4️⃣ Prevent cancel after work completed
    if (booking.status === "completed") {
      return res.status(400).json({
        success: false,
        message: "Completed booking cannot be cancelled",
        result: {},
      });
    }

    // 5️⃣ OPTIONAL (recommended)
    // Prevent cancel once technician is working
    if (["on_the_way", "reached", "in_progress"].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: "Booking cannot be cancelled once technician started work",
        result: {},
      });
    }

    // 6️⃣ Cancel booking
    booking.status = "cancelled";
    await booking.save();

    return res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      result: booking,
    });
  } catch (error) {
    console.error("cancelBooking:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
      result: {error: error.message},
    });
  }
};
