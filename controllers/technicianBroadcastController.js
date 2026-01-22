import mongoose from "mongoose";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";
import { notifyCustomerJobAccepted, notifyJobTaken } from "../utils/sendNotification.js";

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

    // Check technician profile status
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
    if (!kyc) {
      return res.status(403).json({
        success: false,
        message: "Please submit your KYC documents first",
        result: { kycStatus: "not_submitted" },
      });
    }

    if (kyc.verificationStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your KYC is not approved yet. Current status: " + kyc.verificationStatus,
        result: { kycStatus: kyc.verificationStatus },
      });
    }

    // Check workStatus
    if (technician.workStatus !== "approved") {
      return res.status(403).json({
        success: false,
        message: "Your account is not approved by owner yet. Current status: " + technician.workStatus,
        result: { workStatus: technician.workStatus },
      });
    }

    // 🔒 HARD GATE: Check training completion
    if (!technician.trainingCompleted) {
      return res.status(403).json({
        success: false,
        message:
          "Training must be completed before viewing job broadcasts. Contact admin to complete your training.",
        result: {
          trainingCompleted: false,
          workStatus: technician.workStatus,
        },
      });
    }

    const jobs = await JobBroadcast.find({
      technicianId: technicianProfileId,
      status: "sent",
    })
      .populate({
        path: "bookingId",
        match: { status: "broadcasted" },
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

    // Check technician profile and approval status
    const technician = await TechnicianProfile.findById(technicianProfileId).session(session);
    if (!technician) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Technician profile not found",
        result: {},
      });
    }

    if (!technician.profileComplete) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Please complete your profile first",
        result: { profileComplete: false },
      });
    }

    // Check KYC status
    const TechnicianKyc = mongoose.model('TechnicianKyc');
    const kyc = await TechnicianKyc.findOne({ technicianId: technicianProfileId }).session(session);
    if (!kyc || kyc.verificationStatus !== "approved") {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Your KYC must be approved before accepting jobs. Status: " + (kyc?.verificationStatus || "not_submitted"),
        result: { kycStatus: kyc?.verificationStatus || "not_submitted" },
      });
    }

    // Check workStatus
    if (technician.workStatus !== "approved") {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Your account must be approved by owner before accepting jobs. Status: " + technician.workStatus,
        result: { workStatus: technician.workStatus },
      });
    }

    // 🔒 HARD GATE: Check training completion
    if (!technician.trainingCompleted) {
      await session.abortTransaction();
      return res.status(403).json({
        success: false,
        message: "Training must be completed before accepting job broadcasts. Contact admin to complete your training.",
        result: { 
          trainingCompleted: false,
          workStatus: technician.workStatus 
        },
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
      { _id: job.bookingId, status: "broadcasted", technicianId: null },
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

