import mongoose from "mongoose";
import JobBroadcast from "../Schemas/TechnicianBroadcast.js";
import ServiceBooking from "../Schemas/ServiceBooking.js";
import { notifyCustomerJobAccepted, notifyJobTaken } from "../utils/sendNotification.js";

/* ================= GET MY JOBS ================= */
export const getMyJobs = async (req, res) => {
  try {
    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    // Only show jobs that are not assigned (technicianId: null) and are open
    const bookings = await ServiceBooking.find({
      status: { $in: ["requested", "broadcasted"] },
      technicianId: null,
    })
      .populate([
        { path: "serviceId", select: "serviceName" },
        { path: "customerProfileId", select: "firstName lastName mobileNumber" },
        { path: "addressId", select: "name phone addressLine city state pincode latitude longitude" },
      ])
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Jobs fetched successfully",
      result: bookings,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
      result: { error: err.message },
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
    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId) {
      await session.abortTransaction();
      return res.status(401).json({ success: false, message: "Unauthorized", result: {} });
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Invalid booking ID", result: {} });
    }
    if (status !== "accepted") {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Invalid status", result: {} });
    }
    // Atomically assign booking if still open
    const booking = await ServiceBooking.findOneAndUpdate(
      { _id: id, status: { $in: ["requested", "broadcasted"] }, technicianId: null },
      { technicianId: technicianProfileId, status: "accepted", assignedAt: new Date() },
      { new: true, session }
    );
    if (!booking) {
      await session.abortTransaction();
      return res.status(409).json({ success: false, message: "Booking already taken", result: {} });
    }
    await session.commitTransaction();
    return res.status(200).json({ success: true, message: "Job accepted successfully", result: booking });
  } catch (err) {
    await session.abortTransaction();
    return res.status(500).json({ success: false, message: err.message, result: { error: err.message } });
  } finally {
    session.endSession();
  }
};

