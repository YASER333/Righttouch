import mongoose from "mongoose";
import TechnicianProfile from "../Schemas/TechnicianProfile.js";

const isValidObjectId = mongoose.Types.ObjectId.isValid;
const TECHNICIAN_STATUSES = ["pending", "trained", "approved", "suspended"];

const validateSkills = (skills) => {
  if (skills === undefined) return true;
  if (!Array.isArray(skills)) return false;
  return skills.every((item) =>
    item && item.serviceId && isValidObjectId(item.serviceId)
  );
};

/* ================= UPDATE TECHNICIAN SKILLS ================= */
export const createTechnician = async (req, res) => {
  try {
    const technicianProfileId = req.user?.profileId;
    const { skills } = req.body;

    if (!technicianProfileId || !isValidObjectId(technicianProfileId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    if (!validateSkills(skills)) {
      return res.status(400).json({
        success: false,
        message: "Invalid skills format",
        result: {},
      });
    }

    // Ensure only users with Technician role can update skills
    if (req.user?.role !== "Technician") {
      return res.status(403).json({
        success: false,
        message: "Only users with Technician role can update skills",
        result: {},
      });
    }

    const technician = await TechnicianProfile.findByIdAndUpdate(
      technicianProfileId,
      { skills },
      { new: true, runValidators: true }
    ).select("-password");

    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician profile not found",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Skills updated successfully",
      result: technician,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

/* ================= GET ALL TECHNICIANS ================= */
export const getAllTechnicians = async (req, res) => {
  try {
    const { workStatus, search } = req.query;
    const query = {};

    if (workStatus) {
      if (!TECHNICIAN_STATUSES.includes(workStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid workStatus filter",
          result: {},
        });
      }
      query.workStatus = workStatus;
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { workStatus: { $regex: search, $options: "i" } },
      ];
    }

    const technicians = await TechnicianProfile.find(query)
      .populate("skills.serviceId", "serviceName")
      .select("-password");

    return res.status(200).json({
      success: true,
      message: "Technicians fetched successfully",
      result: technicians,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

/* ================= GET TECHNICIAN BY ID ================= */
export const getTechnicianById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Technician ID",
        result: {},
      });
    }

    const technician = await TechnicianProfile.findById(id)
      .populate("skills.serviceId", "serviceName")
      .select("-password");

    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Technician fetched successfully",
      result: technician,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

/* ================= GET MY TECHNICIAN (FROM TOKEN) ================= */
export const getMyTechnician = async (req, res) => {
  try {
    const technicianProfileId = req.user?.profileId;

    if (!technicianProfileId || !isValidObjectId(technicianProfileId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
        result: {},
      });
    }

    const technician = await TechnicianProfile.findById(technicianProfileId)
      .populate("skills.serviceId", "serviceName")
      .select("-password");

    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician profile not found",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Technician fetched successfully",
      result: technician,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: { error: error.message },
    });
  }
};

/* ================= UPDATE TECHNICIAN ================= */
export const updateTechnician = async (req, res) => {
  try {
    const { id } = req.params;
    const { skills, availability } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Technician ID",
        result: {},
      });
    }

    if (!validateSkills(skills)) {
      return res.status(400).json({
        success: false,
        message: "Invalid skills format",
        result: {},
      });
    }

    const technician = await TechnicianProfile.findById(id);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
        result: {},
      });
    }

    const technicianProfileId = req.user?.profileId;
    if (!technicianProfileId || technician._id.toString() !== technicianProfileId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    if (skills !== undefined) {
      technician.skills = skills;
    }

    if (availability?.isOnline !== undefined) {
      // Check if technician is approved before allowing online status
      if (technician.workStatus !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Only approved technicians can go online. Current status: " + technician.workStatus,
          result: { currentStatus: technician.workStatus },
        });
      }

      // Check if KYC is approved
      const kyc = await mongoose.model('TechnicianKyc').findOne({ technicianId: id });
      if (!kyc || kyc.verificationStatus !== "approved") {
        return res.status(403).json({
          success: false,
          message: "Your KYC must be approved by owner before going online",
          result: { kycStatus: kyc?.verificationStatus || "not_submitted" },
        });
      }

      technician.availability.isOnline = Boolean(availability.isOnline);
    }

    await technician.save();

    const result = technician.toObject();
    delete result.password;

    return res.status(200).json({
      success: true,
      message: "Technician updated successfully",
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

/* ================= UPDATE TECHNICIAN STATUS (ADMIN) ================= */
export const updateTechnicianStatus = async (req, res) => {
  try {
    const { technicianId, trainingCompleted, workStatus } = req.body;

    if (!isValidObjectId(technicianId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Technician ID",
        result: {},
      });
    }

    if (req.user?.role !== "Owner") {
      return res.status(403).json({
        success: false,
        message: "Owner access only",
      });
    }

    const technician = await TechnicianProfile.findById(technicianId);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
        result: {},
      });
    }

    if (trainingCompleted !== undefined) {
      technician.trainingCompleted = Boolean(trainingCompleted);
      if (trainingCompleted === true) {
        technician.workStatus = "trained";
      }
    }

    if (workStatus !== undefined) {
      if (!TECHNICIAN_STATUSES.includes(workStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid workStatus value. Must be: pending, trained, approved, or suspended",
          result: {},
        });
      }

      technician.workStatus = workStatus;

      if (workStatus === "suspended") {
        technician.availability.isOnline = false;
      }
    }

    await technician.save();

    const result = technician.toObject();
    delete result.password;

    return res.status(200).json({
      success: true,
      message: "Technician status updated successfully",
      result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

/* ================= DELETE TECHNICIAN ================= */
export const deleteTechnician = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Technician ID",
        result: {},
      });
    }

    const technician = await TechnicianProfile.findById(id);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
        result: {},
      });
    }

    const technicianProfileId = req.user?.profileId;
    const isOwner = req.user?.role === "Owner";
    if (!isOwner && (!technicianProfileId || technician._id.toString() !== technicianProfileId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    await technician.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Technician deleted successfully",
      result: {},
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};
