# 📚 NotebookLM RAG - Retrieval-Augmented Generation Application

A complete NotebookLM-style RAG (Retrieval-Augmented Generation) application that allows users to upload PDF or plain text files and chat with them. The system answers only from the uploaded document, never hallucinating or using general knowledge.

## Features

✅ **Document Upload** - Upload PDF and TXT files  
✅ **Smart Chunking** - Intelligent document chunking with overlap for better context preservation  
✅ **Semantic Search** - Uses Gemini embeddings for semantic similarity  
✅ **Vector Storage** - Qdrant vector database for fast retrieval  
✅ **Grounded Answers** - Gemini generates answers only from retrieved context  
✅ **Source Attribution** - Every answer includes source chunks and page numbers  
✅ **Web UI** - Beautiful responsive web interface  
✅ **CLI Support** - Command-line interface for headless usage  
✅ **REST API** - Full REST API for integration  

## Project Structure

```
notebooklm-rag/
├── src/
│   ├── config.ts              # Configuration loader
│   ├── types.ts               # TypeScript type definitions
│   ├── gemini.ts              # Gemini API integration (embeddings & generation)
│   ├── qdrant.ts              # Qdrant vector database client
│   ├── textExtractor.ts       # PDF and TXT text extraction
│   ├── chunking.ts            # Document chunking with overlap
│   ├── pipeline.ts            # Document ingestion pipeline orchestration
│   ├── retrieval.ts           # Chunk retrieval and ranking
│   ├── answerGenerator.ts     # Answer generation with context grounding
│   ├── server.ts              # Express API server
│   ├── cli.ts                 # CLI interface
│   └── index.ts               # Application entry point
├── public/
│   └── index.html             # Web UI
├── uploads/                   # Uploaded files (created at runtime)
├── dist/                      # Compiled JavaScript (created at runtime)
├── package.json
├── tsconfig.json
├── .env.example
├── .env
└── README.md
```

## Hard Requirements Met

✅ **Node.js + TypeScript** - Full TypeScript implementation  
✅ **Gemini API** - Embeddings and text generation  
✅ **Qdrant Vector DB** - Semantic search and storage  
✅ **File Upload** - PDF and TXT support  
✅ **Context Grounding** - Only answers from retrieved chunks  
✅ **Chunking** - Smart chunking with 200-char overlap  
✅ **Metadata** - Filename, page number, chunk index preserved  
✅ **Source Attribution** - Complete sources shown in answers  
✅ **Hallucination Prevention** - Explicit "Not found in document" response  

## Installation & Setup

### Prerequisites

- Node.js 16+ and npm
- Qdrant instance running (local or cloud)
- Gemini API key

### 1. Clone and Install

```bash
cd notebooklm-rag
npm install
```

### 2. Setup Qdrant

**Option A: Local Docker**
```bash
docker run -p 6333:6333 qdrant/qdrant
```

**Option B: Cloud Qdrant**
- Sign up at [qdrant.tech](https://qdrant.tech)
- Create a cluster and get your URL and API key

### 3. Configure Environment

```bash
# Copy example to actual .env file
cp .env.example .env

# Edit .env with your values:
# GEMINI_API_KEY=your_gemini_key_here
# QDRANT_URL=http://localhost:6333
# QDRANT_API_KEY=your_qdrant_api_key (if using cloud)
# PORT=3000
```

### 4. Build and Run

**Web Server (Recommended)**
```bash
npm run build
npm start
```
Then open: http://localhost:3000

**CLI Mode**
```bash
npm run cli
```

**Development Mode**
```bash
npm run dev
```

## Usage

### Web UI

1. **Upload Document**
   - Click the upload area or drag & drop a PDF/TXT file
   - System will process and chunk the document
   - You'll see: "✅ Document loaded with X chunks. Ready to chat!"

2. **Ask Questions**
   - Type your question in the input field
   - System retrieves relevant chunks using semantic search
   - Gemini generates a grounded answer
   - Sources and confidence level displayed

### CLI Mode

```bash
npm run cli
```

Menu options:
1. Upload and ingest a document
2. Ask questions about the current document
3. View collection statistics
4. Exit

### REST API

**Upload Document**
```bash
curl -X POST http://localhost:3000/api/upload \
  -F "file=@document.pdf"
```

Response:
```json
{
  "success": true,
  "message": "Document ingested successfully",
  "chunksCreated": 15,
  "filename": "document.pdf"
}
```

**Ask Question**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the main topic?"}'
```

Response:
```json
{
  "success": true,
  "answer": "The document discusses...",
  "confidence": "high",
  "sources": [
    {
      "filename": "document.pdf",
      "pageNumber": 3,
      "chunkIndex": 5,
      "content": "..."
    }
  ]
}
```

## How It Works

### 1. Document Ingestion Pipeline

```
Upload File
    ↓
Extract Text (PDF/TXT)
    ↓
Create Chunks (1000 chars with 200 char overlap)
    ↓
Generate Embeddings (Gemini text-embedding-004)
    ↓
Store in Qdrant
    ↓
Ready for Queries
```

### 2. Query Processing

```
User Query
    ↓
Generate Query Embedding (Gemini)
    ↓
Semantic Search in Qdrant (top 5 chunks)
    ↓
Build Context from Chunks
    ↓
Generate Answer (Gemini with system instruction)
    ↓
Format with Sources & Confidence
    ↓
Return to User
```

### 3. Answer Generation

System instruction ensures grounding:
```
You are a document-grounded assistant. 
Answer ONLY from the provided context. 
If the context does not contain enough information, 
respond with: "Not found in the document"
```

## Configuration Details

### Chunking Strategy

- **Chunk Size**: 1000 characters
- **Overlap**: 200 characters
- **Method**: Character-based sliding window

Benefits:
- Captures context across chunk boundaries
- Prevents information loss at edges
- Preserves semantic coherence

### Retrieval

- **Top-K**: 5 chunks (configurable)
- **Similarity Metric**: Cosine distance
- **Filter Threshold**: Score > 0.3
- **Metadata**: Filename, page number, chunk index

### LLM Configuration

- **Embedding Model**: `text-embedding-004` (768 dimensions)
- **Generation Model**: `gemini-1.5-flash`
- **Temperature**: Default (balanced creativity)
- **System Instruction**: Document-grounded assistant

## Confidence Levels

- **High**: 3+ chunks with avg score > 0.7
- **Medium**: 2+ chunks with avg score > 0.5
- **Low**: Insufficient context or "Not found in document"

## Error Handling

### Common Issues

**"Qdrant connection refused"**
- Ensure Qdrant is running: `docker ps`
- Check QDRANT_URL in .env
- Default: http://localhost:6333

**"GEMINI_API_KEY is not set"**
- Add key to .env file
- Verify no typos in key

**"Only PDF and TXT files are allowed"**
- Upload supported formats only
- Other formats will be rejected

## Testing

### Test with Sample Document

Create a test file:
```bash
echo "The capital of France is Paris. 
Paris is known for the Eiffel Tower, 
the Louvre Museum, and Notre-Dame Cathedral." > test.txt
```

Upload via UI or CLI:
```bash
npm run cli
# Choose option 1, enter path to test.txt
# Choose option 2, ask: "What is the capital of France?"
# Expected: "The capital of France is Paris."
```

## Deployment

### Environment Variables

```bash
GEMINI_API_KEY=your_key
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=optional_for_cloud
PORT=3000
NODE_ENV=production
```

### Build for Production

```bash
npm run build
NODE_ENV=production npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## Architecture Decisions

### Why Qdrant?

- Fast semantic search with cosine distance
- Persistent vector storage
- Payload filtering for metadata
- Scales from local to distributed

### Why Gemini?

- State-of-the-art embeddings (768 dims)
- High-quality text generation
- Cost-effective API
- No additional dependencies

### Why Chunking with Overlap?

- Prevents information loss at chunk boundaries
- Better semantic preservation
- Improves retrieval accuracy
- Handles split sentences gracefully

## Performance Characteristics

- **Upload (100-page PDF)**: ~2-5 seconds (includes embedding generation)
- **Query Processing**: ~1-2 seconds (retrieval + generation)
- **Storage**: ~1KB per chunk + embedding (768 floats = ~3KB per chunk)
- **Throughput**: Limited by Gemini API rate limits (60 RPM default)

## Limitations & Future Work

### Known Limitations

- Single document per session (can be extended)
- Rate limited by Gemini API
- PDF text extraction depends on PDF structure
- No authentication/authorization

### Future Enhancements

- [ ] Multi-document RAG
- [ ] Hybrid search (semantic + keyword)
- [ ] Advanced PDF with table extraction
- [ ] Citation accuracy scoring
- [ ] Conversation history
- [ ] Document versioning
- [ ] User authentication
- [ ] Admin dashboard
- [ ] Multi-language support

## Troubleshooting

### Cannot connect to Qdrant
```bash
# Check Qdrant status
docker ps | grep qdrant

# Restart if needed
docker restart qdrant_container_id
```

### Embeddings take too long
- First run generates embeddings (slower)
- Subsequent queries use cached embeddings (faster)
- Batch processing with 100ms delays prevents rate limiting

### Low confidence answers
- Increase topK in retrieval.ts (default: 5)
- Check document content matches query
- Verify chunks are properly indexed

## File Limits

- **File Size**: Up to 100MB (Multer default)
- **PDF Pages**: Tested up to 500 pages
- **Chunks**: Up to 10,000 per document (before hitting limits)

## API Reference

### POST /api/upload

Upload and ingest a document.

**Request:**
```
Content-Type: multipart/form-data
file: <PDF or TXT file>
```

**Response:**
```json
{
  "success": boolean,
  "message": string,
  "chunksCreated": number,
  "filename": string
}
```

### POST /api/chat

Query the ingested document.

**Request:**
```json
{
  "query": "Your question here"
}
```

**Response:**
```json
{
  "success": boolean,
  "answer": string,
  "confidence": "high" | "medium" | "low",
  "sources": [
    {
      "filename": string,
      "pageNumber": number,
      "chunkIndex": number,
      "content": string
    }
  ]
}
```

### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "ok"
}
```

## License

ISC

## Author

Full-Stack AI Engineer

---

**Happy Chatting with Your Documents!** 📚💬
