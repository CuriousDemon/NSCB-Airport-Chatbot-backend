// server/routes/chatRoutes.js
import express from 'express';
import { handleChat } from '../controllers/chatController.js';
import ChatSession from '../models/ChatSession.js';

const router = express.Router();

router.post('/message', handleChat);

// Explicitly wipe a session from MongoDB Atlas
router.delete('/session/:sessionId', async (req, res) => {
  try {
    await ChatSession.deleteOne({ sessionId: req.params.sessionId });
    res.json({ success: true, message: "Session deleted from MongoDB Atlas." });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete session." });
  }
});

export default router;