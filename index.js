import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFile } from 'node:fs/promises';   // or fs.readFileSync if you prefer
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serviceAccount = JSON.parse(
  await readFile(join(__dirname, 'calculatorabnk-firebase.json'), 'utf-8')
);
const admin = initializeApp({
  credential: cert(serviceAccount)
});

const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  },
  path: "/socket.io/",
  // transports: ['websocket'],
  allowEIO3: true // If using older clients
});


const userTokens = new Map();
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
  socket.on('register_token', (data) => {
    const { token, userId } = data;
    userTokens.set(userId || socket.id, token);
    socket.join(userId);
    console.log('Token registered:', token);
  });
  socket.on('join room', (room) => {
    socket.join(room);
    console.log(`a user joined room ${room}`);
  });
  //start admin web
  socket.on('send-message', ({ room, message }) => {

    io.to(room).emit('receive-message', message);
  });
  socket.on('send-message2', ({ room, message }) => {

    io.to(room).emit('receive-message2', message);
  });
  socket.on('send-message3', ({ room, message }) => {

    io.to(room).emit('receive-message3', message);
  });
  socket.on('lock-task', ({ room, message }) => {
    console.log("🚀 ~ message:", message)
    console.log("🚀 ~ room:", room)

    io.to(room).emit('user-lock-task', message);
  });
  //end admin web
  //start android
  socket.on('send_notification', async (data) => {
    try {
      console.log("masuk")
      const { username,
        type,
        amount,
        bankName,
        name, status } = data;
      console.log("🚀 ~ data:", data)

      // Send via Socket.IO to connected users
      io.to(username).emit('notification', {
        title: type,
        message: `${status} ${type} ${amount}`,
        timestamp: Date.now()
      });

      // Also send via FCM for offline users
      const token = userTokens.get(username);
      if (token) {
        // await sendFCMNotification(token, title, body);
      }
    } catch (error) {
      console.log("🚀 ~ error:", error)

    }
  });
  //end android
});



app.post('/api/notify', (req, res) => {
  const { amount,
    bankName,
    name, type } = req.body;


  // Emit to a specific room
  io.to('view').emit('receive-task', {
    type,
    amount,
    bankName,
    name,
  });
  console.log(`[Webhook] Emitted "receive-task" to room "view"`);


  res.json({ success: true, event: "receive-task", room: "view", });
});


app.post('/api/hold', async (req, res) => {
  const { amount, bankName, name, type, username, status } = req.body;

  await handleNotification({
    username,
    type,
    amount,
    bankName,
    name,
    status
  })
  // Emit to a specific room
  io.to(username).emit('onhold-task', {
    username,
  });
  console.log(`[Webhook] Emitted "onhold-task" to room "view"`);


  res.json({ success: true, event: "receive-task", room: "view", });
});

// ============================================
// Notification Handler Function (Shared)
// ============================================
async function handleNotification(data) {
  const { username, type, amount, bankName, name, status } = data;

  console.log('🔔 Processing notification for:', username);
  console.log('📊 Data:', { type, amount, bankName, name, status });

  const notificationTitle = type || 'Notification';
  const notificationBody = `${status || ''} RM${amount || ''}`.trim();

  // ✅ Check if user is currently connected via Socket.IO
  const userRoom = io.sockets.adapter.rooms.get(username);
  const isUserOnline = userRoom && userRoom.size > 0;

  console.log(`👤 User ${username} status: ${isUserOnline ? 'ONLINE' : 'OFFLINE'}`);

  if (isUserOnline) {
    // ✅ User is ONLINE - Send via Socket.IO only
    console.log('📡 Sending via Socket.IO (user is online)');
    io.to(username).emit('notification', {
      title: notificationTitle,
      message: notificationBody,
      type: type,
      amount: amount,
      bankName: bankName,
      name: name,
      status: status,
      timestamp: Date.now()
    });
    console.log(`✅ Socket notification sent to room: ${username}`);
  } else {
    // ✅ User is OFFLINE - Send via FCM only
    console.log('📱 Sending via FCM (user is offline)');
    const token = userTokens.get(username);

    if (token) {
      try {
        await sendFCMNotification(
          token,
          notificationTitle,
          notificationBody,
          {
            type: String(type || ''),
            amount: String(amount || ''),
            bankName: String(bankName || ''),
            name: String(name || ''),
            status: String(status || ''),
            route: '/splash'
          }
        );
        console.log(`✅ FCM notification sent successfully`);
      } catch (error) {
        console.error('❌ FCM send failed:', error.message);
      }
    } else {
      console.log(`⚠️ No FCM token found for user: ${username}`);
      console.log(`⚠️ Available users: ${Array.from(userTokens.keys()).join(', ')}`);
    }
  }
}

// ============================================
// FCM Send Function
// ============================================
async function sendFCMNotification(token, title, body, data = {}) {
  console.log('📤 Sending FCM notification...');
  console.log('├─ Token:', token.substring(0, 30) + '...');
  console.log('├─ Title:', title);
  console.log('├─ Body:', body);
  console.log('└─ Data:', data);

  const message = {
    notification: {
      title: title,
      body: body,
    },
    data: data,
    token: token,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channelId: 'high_importance_channel',
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        }
      }
    }
  };

  try {
    // ✅ Use getMessaging() instead of admin.messaging()
    const response = await getMessaging().send(message);
    console.log('✅ Successfully sent FCM message:', response);
    return response;
  } catch (error) {
    console.error('❌ Error sending FCM message:', error);

    // Log detailed error info
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.message) {
      console.error('Error message:', error.message);
    }

    throw error;
  }
}

app.post('/api/user', async (req, res) => {
  try {
    const { amount, bankName, name, type, username, status } = req.body;

    console.log('📨 [API /api/user] Received:', req.body);

    // Validate required fields
    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'username is required'
      });
    }

    // ✅ Call the shared notification handler
    await handleNotification({
      username,
      type,
      amount,
      bankName,
      name,
      status
    });

    console.log('✅ [API /api/user] Notification processed successfully');

    res.json({
      success: true,
      event: "send_notification",
      username: username,
      message: "User notification sent successfully"
    });

  } catch (error) {
    console.error('❌ [API /api/user] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

httpServer.listen(3002, () => {
  console.log('listening on *:3002');
});
