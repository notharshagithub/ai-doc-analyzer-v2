import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pdf from 'pdf-parse';
import { QdrantClient } from '@qdrant/js-client-rest';
import crypto from 'crypto';

dotenv.config();

// ── Config ──────────────────────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
const PORT = parseInt(process.env.PORT || '3000', 10);

if (!OPENROUTER_API_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is not set in .env");
    if (!process.env.VERCEL) process.exit(1);
}

// ── Express Setup ───────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Uploads directory – works both locally and on serverless (Vercel)
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const uploadDir = isServerless ? path.join('/tmp', 'uploads') : path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.pdf' || ext === '.txt') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF and TXT files are allowed'));
        }
    },
});

// ── Qdrant Setup ────────────────────────────────────────────────────────────
const isHttps = QDRANT_URL.startsWith('https://');
const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
    checkCompatibility: false,   // suppress version-check warning
    port: isHttps ? 443 : undefined,
});
const COLLECTION_NAME = 'documents';
const VECTOR_SIZE = 1536; // openai/text-embedding-3-small

// In-memory document registry (survives until server restarts)
interface DocRecord {
    id: string;
    filename: string;
    chunkCount: number;
    sourceType: string;
    uploadedAt: string;
}
let uploadedDocuments: DocRecord[] = [];

async function initQdrant() {
    try {
        const collections = await qdrant.getCollections();
        const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
        if (!exists) {
            await qdrant.createCollection(COLLECTION_NAME, {
                vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
            });
            console.log('✅ Created Qdrant collection.');
        } else {
            console.log('✅ Qdrant collection ready.');
        }

        // Always ensure the payload index exists (safe to call even if it already exists)
        try {
            await qdrant.createPayloadIndex(COLLECTION_NAME, {
                field_name: 'documentId',
                field_schema: 'keyword',
                wait: true,
            });
            console.log('✅ Payload index for documentId ensured.');
        } catch (indexErr: any) {
            const msg = indexErr?.message || '';
            if (!msg.toLowerCase().includes('already exists')) {
                console.warn('⚠️  Could not create payload index:', msg);
            } else {
                console.log('✅ Payload index already exists.');
            }
        }
    } catch (e: any) {
        console.error("❌ Qdrant init error:", e.message);
    }
}
initQdrant();

// ── OpenRouter helpers ──────────────────────────────────────────────────────
async function getEmbedding(text: string): Promise<number[]> {
    const res = await fetch('https://openrouter.ai/api/v1/embeddings', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'openai/text-embedding-3-small', input: text }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Embedding API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    if (!data.data?.[0]?.embedding) throw new Error('Invalid embedding response');
    return data.data[0].embedding;
}

async function chatCompletion(systemPrompt: string, userMessage: string): Promise<string> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'deepseek/deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: 0.2,
            max_tokens: 1024,
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Chat API error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content || 'No response generated.';
}

// ── Text extraction ─────────────────────────────────────────────────────────
async function extractText(filePath: string, mimetype: string): Promise<string> {
    if (mimetype === 'application/pdf') {
        const buffer = fs.readFileSync(filePath);
        const data = await pdf(buffer);
        return data.text;
    }
    return fs.readFileSync(filePath, 'utf8');
}

// ── Chunking with overlap ───────────────────────────────────────────────────
function chunkText(text: string, chunkSize = 200, overlap = 50): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunkSize) {
        const start = Math.max(0, i - overlap);
        chunks.push(words.slice(start, i + chunkSize).join(' '));
    }
    return chunks.filter(c => c.trim().length > 0);
}

// ── API Routes ──────────────────────────────────────────────────────────────

// POST /api/upload — ingest a PDF or TXT file
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
    let filePath: string | null = null;
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file uploaded' });
        filePath = file.path;

        console.log(`📄 Processing file: ${file.originalname}`);

        // 1. Extract text
        const text = await extractText(file.path, file.mimetype);
        if (!text.trim()) {
            return res.status(400).json({ error: 'Could not extract any text from the file' });
        }

        // 2. Chunk
        const chunks = chunkText(text);
        console.log(`   ✓ Extracted ${text.length} chars → ${chunks.length} chunks`);

        // 3. Generate embeddings & store in Qdrant
        const documentId = crypto.randomUUID();
        const points = [];

        for (let i = 0; i < chunks.length; i++) {
            const vector = await getEmbedding(chunks[i]);
            points.push({
                id: crypto.randomUUID(),
                vector,
                payload: {
                    text: chunks[i],
                    filename: file.originalname,
                    documentId,
                    chunkIndex: i,
                },
            });
            // Small delay to respect rate limits
            if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 50));
        }

        await qdrant.upsert(COLLECTION_NAME, { wait: true, points });

        // 4. Register document
        const doc: DocRecord = {
            id: documentId,
            filename: file.originalname,
            chunkCount: points.length,
            sourceType: file.mimetype === 'application/pdf' ? 'pdf' : 'txt',
            uploadedAt: new Date().toISOString(),
        };
        uploadedDocuments.push(doc);

        console.log(`✅ Upload complete: ${points.length} chunks indexed.`);
        res.json({ success: true, message: `Indexed ${points.length} chunks`, document: doc });
    } catch (err: any) {
        console.error('❌ Upload Error:', err);
        res.status(500).json({ error: err.message || 'Error processing document' });
    } finally {
        // Always clean up the temp file
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
        }
    }
});

// POST /api/chat — ask a question against the indexed documents
app.post('/api/chat', async (req: Request, res: Response) => {
    try {
        const { query, documentId } = req.body;
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'Query is required' });
        }

        console.log(`💬 Query: "${query}" | Scope: ${documentId || 'all'}`);

        // 1. Embed user query
        const queryVector = await getEmbedding(query);

        // 2. Search Qdrant – optionally scoped to one document
        const searchParams: any = {
            vector: queryVector,
            limit: 5,
            with_payload: true,
        };
        if (documentId) {
            searchParams.filter = {
                must: [{ key: 'documentId', match: { value: documentId } }],
            };
        }

        const searchResults = await qdrant.search(COLLECTION_NAME, searchParams);

        if (!searchResults.length) {
            return res.json({
                success: true,
                answer: 'No relevant content found in the indexed documents for this query.',
                confidence: 'low',
                sources: [],
            });
        }

        // 3. Build context from retrieved chunks
        const context = searchResults.map((r: any) => r.payload?.text).filter(Boolean).join('\n\n---\n\n');

        // 4. Generate answer via LLM
        const systemPrompt = `You are a document-grounded assistant.
Answer ONLY based on the provided context below.
If the user asks for a summary, overview, or key points, summarize the context directly.
If the context does not contain enough information, respond with: "Not found in the document."
Do NOT use outside knowledge. Be concise, direct, and faithful to the context.

CONTEXT:
${context}`;

        const answer = await chatCompletion(systemPrompt, query);

        // 5. Compute a simple confidence score from Qdrant similarity
        const avgScore = searchResults.reduce((sum: number, r: any) => sum + (r.score || 0), 0) / searchResults.length;
        const confidence = avgScore > 0.75 ? 'high' : avgScore > 0.5 ? 'medium' : 'low';

        // 6. Format sources the way the frontend expects them
        const sources = searchResults.map((r: any) => ({
            filename: r.payload?.filename || 'unknown',
            content: (r.payload?.text || '').substring(0, 200),
            score: r.score || 0,
            pageNumber: r.payload?.pageNumber || null,
        }));

        console.log(`🤖 Reply (${confidence}): "${answer.substring(0, 60)}..."`);
        res.json({ success: true, answer, confidence, sources });
    } catch (err: any) {
        console.error('❌ Chat Error:', err);
        res.status(500).json({ error: err.message || 'Error processing query' });
    }
});

// GET /api/health — quick health check with stats the frontend expects
app.get('/api/health', async (_req: Request, res: Response) => {
    try {
        const totalChunks = await getTotalChunks();
        res.json({
            status: 'ok',
            qdrantConfigured: true,
            modelProvider: 'openrouter',
            activeDocuments: uploadedDocuments.length,
            totalChunks,
        });
    } catch (err: any) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// GET /api/status — detailed status
app.get('/api/status', async (_req: Request, res: Response) => {
    try {
        const totalChunks = await getTotalChunks();
        res.json({
            success: true,
            provider: 'OpenRouter',
            qdrantUrl: QDRANT_URL,
            port: PORT,
            documents: uploadedDocuments.length,
            totalChunks,
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/documents — list all indexed documents
app.get('/api/documents', (_req: Request, res: Response) => {
    res.json({ success: true, documents: uploadedDocuments });
});

// DELETE /api/documents/:documentId — delete a single document's chunks
app.delete('/api/documents/:documentId', async (req: Request, res: Response) => {
    try {
        const { documentId } = req.params;
        await qdrant.delete(COLLECTION_NAME, {
            filter: {
                must: [{ key: 'documentId', match: { value: documentId } }],
            },
        });
        uploadedDocuments = uploadedDocuments.filter(d => d.id !== documentId);
        res.json({ success: true, documentId });
    } catch (err: any) {
        console.error('❌ Delete Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/documents — clear entire collection
app.delete('/api/documents', async (_req: Request, res: Response) => {
    try {
        await qdrant.delete(COLLECTION_NAME, { filter: {} });
        uploadedDocuments = [];
        res.json({ success: true });
    } catch (err: any) {
        console.error('❌ Clear Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Catch-all: serve the frontend
app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Helpers ─────────────────────────────────────────────────────────────────
async function getTotalChunks(): Promise<number> {
    try {
        const info = await qdrant.getCollection(COLLECTION_NAME);
        return (info as any).points_count || 0;
    } catch {
        return 0;
    }
}

// ── Start server (only when running locally, NOT on Vercel) ─────────────────
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`\n🚀 RAG Server running on http://localhost:${PORT}`);
        console.log(`📝 OpenRouter Key: ${OPENROUTER_API_KEY!.substring(0, 12)}...`);
        console.log(`🗄️  Qdrant URL: ${QDRANT_URL}\n`);
    });
}

// Export for Vercel serverless
export default app;
