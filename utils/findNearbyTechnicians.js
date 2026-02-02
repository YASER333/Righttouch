import TechnicianProfile from "../Schemas/TechnicianProfile.js";

export const findNearbyTechnicians = async ({
  longitude,
  latitude,
  radiusMeters = 5000,
  limit = 20,
}) => {
  return TechnicianProfile.find({
    "availability.isOnline": true,
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        $maxDistance: radiusMeters,
      },
    },
  })
    .limit(limit)
    .select("_id location");
};
