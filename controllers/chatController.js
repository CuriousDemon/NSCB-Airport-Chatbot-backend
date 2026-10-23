import { GoogleGenAI } from '@google/genai';
import ChatSession from '../models/ChatSession.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const AIRPORT_SYSTEM_PROMPT = `
You are the official passenger assistant for NSCBI Airport Kolkata. 
If a user asks about timings, calculate exact clock times based on these rules:
- Domestic flights: Arrive 2 hours before departure. Check-in closes 60 mins before. Boarding closes 25 mins before.
- International flights: Arrive 3 hours before departure. Check-in closes 75 mins before. Boarding closes 25 mins before.
Always reply with clean formatting, bullet points, and a polite tone. Do not answer questions unrelated to aviation or the airport.
`;

export const handleChat = async (req, res) => {
  const { message, sessionId = 'default-user' } = req.body;

  try {
    let session = await ChatSession.findOne({ sessionId });
    if (!session) {
      session = new ChatSession({ sessionId, messages: [] });
    }

    const chatHistory = session.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));

    const fullContext = [
      { role: 'user', parts: [{ text: AIRPORT_SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: "Understood. I will strictly follow these rules." }] },
      ...chatHistory,
      { role: 'user', parts: [{ text: message }] }
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: fullContext
    });

    const aiReply = response.text;

    session.messages.push({ role: 'user', text: message });
    session.messages.push({ role: 'model', text: aiReply });
    await session.save();

    return res.json({ reply: aiReply });

  } catch (error) {
    console.error("AI Error:", error);
    return res.status(500).json({ reply: "Sorry, the airport AI is currently offline." });
  }
};

