import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const modelsToTest = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite"
];

async function run() {
    console.log("Starting model search...");
    for (const modelName of modelsToTest) {
        console.log(`Testing model: ${modelName}...`);
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hello, reply with one word: 'ok'");
            console.log(`-> SUCCESS for ${modelName}: "${result.response.text().trim()}"`);
            return;
        } catch (e: any) {
            console.log(`-> FAILED for ${modelName}: ${e.message}`);
        }
    }
}

run();
