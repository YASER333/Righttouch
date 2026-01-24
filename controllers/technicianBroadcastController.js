import mongoose from "mongoose";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import { notifyCustomerJobAccepted, notifyJobTaken } from "../utils/sendNotification.js";
import { getTechnicianJobEligibility } from "../utils/technicianEligibility.js";

const eligibilityToHttp = (eligibility, { action } = {}) => {
  const status = eligibility?.status || {};
  const reasons = Array.isArray(eligibility?.reasons) ? eligibility.reasons : [];

  if (reasons.includes("invalid_profileId") || reasons.includes("technician_not_found")) {
    return {
      httpStatus: 401,
      message: "Unauthorized",
      result: { eligibility },
    };
  }

  if (reasons.includes("profile_incomplete")) {
    return {
      httpStatus: 403,
      message: "Please complete your profile first",
      result: { profileComplete: false, eligibility },
    };
  }

  if (reasons.includes("kyc_not_approved")) {
    if (status.kycStatus === "not_submitted") {
      return {
        httpStatus: 403,
        message: "Please submit your KYC documents first",
        result: { kycStatus: status.kycStatus, eligibility },
      };
    }
    return {
      httpStatus: 403,
      message: "Your KYC is not approved yet. Current status: " + status.kycStatus,
      result: { kycStatus: status.kycStatus, eligibility },
    };
  }

  if (reasons.includes("workStatus_not_approved")) {
    return {
      httpStatus: 403,
      message: "Your account is not approved by owner yet. Current status: " + status.workStatus,
      result: { workStatus: status.workStatus, eligibility },
    };
  }

  if (reasons.includes("offline")) {
    return {
      httpStatus: 403,
      message:
        "You must be online to " +
        (action === "accept" ? "accept job broadcasts" : "view job broadcasts") +
        ".",
      result: { isOnline: false, eligibility },
    };
  }

  return {
    httpStatus: 403,
    message: "You are not eligible for job broadcasts.",
    result: { eligibility },
  };
};

/* ================= GET MY JOBS ================= */
export const getMyJobs = async (req, res) => {
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

    const eligibility = await getTechnicianJobEligibility({ technicianProfileId });
    if (!eligibility.eligible) {
      const { httpStatus, message, result } = eligibilityToHttp(eligibility);
      return res.status(httpStatus).json({
        success: false,
        message,
        result,
      });
    }

    const jobs = await JobBroadcast.find({
      technicianId: technicianProfileId,
      status: "sent",
    })
      .populate({
        path: "bookingId",
        // Cart checkout creates booking as "requested" then flips to "broadcasted" post-commit.
        // Allow both to avoid race where technician fetches jobs before the flip.
        match: { status: { $in: ["requested", "broadcasted"] } },
        populate: [
          {
            path: "serviceId",
            select: "serviceName",
          },
          {
            path: "customerProfileId",
            select: "firstName lastName mobileNumber",
          },
          {
            path: "addressId",
            select: "name phone addressLine city state pincode latitude longitude",
          },
        ],
      })
      .sort({ createdAt: -1 });

    const filteredJobs = jobs.filter((job) => job.bookingId);

    return res.status(200).json({
      success: true,
      message: "Jobs fetched successfully",
      result: filteredJobs,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      result: {error: err.message},
    });
  }
};


/* ================= RESPOND TO JOB ================= */
export const respondToJob = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { status } = req.body;

    if (req.user?.role !== "Technician") {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Access denied",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid broadcast ID",
        result: {},
      });
    }

    if (!["accepted", "rejected"].includes(status)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid status",
        result: {},
      });
    }

    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId) {
      await session.abortTransaction();
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    const eligibility = await getTechnicianJobEligibility({
      technicianProfileId,
      session,
    });
    if (!eligibility.eligible) {
      const { httpStatus, message, result } = eligibilityToHttp(eligibility, {
        action: "accept",
      });
      await session.abortTransaction();
      return res.status(httpStatus).json({
        success: false,
        message,
        result,
      });
    }

    const job = await JobBroadcast.findById(id).session(session);

    if (!job || job.status !== "sent") {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Job already processed",
        result: {},
      });
    }

    const now = new Date();

    if (job.technicianId.toString() !== technicianProfileId.toString()) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Access denied",
        result: {},
      });
    }

    if (status === "rejected") {
      const rejected = await JobBroadcast.updateOne(
        { _id: job._id, technicianId: technicianProfileId, status: "sent" },
        { $set: { status: "rejected" } },
        { session }
      );

      if (rejected.modifiedCount !== 1) {
        await session.abortTransaction();
        return res.status(409).json({
          success: false,
          message: "Job already processed",
          result: {},
        });
      }
      await session.commitTransaction();

      return res.status(200).json({
        success: true,
        message: "Job rejected successfully",
        result: {},
      });
    }

    // First accept wins (atomic): only assign if still broadcasted AND unassigned
    const booking = await ServiceBooking.findOneAndUpdate(
      { _id: job.bookingId, status: { $in: ["requested", "broadcasted"] }, technicianId: null },
      { technicianId: technicianProfileId, status: "accepted", assignedAt: now },
      { new: true, session }
    );

    if (!booking) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Booking already taken",
        result: {},
      });
    }

    const accepted = await JobBroadcast.updateOne(
      { _id: job._id, technicianId: technicianProfileId, status: "sent" },
      { $set: { status: "accepted" } },
      { session }
    );

    if (accepted.modifiedCount !== 1) {
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: "Job already processed",
        result: {},
      });
    }

    // Update all other broadcasts for this booking to expired
    const otherBroadcasts = await JobBroadcast.find(
      { bookingId: booking._id, _id: { $ne: job._id } },
      { technicianId: 1 }
    ).session(session);

    await JobBroadcast.updateMany(
      { bookingId: booking._id, _id: { $ne: job._id } },
      { $set: { status: "expired" } },
      { session }
    );

    await session.commitTransaction();

    // 5️⃣ Send notifications AFTER transaction commits
    try {
      // Notify customer about job acceptance
      await notifyCustomerJobAccepted(req.io, booking.customerProfileId, {
        bookingId: booking._id,
        technicianId: technicianProfileId,
        status: "accepted",
      });

      // Notify other technicians that job was taken
      const otherTechnicianIds = otherBroadcasts
        .map((b) => b.technicianId.toString())
        .filter((id) => id !== technicianProfileId.toString());

      if (otherTechnicianIds.length > 0) {
        notifyJobTaken(req.io, otherTechnicianIds, booking._id);
      }
    } catch (notifError) {
      console.error("⚠️ Notification error (non-blocking):", notifError.message);
    }

    return res.status(200).json({
      success: true,
      message: "Job accepted successfully",
      result: booking,
    });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({
      success: false,
      message: err.message,
      result: {error: err.message},
    });
  } finally {
    session.endSession();
  }
};

