import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'node:dns/promises';

dotenv.config();

// This network's default resolver refuses MongoDB SRV lookups. Allow the
// resolver list to be configured through .env before Mongoose resolves Atlas.
if (process.env.MONGO_DNS_SERVERS) {
  dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map(server => server.trim()));
}

// Load routes after dotenv so controllers can read environment variables
// during module initialization.
const { default: chatRoutes } = await import('./routes/chatRoutes.js');
const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/chat', chatRoutes);

const PORT = process.env.PORT || 5000;

// Start accepting requests only after MongoDB is reachable. This prevents
// requests from sitting in Mongoose's buffer when the database is offline.
try {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing from the server environment');
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('Connected to MongoDB');

  app.listen(PORT, () => {
    console.log(`AI Chatbot API running on http://localhost:${PORT}`);
  });
} catch (err) {
  console.error('MongoDB connection failed:', {
    message: 'Could not establish a connection to MongoDB',
    code: err.code,
    syscall: err.syscall,
    hostname: err.hostname
  });
  process.exit(1);
}
