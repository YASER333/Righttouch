# 🚀 Broadcast System Setup Guide

## Quick Start

### 1. Install Dependencies
```bash
npm install socket.io
```

### 2. Environment Variables
Add to your `.env` file:
```env
CLIENT_URL=http://localhost:3000
# Or for production:
# CLIENT_URL=https://yourfrontend.com
```

### 3. Start Server
```bash
npm run dev
```

The server will now support:
- ✅ REST API (Express)
- ✅ WebSocket connections (Socket.IO)
- ✅ Real-time job broadcasts

---

## 📱 Frontend Integration

### Install Socket.IO Client
```bash
npm install socket.io-client
```

### Technician App Example
```javascript
import io from "socket.io-client";
import { useEffect } from "react";

function TechnicianDashboard({ technicianId }) {
  useEffect(() => {
    const socket = io("http://localhost:7372");

    // Join technician room
    socket.emit("join_technician", technicianId);

    // Listen for new jobs
    socket.on("new_job_broadcast", (data) => {
      // Show notification
      showNotification("New Job Available", data.serviceName);
      
      // Update job list
      refreshJobList();
    });

    // Listen for job taken
    socket.on("job_taken", (data) => {
      // Remove job from list
      removeJob(data.bookingId);
    });

    return () => socket.disconnect();
  }, [technicianId]);

  return <div>...</div>;
}
```

### Customer App Example
```javascript
function CustomerBooking({ customerProfileId }) {
  useEffect(() => {
    const socket = io("http://localhost:7372");

    // Join customer room
    socket.emit("join_customer", customerProfileId);

    // Listen for job acceptance
    socket.on("job_accepted", (data) => {
      alert("Technician is on the way!");
      showTechnicianDetails(data);
    });

    return () => socket.disconnect();
  }, [customerProfileId]);

  return <div>...</div>;
}
```

---

## 🧪 Testing

### Test Broadcast Flow

#### 1. Create a booking (as Customer)
```bash
curl -X POST http://localhost:7372/api/bookings \
  -H "Authorization: Bearer YOUR_CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "SERVICE_ID",
    "baseAmount": 500,
    "address": "123 Main St",
    "scheduledAt": "2026-01-15T10:00:00Z"
  }'
```

**Expected Console Output:**
```
📱 Push Notification to Technician 65abc...:
🔌 Socket notification sent to Technician 65abc...:
✅ Broadcasted to 3 matching, online technicians
```

#### 2. View jobs (as Technician)
```bash
curl http://localhost:7372/api/technician/jobs \
  -H "Authorization: Bearer YOUR_TECHNICIAN_TOKEN"
```

#### 3. Accept job (as Technician)
```bash
curl -X POST http://localhost:7372/api/technician/jobs/JOB_ID/respond \
  -H "Authorization: Bearer YOUR_TECHNICIAN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "accepted"}'
```

**Expected Console Output:**
```
📱 Notifying Customer 65xyz... - Job Accepted
✅ Notified 2 technicians - Job taken
```

---

## 🔧 Configuration

### Socket.IO Options

In [index.js](index.js#L23-L29):
```javascript
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  // Optional: Connection timeout
  pingTimeout: 60000,
  pingInterval: 25000
});
```

### Push Notification Integration

To enable real push notifications (Firebase FCM):

1. Install Firebase Admin SDK:
```bash
npm install firebase-admin
```

2. Update [sendNotification.js](utils/sendNotification.js):
```javascript
import admin from "firebase-admin";
import serviceAccount from "./firebase-service-account.json";

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

export const sendPushNotification = async (technicianId, payload) => {
  const technician = await TechnicianProfile.findById(technicianId);
  if (!technician.fcmToken) return;

  await admin.messaging().send({
    notification: {
      title: payload.title,
      body: payload.body
    },
    data: payload.data,
    token: technician.fcmToken
  });
};
```

3. Store FCM token in TechnicianProfile:
```javascript
fcmToken: {
  type: String,
  select: false  // Don't send in API responses
}
```

---

## 📊 Monitoring

### Check Active Connections
```javascript
io.engine.clientsCount  // Number of connected clients
```

### Debug Socket Events
In [index.js](index.js#L32-L48):
```javascript
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  
  socket.onAny((event, ...args) => {
    console.log(`📡 Event: ${event}`, args);
  });
});
```

---

## 🐛 Troubleshooting

### Issue: Socket connection fails
**Solution:** Check CORS configuration matches your frontend URL

### Issue: Notifications not received
**Solution:** 
1. Verify client called `join_technician` or `join_customer`
2. Check technician is online (`availability.isOnline = true`)
3. Confirm Socket.IO client version matches server

### Issue: Multiple technicians accept same job
**Solution:** This is prevented by MongoDB transactions. If it happens:
1. Ensure MongoDB replica set is configured
2. Check transaction code in [technicianBroadcastController.js](controllers/technicianBroadcastController.js#L106)

---

## 📚 Documentation

- Full system documentation: [BROADCAST_SYSTEM.md](BROADCAST_SYSTEM.md)
- Socket.IO docs: https://socket.io/docs/v4/
- MongoDB transactions: https://www.mongodb.com/docs/manual/core/transactions/

---

## ✅ Next Steps

1. **Install socket.io:** `npm install socket.io`
2. **Restart server:** `npm run dev`
3. **Test with frontend:** Connect Socket.IO client
4. **Optional:** Integrate Firebase FCM for push notifications
5. **Deploy:** Configure production CLIENT_URL

---

**Status:** ✅ Ready to deploy  
**Last Updated:** January 14, 2026
