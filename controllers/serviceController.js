import mongoose from "mongoose";
import Service from "../Schemas/Service.js";
import Category from "../Schemas/Category.js";

const SERVICE_TYPES = ["Repair", "Installation", "Maintenance", "Inspection"];
const PRICING_TYPES = ["fixed", "after_inspection", "per_unit"];
const HIDE_FIELDS = "-duration -siteVisitRequired -serviceWarranty";

const toNumber = value => {
  const num = Number(value);
  return Number.isNaN(num) ? NaN : num;
};

// CREATE SERVICE (NO IMAGE)
export const createService = async (req, res) => {
  try {
    const {
      categoryId,
      serviceName,
      description,
      serviceType,
      pricingType,
      serviceCost,
      commissionPercentage,
      serviceDiscountPercentage,
      whatIncluded,
      whatNotIncluded,
      serviceHighlights,
      cancellationPolicy,
    } = req.body;

    if (!categoryId || !serviceName || !description || serviceCost === undefined) {
      return res.status(400).json({
        success: false,
        message: "Required fields are missing",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ success: false, message: "Invalid categoryId", result: {} });
    }

    const category = await Category.findById(categoryId);
    if (!category || category.categoryType !== "service") {
      return res.status(400).json({ success: false, message: "Category must exist and be of type service", result: {} });
    }

    const normalizedServiceType = serviceType || "Repair";
    if (!SERVICE_TYPES.includes(normalizedServiceType)) {
      return res.status(400).json({ success: false, message: "Invalid serviceType", result: {} });
    }

    const normalizedPricingType = pricingType || "fixed";
    if (!PRICING_TYPES.includes(normalizedPricingType)) {
      return res.status(400).json({ success: false, message: "Invalid pricingType", result: {} });
    }

    const serviceCostNum = toNumber(serviceCost);
    if (Number.isNaN(serviceCostNum) || serviceCostNum < 0) {
      return res.status(400).json({ success: false, message: "serviceCost must be a non-negative number", result: {} });
    }

    if (commissionPercentage !== undefined) {
      const commissionNum = toNumber(commissionPercentage);
      if (Number.isNaN(commissionNum) || commissionNum < 0 || commissionNum > 50) {
        return res.status(400).json({ success: false, message: "commissionPercentage must be between 0 and 50", result: {} });
      }
      req.body.commissionPercentage = commissionNum;
    }

    if (serviceDiscountPercentage !== undefined) {
      const discountNum = toNumber(serviceDiscountPercentage);
      if (Number.isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
        return res.status(400).json({ success: false, message: "serviceDiscountPercentage must be between 0 and 100", result: {} });
      }
      req.body.serviceDiscountPercentage = discountNum;
    }

    const existing = await Service.findOne({
      serviceName: { $regex: `^${serviceName}$`, $options: "i" },
      categoryId,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Service already exists",
        result: {},
      });
    }

    const service = await Service.create({
      categoryId,
      serviceName,
      description,
      serviceType: normalizedServiceType,
      pricingType: normalizedPricingType,
      serviceCost: serviceCostNum,
      commissionPercentage,
      serviceDiscountPercentage,
      whatIncluded,
      whatNotIncluded,
      serviceHighlights,
      cancellationPolicy,
    });

    // Re-fetch with hidden fields and populated category for response
    const responseDoc = await Service.findById(service._id)
      .select(HIDE_FIELDS)
      .populate("categoryId", "category categoryType description");

    return res.status(201).json({
      success: true,
      message: "Service created successfully",
      result: responseDoc,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

// UPLOAD SERVICE IMAGES (ADD)
export const uploadServiceImages = async (req, res) => {
  try {
    const { serviceId } = req.body;

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: "Service ID is required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, message: "Invalid serviceId", result: {} });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Service images are required",
        result: {},
      });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
        result: {},
      });
    }

    const images = req.files.map(file => file.path);
    service.serviceImages.push(...images);
    await service.save();

    // Re-fetch with hidden fields and populated category for response
    const responseDoc = await Service.findById(service._id)
      .select(HIDE_FIELDS)
      .populate("categoryId", "category categoryType description");

    return res.status(200).json({
      success: true,
      message: "Service images uploaded successfully",
      result: responseDoc,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

// REMOVE SERVICE IMAGE
export const removeServiceImage = async (req, res) => {
  try {
    const { serviceId, imageUrl } = req.body;

    if (!serviceId || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Service ID and image URL are required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, message: "Invalid serviceId", result: {} });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
        result: {},
      });
    }

    const imageIndex = service.serviceImages.indexOf(imageUrl);
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Image not found in service",
        result: {},
      });
    }

    service.serviceImages.splice(imageIndex, 1);
    await service.save();

    const responseDoc = await Service.findById(service._id)
      .select(HIDE_FIELDS)
      .populate("categoryId", "category categoryType description");

    return res.status(200).json({
      success: true,
      message: "Service image removed successfully",
      result: responseDoc,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

// REPLACE ALL SERVICE IMAGES
export const replaceServiceImages = async (req, res) => {
  try {
    const { serviceId } = req.body;

    if (!serviceId) {
      return res.status(400).json({
        success: false,
        message: "Service ID is required",
        result: {},
      });
    }

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ success: false, message: "Invalid serviceId", result: {} });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Service images are required",
        result: {},
      });
    }

    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
        result: {},
      });
    }

    const images = req.files.map(file => file.path);
    service.serviceImages = images;
    await service.save();

    const responseDoc = await Service.findById(service._id)
      .select(HIDE_FIELDS)
      .populate("categoryId", "category categoryType description");

    return res.status(200).json({
      success: true,
      message: "Service images replaced successfully",
      result: responseDoc,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};
export const getAllServices = async (req, res) => {
  try {
    const { search, categoryId, page = 1, limit = 20 } = req.query;
    let query = { isActive: true };

    if (categoryId !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid categoryId",
          result: {},
        });
      }
      query.categoryId = categoryId;
    }

    if (search) {
      query.$or = [
        { serviceName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // 🔒 Pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const services = await Service.find(query)
      .select(HIDE_FIELDS)
      .populate("categoryId", "category categoryType description")
      .skip(skip)
      .limit(limitNum)
      .sort({ createdAt: -1 });

    const total = await Service.countDocuments(query);

    return res.status(200).json({
      success: true,
      message: "Services fetched successfully",
      result: {
        services,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

export const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
        result: {},
      });
    }

    const service = await Service.findById(id)
      .select(HIDE_FIELDS)
      .populate(
        "categoryId",
        "category categoryType description"
      );

    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service fetched successfully",
      result: service,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

export const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const update = { ...req.body };

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
        result: {},
      });
    }

    if (update.categoryId) {
      if (!mongoose.Types.ObjectId.isValid(update.categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid categoryId", result: {} });
      }
      const category = await Category.findById(update.categoryId);
      if (!category || category.categoryType !== "service") {
        return res.status(400).json({ success: false, message: "Category must exist and be of type service", result: {} });
      }
    }

    if (update.serviceType) {
      if (!SERVICE_TYPES.includes(update.serviceType)) {
        return res.status(400).json({ success: false, message: "Invalid serviceType", result: {} });
      }
    }

    if (update.pricingType) {
      if (!PRICING_TYPES.includes(update.pricingType)) {
        return res.status(400).json({ success: false, message: "Invalid pricingType", result: {} });
      }
    }

    if (update.serviceCost !== undefined) {
      const costNum = toNumber(update.serviceCost);
      if (Number.isNaN(costNum) || costNum < 0) {
        return res.status(400).json({ success: false, message: "serviceCost must be a non-negative number", result: {} });
      }
      update.serviceCost = costNum;
    }

    if (update.commissionPercentage !== undefined) {
      const commissionNum = toNumber(update.commissionPercentage);
      if (Number.isNaN(commissionNum) || commissionNum < 0 || commissionNum > 50) {
        return res.status(400).json({ success: false, message: "commissionPercentage must be between 0 and 50", result: {} });
      }
      update.commissionPercentage = commissionNum;
    }

    if (update.serviceDiscountPercentage !== undefined) {
      const discountNum = toNumber(update.serviceDiscountPercentage);
      if (Number.isNaN(discountNum) || discountNum < 0 || discountNum > 100) {
        return res.status(400).json({ success: false, message: "serviceDiscountPercentage must be between 0 and 100", result: {} });
      }
      update.serviceDiscountPercentage = discountNum;
    }

    const updated = await Service.findByIdAndUpdate(
      id,
      update,
      { new: true, runValidators: true, context: "query" }
    )
      .select(HIDE_FIELDS)
      .populate("categoryId", "category categoryType description");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service updated successfully",
      result: updated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      result: {error: error.message},
    });
  }
};

export const deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    // 🔒 Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid service ID format",
        result: {},
      });
    }

    const deleted = await Service.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Service not found",
        result: {},
      });
    }

    return res.status(200).json({
      success: true,
      message: "Service deleted successfully",
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
