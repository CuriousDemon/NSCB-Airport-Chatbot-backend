import { GoogleGenAI } from '@google/genai';
import ChatSession from '../models/ChatSession.js';
import { getFlightStatus, getTravelTime } from '../utils/apiHelpers.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const ACTIVE_MODEL = 'gemini-3.5-flash';

const AIRPORT_SYSTEM_PROMPT = `
You are the official passenger assistant for NSCBI Airport Kolkata.
You have active access to live airport tools:
1. 'getFlightStatus' - to check live status, delays, and gate numbers.
2. 'getTravelTime' - to check live traffic and driving duration to the airport.

When the user asks for flight status or travel time, use the available tools. Do not output raw JSON code blocks to the user. Present final answers politely in clean sentences and bullet points.
Standard timing rules if needed:
- Domestic: Arrive 2 hours prior, check-in closes 60 mins prior, boarding closes 25 mins prior.
- International: Arrive 3 hours prior, check-in closes 75 mins prior, boarding closes 25 mins prior.
`;

const airportTools = [{
  functionDeclarations: [
    {
      name: "getFlightStatus",
      description: "Gets real-time flight status, delay, and gate number using a flight code (e.g., AI123, 6E456).",
      parameters: {
        type: "OBJECT",
        properties: {
          flightNumber: { type: "STRING", description: "The flight IATA code." }
        },
        required: ["flightNumber"]
      }
    },
    {
      name: "getTravelTime",
      description: "Calculates the live driving time in traffic from a starting location in Kolkata to NSCBI Airport.",
      parameters: {
        type: "OBJECT",
        properties: {
          startingLocation: { type: "STRING", description: "The user's starting landmark or neighborhood." }
        },
        required: ["startingLocation"]
      }
    }
  ]
}];

async function generateWithRetry(payload, retries = 2, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(payload);
    } catch (err) {
      const is503 = err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('high demand');
      if (is503 && attempt < retries) {
        console.warn(`[Gemini API] 503 High Demand. Retrying in ${delayMs}ms (Attempt ${attempt}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export const handleChat = async (req, res) => {
  const { message, sessionId = 'default-user' } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ reply: "Please provide a valid question or flight details." });
  }

  try {
    let session = await ChatSession.findOne({ sessionId });
    if (!session) {
      session = new ChatSession({ sessionId, messages: [] });
    }

    const chatHistory = session.messages
      .filter(msg => msg.text && msg.text.trim())
      .map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));

    const fullContext = [
      ...chatHistory,
      { role: 'user', parts: [{ text: message }] }
    ];

    // 1. Initial call
    let chatResponse = await generateWithRetry({
      model: ACTIVE_MODEL,
      contents: fullContext,
      config: {
        systemInstruction: AIRPORT_SYSTEM_PROMPT,
        tools: airportTools
      }
    });

    // 2. Tool execution loop
    let loopCount = 0;
    while (chatResponse.functionCalls && chatResponse.functionCalls.length > 0 && loopCount < 3) {
      loopCount++;

      //  Preserve the original model candidate turn with its thought_signature intact:
      const modelTurn = chatResponse.candidates?.[0]?.content;
      if (!modelTurn) break;
      fullContext.push(modelTurn);

      // Execute all function calls requested in this turn
      const functionResponseParts = [];
      for (const call of chatResponse.functionCalls) {
        let apiResult = null;

        if (call.name === "getFlightStatus") {
          apiResult = await getFlightStatus(call.args);
        } else if (call.name === "getTravelTime") {
          apiResult = await getTravelTime(call.args);
        } else {
          apiResult = { error: `Function ${call.name} not found.` };
        }

        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            response: apiResult ?? { status: "No data available" }
          }
        });
      }

      // Feed function results back to the model
      fullContext.push({
        role: "user",
        parts: functionResponseParts
      });

      // Re-invoke model with updated context
      chatResponse = await generateWithRetry({
        model: ACTIVE_MODEL,
        contents: fullContext,
        config: {
          systemInstruction: AIRPORT_SYSTEM_PROMPT,
          tools: airportTools
        }
      });
    }

    let aiReply = chatResponse.text?.trim();

    if (!aiReply && chatResponse.candidates?.[0]?.content?.parts) {
      aiReply = chatResponse.candidates[0].content.parts
        .map(p => p.text || '')
        .join(' ')
        .trim();
    }

    if (!aiReply) {
      aiReply = "I have fetched the airport details, but could not format the output. Please try asking again.";
    }

    // Persist final plain text to MongoDB Atlas
    session.messages.push({ role: 'user', text: message });
    session.messages.push({ role: 'model', text: aiReply });
    await session.save();

    return res.json({ reply: aiReply });

  } catch (error) {
    console.error("AI Error:", error);

    if (error?.status === 503 || error?.message?.includes('high demand')) {
      return res.status(503).json({
        reply: "The airport AI is currently experiencing heavy passenger query traffic. Please try again in a few moments."
      });
    }

    return res.status(500).json({ 
      reply: "The airport assistance service encountered an error processing your request." 
    });
  }
};