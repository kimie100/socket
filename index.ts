import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';

const app = express();
app.use(cors());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });

  socket.on('join room', (room) => {
    socket.join(room);
    console.log(`a user joined room ${room}`);
  });

  socket.on('send-message', ({ room, message }) => {

    io.to(room).emit('receive-message', message);
  });
  socket.on('send-message2', ({ room, message }) => {

    io.to(room).emit('receive-message2', message);
  });
});

httpServer.listen(3002, () => {
  console.log('listening on *:3002');
});
