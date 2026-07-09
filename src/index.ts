import express, { type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();
const app = reportErrorGracefully(express());
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support larger payloads for base64 images

function reportErrorGracefully(expressApp: any) {
    return expressApp;
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// --- FILE-BASED USER DATABASE CONFIGURATION ---
const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface User {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    createdAt: string;
}

// Helper to hash password
function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Helper to read users
function readUsers(): User[] {
    if (!fs.existsSync(USERS_FILE)) {
        return [];
    }
    try {
        const content = fs.readFileSync(USERS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        return [];
    }
}

// Helper to write users
function writeUsers(users: User[]): void {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// Helper to safely parse JSON from Gemini (removes markdown code block wrapper if present)
function safeParseJSON(text: string): any {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
    }
    return JSON.parse(cleaned);
}

// --- ENDPOINTS ---

// 1. Auth: Register
app.post('/api/auth/register', (req: Request, res: Response) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            res.status(400).json({ error: "Username, email, dan password wajib diisi" });
            return;
        }

        const users = readUsers();

        // Check if user already exists
        const userExists = users.some(u => u.username.toLowerCase() === username.toLowerCase() || u.email.toLowerCase() === email.toLowerCase());
        if (userExists) {
            res.status(400).json({ error: "Username atau Email sudah terdaftar" });
            return;
        }

        const newUser: User = {
            id: crypto.randomUUID(),
            username,
            email,
            passwordHash: hashPassword(password),
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        writeUsers(users);

        res.status(201).json({
            message: "Registrasi berhasil",
            user: {
                id: newUser.id,
                username: newUser.username,
                email: newUser.email
            }
        });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ error: "Internal Server Error saat registrasi" });
    }
});

// 2. Auth: Login
app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            res.status(400).json({ error: "Username dan password wajib diisi" });
            return;
        }

        const users = readUsers();
        const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());

        if (!user) {
            res.status(401).json({ error: "Username atau password salah" });
            return;
        }

        const hash = hashPassword(password);
        if (user.passwordHash !== hash) {
            res.status(401).json({ error: "Username atau password salah" });
            return;
        }

        // Return a mock token for frontend authentication session
        const mockToken = `piknik-token-${user.id}-${Date.now()}`;

        res.json({
            message: "Login berhasil",
            token: mockToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Internal Server Error saat login" });
    }
});

// 3. AI: Embed Text
app.post('/api/embed', async (req: Request, res: Response) => {
    try {
        const { text } = req.body;
        if (!text) {
            res.status(400).json({ error: "Text wajib diisi" });
            return;
        }
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });
        const result = await model.embedContent(text);
        res.json({ embedding: result.embedding.values });
    } catch (error) {
        console.error("Embedding Error:", error);
        res.status(500).json({ error: "Gagal generate embedding" });
    }
});

// 4. AI: Chat (RAG Chatbot Assistant)
app.post('/api/chat', async (req: Request, res: Response) => {
    try {
        const { question, context } = req.body;
        if (!question) {
            res.status(400).json({ error: "Question wajib diisi" });
            return;
        }
        
        const prompt = `Kamu adalah Nikko, AI Travel Assistant interaktif untuk aplikasi Piknik.
Gunakan data tempat wisata berikut sebagai referensi utama untuk menjawab pertanyaan: 

[Data Wisata]
${context || 'Tidak ada data wisata referensi tambahan.'}

[Pertanyaan User]: ${question}

Aturan: Jawablah dengan natural, ramah, dan solutif. Jika informasi tidak ada di Data Wisata, jawablah berdasarkan pengetahuan umum namun tetap sampaikan dengan ramah bahwa tempat tersebut belum terintegrasi lengkap di Piknik.`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        res.json({ response: result.response.text() });
    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ error: "Gagal generate jawaban AI" });
    }
});

// 5. AI: Generate Itinerary (Structured JSON)
app.post('/api/itinerary', async (req: Request, res: Response) => {
    try {
        const { destination, durationDays, preferences } = req.body;

        if (!destination || !durationDays) {
            res.status(400).json({ error: "Destination dan durationDays wajib diisi" });
            return;
        }

        const prompt = `Kamu adalah perencana perjalanan AI profesional untuk Piknik App.
Buatlah itinerary perjalanan lengkap dalam format JSON terstruktur untuk destinasi "${destination}" selama ${durationDays} hari.
Preferensi khusus user: "${preferences || 'Tidak ada preferensi khusus'}".

Harus menghasilkan format JSON murni tanpa markdown formatting apa pun, dengan struktur objek berikut:
{
  "title": "Rencana Perjalanan ke ${destination}",
  "destination": "${destination}",
  "durationDays": ${durationDays},
  "days": [
    {
      "day": 1,
      "activities": [
        {
          "time": "09:00",
          "activity": "Nama Aktivitas / Tempat",
          "description": "Deskripsi aktivitas secara ramah, santai dan informatif"
        }
      ]
    }
  ]
}`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const result = await model.generateContent(prompt);
        const jsonResponse = safeParseJSON(result.response.text());
        res.json(jsonResponse);
    } catch (error) {
        console.error("Itinerary Error:", error);
        res.status(500).json({ error: "Gagal membuat itinerary perjalanan" });
    }
});

// 6. AI: Get Recommendations (Structured JSON)
app.post('/api/recommendations', async (req: Request, res: Response) => {
    try {
        const { destination, preferences } = req.body;

        if (!destination) {
            res.status(400).json({ error: "Destination wajib diisi" });
            return;
        }

        const prompt = `Berikan daftar 5 rekomendasi tempat wisata menarik, tempat kuliner khas, atau aktivitas seru di "${destination}".
Preferensi khusus user: "${preferences || 'Tidak ada preferensi khusus'}".

Harus menghasilkan format JSON murni berupa array of objects dengan struktur berikut:
[
  {
    "name": "Nama Tempat / Kuliner / Aktivitas",
    "category": "Kategori (Alam / Kuliner / Sejarah / Rekreasi / Belanja, dll)",
    "description": "Deskripsi singkat mengenai tempat atau aktivitas tersebut",
    "reason": "Alasan merekomendasikan hal ini kepada pengguna berdasarkan preferensi"
  }
]`;

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const result = await model.generateContent(prompt);
        const jsonResponse = safeParseJSON(result.response.text());
        res.json(jsonResponse);
    } catch (error) {
        console.error("Recommendations Error:", error);
        res.status(500).json({ error: "Gagal mengambil rekomendasi" });
    }
});

// 7. AI: Verify Ticket (Multimodal Vision)
app.post('/api/verify-ticket', async (req: Request, res: Response) => {
    try {
        const { imageBase64, mimeType, touristSpotName } = req.body;

        if (!imageBase64 || !mimeType || !touristSpotName) {
            res.status(400).json({ error: "imageBase64, mimeType, dan touristSpotName wajib diisi" });
            return;
        }

        const prompt = `Analisis gambar tiket atau struk pembayaran yang dilampirkan. Apakah ini tiket masuk atau bukti transaksi yang valid untuk obyek wisata "${touristSpotName}"?
Jawab dalam format JSON murni dengan struktur objek berikut:
{
  "isValid": true atau false,
  "reason": "Penjelasan rinci mengapa tiket ini valid atau tidak valid berdasarkan teks di tiket",
  "extractedInfo": {
    "date": "Tanggal kunjungan/tiket yang tertera (Format DD-MM-YYYY) atau 'Tidak ditemukan'",
    "ticketId": "Nomor seri tiket atau ID transaksi jika ada, atau 'Tidak ditemukan'"
  }
}`;

        const imagePart = {
            inlineData: {
                data: imageBase64,
                mimeType: mimeType
            }
        };

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const result = await model.generateContent([prompt, imagePart]);
        const jsonResponse = safeParseJSON(result.response.text());
        res.json(jsonResponse);
    } catch (error) {
        console.error("Ticket Verification Error:", error);
        res.status(500).json({ error: "Gagal melakukan verifikasi tiket" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API Gateway Piknik menyala di port ${PORT}`));