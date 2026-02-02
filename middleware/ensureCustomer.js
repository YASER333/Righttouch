const mongoose = require('mongoose');

const ensureCustomer = (req, res, next) => {
  if (!req.user || req.user.role !== "Customer") {
    return res.status(403).json({ success: false, message: "Customer access only" });
  }
  if (!req.user.userId || !mongoose.Types.ObjectId.isValid(req.user.userId)) {
    return res.status(401).json({ success: false, message: "Invalid token user" });
  }
  next();
};

module.exports = ensureCustomer;
