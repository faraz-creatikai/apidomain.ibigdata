// utils/aiClientFactory.js
import { GoogleGenAI } from "@google/genai"; 
import OpenAI from "openai";
import Groq from "groq-sdk"; // <-- 1. Import Groq
import prisma from "../config/prismaClient.js";
import { decryptKey } from "../utils/cryptoHelper.js";

// DO NOT remove these! The useFallback function needs them.
import { gemini } from "../config/gemini.js";
import { openai } from "../config/openai.js";
// Optional: import { groq } from "../config/groq.js" if you create a hardcoded file for it

/**
 * Resolves the SDK by finding the SINGLE globally active master system key.
 * Falls back to hardcoded defaults if no custom master key is configured.
 * @param {'GEMINI' | 'OPENAI' | 'GROQ'} defaultProvider - The fallback provider if DB is empty
 * @param {string} defaultModel - The hardcoded model string to fall back to
 * @returns {Promise<{ client: any, model: string, provider: string }>}
 */
export async function getDynamicAIContext(defaultProvider, defaultModel) {
  const useFallback = () => {
    let fallbackClient;
    
    if (defaultProvider === "GEMINI") {
      fallbackClient = gemini;
    } else if (defaultProvider === "GROQ") {
      // Instantiates a fallback Groq client using your .env file
      fallbackClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    } else {
      fallbackClient = openai;
    }

    return {
      client: fallbackClient,
      model: defaultModel,
      provider: defaultProvider, 
    };
  };

  try {
    const configRecord = await prisma.adminAiApiKey.findFirst({
      where: {
        status: "ACTIVE",
        admin: {
          role: "administrator" 
        }
      },
    });

    if (!configRecord) {
      return useFallback();
    }

    const plainTextKey = decryptKey(configRecord.apiKey);
    if (!plainTextKey) {
      console.warn(`Failed to decrypt master key for ${configRecord.provider}. Falling back to default.`);
      return useFallback();
    }

    let clientInstance;
    const activeProvider = configRecord.provider.toUpperCase();

    if (activeProvider === "GEMINI") {
      clientInstance = new GoogleGenAI({ apiKey: plainTextKey || process.env.GEMINI_API_KEY });
    } else if (activeProvider === "OPENAI") {
      clientInstance = new OpenAI({ apiKey: plainTextKey || process.env.OPENAI_API_KEY });
    } else if (activeProvider === "GROQ") { // <-- 2. Instantiate Groq from DB key
      clientInstance = new Groq({ apiKey: plainTextKey || process.env.GROQ_API_KEY });
    } else {
      console.warn(`Unsupported active provider in DB: ${activeProvider}. Falling back to default.`);
      return useFallback();
    }

    return {
      client: clientInstance,
      model: configRecord.model || defaultModel, 
      provider: activeProvider 
    };
    
  } catch (error) {
    console.error(`Error resolving system AI context:`, error.message);
    return useFallback();
  }
}

