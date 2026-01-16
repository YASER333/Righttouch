import jwt from "jsonwebtoken";

export const Auth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization header missing",
      });
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Invalid authorization format",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"], // prevents alg attack
    });

    // Attach ONLY what is needed (support both legacy + new token payloads)
    const userId = decoded.userId || decoded.profileId;
    const profileId = decoded.profileId || decoded.userId;

    req.user = {
      userId,
      profileId,
      role: decoded.role,
      email: decoded.email,
    };

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Token invalid or expired",
    });
  }
};


// 🔹 Role-based access middleware
export const authorizeRoles = (...allowedRoles) => {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ success: false, message: "Authorization header missing", result: "Missing authorization header" });
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ success: false, message: "Invalid authorization format", result: "Token must be in Bearer format" });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ["HS256"],
      });

      const isAllowed = allowedRoles
        .map((r) => r.toLowerCase())
        .includes((decoded.role || "").toLowerCase());

      if (!isAllowed) {
        return res.status(403).json({ success: false, message: `Access denied: ${allowedRoles.join(", ")} only`, result: "Insufficient permissions" });
      }

      const userId = decoded.userId || decoded.profileId;
      const profileId = decoded.profileId || decoded.userId;

      req.user = {
        userId,
        profileId,
        role: decoded.role,
        email: decoded.email,
      };
      next();
    } catch (error) {
      return res.status(401).json({ success: false, message: "Token invalid or expired", result: "Authentication failed" });
    }
  };
};
