// server/routes/chatRoutes.js
import express from 'express';
import { handleChat } from '../controllers/chatController.js';

const router = express.Router();

// Listens for POST requests at /api/chat/message
router.post('/message', handleChat);

export default router;