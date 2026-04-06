# vinq: Multi-Language Video Q&A Platform Design

## Executive Summary

This document outlines the design and implementation plan for **vinq**, a platform enabling Q&A and chat with videos in any language, supporting both text and voice input/output.

---

## Table of Contents

1. [Current Codebase Analysis](#1-current-codebase-analysis)
2. [Requirements Analysis](#2-requirements-analysis)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Implementation Plan](#5-implementation-plan)
6. [Component Design](#6-component-design)
7. [Multi-Language Support Strategy](#7-multi-language-support-strategy)
8. [Voice Input/Output Implementation](#8-voice-inputoutput-implementation)
9. [Data Models & Storage](#9-data-models--storage)
10. [API Design](#10-api-design)
11. [Deployment Strategy](#11-deployment-strategy)
12. [Timeline & Milestones](#12-timeline--milestones)
13. [UI Design & Components](#13-ui-design--components)

---

## 1. Current Codebase Analysis

### 1.1 Architecture Patterns Identified

#### Pattern A: Desktop Application (VideoRAG-main)
```
┌─────────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS (React)                  │
│  Pages (Chat/Settings) → Components → Hooks → Context       │
│                          ↓                                   │
│                    Preload (IPC Bridge)                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (invoke/handle)
┌──────────────────────────┼──────────────────────────────────┐
│                    MAIN PROCESS (Electron)                   │
│  IPC Handlers → File Handlers → VideoRAG Service             │
│                                      ↓                        │
│                           Python Backend (Flask)             │
│  VideoRAG → ImageBind → ASR (DashScope/Whisper) → LLM       │
└─────────────────────────────────────────────────────────────┘
```

**Key Technologies:**
- Frontend: Electron, React, TypeScript, TailwindCSS
- Backend: Flask, multiprocessing, ImageBind, faster-whisper/distil-large-v3
- Storage: JSON files (sessions), NanoVectorDB, NetworkX (knowledge graphs)
- LLM: OpenAI GPT-4o, Qwen-VL (captions)

**Strengths:**
- Most complete implementation
- Multi-language ASR support (zh, en, ja via DashScope)
- Session persistence and management
- Progress tracking via JSON status files

**Weaknesses:**
- Desktop-only (not web-accessible)
- No voice input/output
- Limited to single-user sessions

#### Pattern B: Streamlit Web Apps (youtube-rag-chat-main, RAG-Chat-with-YouTube)
```
Streamlit Frontend → Python Backend (same process) → Vector Store → LLM
```

**Strengths:**
- Rapid development
- Built-in chat UI components
- Persistent storage patterns

**Weaknesses:**
- Not scalable for production
- No real-time features
- Limited customization

#### Pattern C: Production Web App (rag-youtube-assistant-main)
```
Streamlit Pages → Elasticsearch + SQLite → Ollama → Evaluation Framework
```

**Strengths:**
- Docker/docker-compose ready
- RAG evaluation metrics (hit rate, MRR, LLM-as-judge)
- Hybrid search (keyword + vector)
- Query rewriting (CoT, ReAct)

**Weaknesses:**
- No voice features
- No video file support (YouTube only)

### 1.3 Multi-Language & Voice Features

| Feature | Found In | Implementation |
|---------|----------|----------------|
| **Multi-language transcription** | VideoRAG Vimo-desktop | DashScope with `language_hints=['zh', 'en', 'ja']` |
| **Multi-language transcript fetch** | youtube-rag-chatbot-master | Priority order: en, en-IN, en-US, en-UK |
| **Whisper transcription** | Multiple projects | Various models: tiny, base, medium, large-v3 |
| **Faster-Whisper** | VideoRAG-algorithm | distil-whisper-large-v3 |
| **Voice input** | None found | NOT IMPLEMENTED |
| **TTS/Voice output** | you-tube-rag-main | gpt-4o-mini-tts |
| **Translation** | None found | NOT IMPLEMENTED |
| **Language detection** | Implicit | Whisper auto-detect |

### 1.4 Recommended Code Reuse

| Component | Source Project | Reuse Strategy |
|-----------|---------------|----------------|
| Video processing pipeline | VideoRAG-main | **Extend** - add multi-language config |
| ASR module | VideoRAG-main (asr.py) | **Replace** - use faster-whisper with language detection |
| Frontend chat UI | VideoRAG-main (ChatInput.tsx) | **Extend** - add voice input button |
| Session management | VideoRAG-main | **Adapt** - for web (not Electron) |
| RAG evaluation | rag-youtube-assistant-main | **Adopt** - evaluation framework |
| Semantic chunking | youtube-rag-chat-main | **Adopt** - SemanticChunker |
| TTS output | you-tube-rag-main | **Adopt** - gpt-4o-mini-tts pattern |
| Query rewriting | rag-youtube-assistant-main, you-tube-rag-main | **Adopt** - history-aware rewriting |

---

## 2. Requirements Analysis

### 2.1 Core Requirements

| Requirement | Priority | Description |
|-------------|----------|-------------|
| Multi-language video support | P0 | Videos in any language must be processable |
| Text Q&A | P0 | Users can ask questions via text input |
| Voice Q&A | P0 | Users can ask questions via voice input |
| Voice response | P1 | System can respond with voice output |
| Real-time processing | P1 | Fast video indexing and query response |
| Multi-video support | P1 | Multiple videos per session |
| Session persistence | P1 | Chat history and video state preserved |
| Cross-language Q&A | P2 | Ask in one language, answer based on content in another |

### 2.2 User Stories

1. **As a user**, I want to upload a video in Japanese and ask questions in English
2. **As a user**, I want to speak my question and hear the answer
3. **As a user**, I want to switch between multiple videos in one session
4. **As a user**, I want to see which part of the video the answer came from (timestamp)
5. **As a user**, I want my chat history preserved across sessions

### 2.3 Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Video processing time | <5 minutes per hour of video |
| Query response time | <3 seconds (text), <5 seconds (voice) |
| Supported languages | 50+ (via Whisper) |
| Concurrent users | 100+ |
| Video size limit | 10GB per video |

---

## 3. Proposed Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                        Web Application                               │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │ │
│  │  │  React SPA   │  │  Voice SDK   │  │  Video Player│              │ │
│  │  │  (Chat UI)   │  │  (WebRTC)    │  │  (HLS/DASH)  │              │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTPS/WebSocket
┌────────────────────────────────────┼────────────────────────────────────┐
│                              API GATEWAY                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  FastAPI + WebSocket Server                                         │ │
│  │  - Authentication (JWT)                                             │ │
│  │  - Rate limiting                                                    │ │
│  │  - Request routing                                                  │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                           SERVICE LAYER                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │  Video Service  │  │  RAG Service    │  │  Voice Service  │          │
│  │                 │  │                 │  │                 │          │
│  │  - Upload       │  │  - Indexing     │  │  - STT (Whisper)│          │
│  │  - Processing   │  │  - Retrieval    │  │  - TTS          │          │
│  │  - Storage      │  │  - Generation   │  │  - Translation  │          │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘          │
│           │                    │                    │                    │
└───────────┼────────────────────┼────────────────────┼────────────────────┘
            │                    │                    │
┌───────────┼────────────────────┼────────────────────┼────────────────────┐
│           │         DATA & INFRASTRUCTURE LAYER      │                    │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐          │
│  │   PostgreSQL    │  │   Vector DB     │  │   Redis         │          │
│  │   (Metadata)    │  │   (ChromaDB)    │  │   (Cache/Queue) │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │   Object Store  │  │   Message Queue │  │   Task Queue    │          │
│  │   (MinIO/S3)    │  │   (Redis)       │  │   (Celery)      │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
┌────────────────────────────────────┼────────────────────────────────────┐
│                          AI/ML LAYER                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │  ASR Service    │  │  Embedding      │  │  LLM Service    │          │
│  │                 │  │  Service        │  │                 │          │
│  │  - Whisper V3   │  │  - BGE-M3       │  │  - GPT-4o       │          │
│  │  - FunASR       │  │  (Multilingual) │  │  - Claude 3.5   │          │
│  │  - Language Det │  │                 │  │  - Local Llama  │          │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘          │
│                                                                          │
│  ┌─────────────────┐  ┌─────────────────┐                               │
│  │  TTS Service    │  │  Translation    │                               │
│  │                 │  │  Service        │                               │
│  │  - ElevenLabs   │  │                 │                               │
│  │  - OpenAI TTS   │  │  - DeepL        │                               │
│  │  - Coqui        │  │  - Google       │                               │
│  └─────────────────┘  └─────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

#### Video Processing Flow
```
Video Upload → Validation → Object Storage → 
Audio Extraction (FFmpeg) → ASR (Whisper) → Language Detection →
Chunking (Semantic) → Embedding (BGE-M3) → Vector DB Storage →
Frame Extraction → Caption (Qwen-VL) → Knowledge Graph (Optional) →
Index Complete
```

#### Text Q&A Flow
```
Text Query → Language Detection → Query Rewriting (Optional) →
Embedding (BGE-M3) → Vector Search → Hybrid Reranking →
Context Assembly → LLM Generation → Response with Citations
```

#### Voice Q&A Flow
```
Voice Input → WebRTC → Streaming STT (Whisper/FunASR) →
Text Query Flow → LLM Generation → TTS Streaming → Audio Response
```

---

## 4. Technology Stack

### 4.1 Frontend

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Framework | React 18 + TypeScript | Type safety, ecosystem, from VideoRAG-main |
| State Management | Zustand | Simpler than Redux, good for chat state |
| UI Components | TailwindCSS + Radix UI | From VideoRAG-main, accessible |
| Video Player | Video.js / Plyr | HLS support, timestamp navigation |
| Voice Input | Web Audio API + MediaRecorder | Browser-native |
| Voice Output | Web Audio API | Stream TTS audio |
| Real-time | WebSocket (native) | For streaming responses |

### 4.2 Backend

| Component | Technology | Rationale |
|-----------|------------|-----------|
| API Framework | FastAPI | Async, modern, from RAG-Chat-with-YouTube |
| Task Queue | Celery + Redis | Video processing is CPU-intensive |
| Database | PostgreSQL | Reliable, relational data |
| Vector DB | ChromaDB or Milvus | From youtube-rag-chat-main, scalable |
| Cache | Redis | Session state, query cache |
| Object Storage | MinIO (self-hosted) or S3 | Video file storage |

### 4.3 AI/ML

| Component | Technology | Rationale |
|-----------|------------|-----------|
| ASR | faster-whisper (large-v3) | Best multilingual support, 99+ languages |
| Embeddings | BAAI/bge-m3 | Multilingual, 100+ languages |
| LLM | GPT-4o / Claude 3.5 / Ollama | Flexible, supports multilingual |
| TTS | OpenAI TTS / ElevenLabs | High quality, low latency |
| Translation | DeepL API / Google Translate | Cross-language Q&A |
| Caption | Qwen-VL (from VideoRAG) | Frame understanding |

### 4.4 Infrastructure

| Component | Technology |
|-----------|------------|
| Containerization | Docker + docker-compose |
| Orchestration | Kubernetes (production) |
| CI/CD | GitHub Actions |
| Monitoring | Prometheus + Grafana |
| Logging | ELK Stack |

---

## 5. Implementation Plan

### 5.1 Phase 1: Foundation (Weeks 1-4)

**Goal:** Core video processing and text Q&A

| Task | Description | Priority |
|------|-------------|----------|
| Backend scaffold | FastAPI project structure, DB models | P0 |
| Video upload | Multipart upload, validation, storage | P0 |
| Audio extraction | FFmpeg integration | P0 |
| ASR pipeline | faster-whisper integration with language detection | P0 |
| Chunking | Semantic chunking implementation | P0 |
| Embeddings | BGE-M3 integration | P0 |
| Vector DB | ChromaDB setup and indexing | P0 |
| RAG query | Basic retrieval + generation | P0 |
| Frontend scaffold | React + TypeScript project | P0 |
| Chat UI | Message list, input, send button | P0 |
| Video player | Upload, playback, timestamp linking | P0 |

### 5.2 Phase 2: Multi-Language (Weeks 5-6)

**Goal:** Full multilingual support

| Task | Description | Priority |
|------|-------------|----------|
| Language detection | Whisper output + langdetect | P0 |
| Language UI | Display detected language, switch | P0 |
| Multilingual embeddings | BGE-M3 configuration | P0 |
| Cross-lingual retrieval | Query translation or multilingual search | P1 |
| Translation API | DeepL/Google integration | P1 |

### 5.3 Phase 3: Voice (Weeks 7-8)

**Goal:** Voice input and output

| Task | Description | Priority |
|------|-------------|----------|
| Voice input UI | Microphone button, recording indicator | P0 |
| WebRTC recording | Browser audio capture | P0 |
| Streaming STT | Real-time Whisper transcription | P0 |
| Voice activity detection | Detect speech start/end | P1 |
| TTS integration | OpenAI TTS API | P0 |
| Audio streaming | WebSocket audio streaming | P0 |
| Voice output UI | Audio player, playback controls | P0 |

### 5.4 Phase 4: Polish (Weeks 9-10)

**Goal:** Production readiness

| Task | Description | Priority |
|------|-------------|----------|
| Session persistence | Chat history in DB | P0 |
| Multi-video support | Multiple videos per session | P1 |
| Evaluation framework | LLM-as-judge, metrics | P1 |
| Performance optimization | Caching, async processing | P1 |
| Docker setup | docker-compose, Dockerfile | P0 |
| Documentation | API docs, user guide | P1 |

---

## 6. Component Design

### 6.1 Backend Services

#### VideoService
```python
class VideoService:
    """Handles video upload, processing, and storage"""
    
    async def upload_video(self, file: UploadFile, user_id: str) -> Video:
        """Upload and queue video for processing"""
        
    async def process_video(self, video_id: str) -> ProcessingResult:
        """Full processing pipeline: audio -> ASR -> chunks -> embeddings"""
        
    async def get_video_status(self, video_id: str) -> VideoStatus:
        """Get processing status with progress"""
        
    async def delete_video(self, video_id: str) -> bool:
        """Delete video and all associated data"""
```

#### RAGService
```python
class RAGService:
    """Handles RAG operations"""
    
    async def index_video(self, video_id: str, transcript: Transcript) -> None:
        """Index transcript chunks into vector DB"""
        
    async def query(
        self, 
        video_ids: List[str], 
        query: str,
        language: str = None
    ) -> RAGResponse:
        """Query indexed videos and generate response"""
        
    async def get_relevant_chunks(
        self, 
        video_ids: List[str], 
        query: str,
        top_k: int = 5
    ) -> List[Chunk]:
        """Retrieve relevant chunks with timestamps"""
```

#### VoiceService
```python
class VoiceService:
    """Handles voice input/output"""
    
    async def transcribe_stream(self, audio_stream: AsyncIterator[bytes]) -> str:
        """Streaming transcription from audio chunks"""
        
    async def synthesize(self, text: str, language: str) -> AsyncIterator[bytes]:
        """Stream TTS audio output"""
        
    async def detect_language(self, audio_path: str) -> str:
        """Detect spoken language from audio"""
```

### 6.2 Frontend Components

#### ChatInterface
```typescript
interface ChatInterfaceProps {
  sessionId: string;
  videos: Video[];
  onVideoSelect: (videoId: string) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
  sessionId,
  videos,
  onVideoSelect
}) => {
  // Message list, input area, voice button
};
```

#### VoiceInput
```typescript
interface VoiceInputProps {
  onTranscript: (text: string) => void;
  onRecordingStart: () => void;
  onRecordingEnd: () => void;
  language: string;
}

const VoiceInput: React.FC<VoiceInputProps> = ({
  onTranscript,
  language
}) => {
  // Microphone button, recording indicator, live transcript
};
```

#### VideoPlayer
```typescript
interface VideoPlayerProps {
  videoId: string;
  src: string;
  timestamps?: Timestamp[];
  onTimestampClick?: (timestamp: number) => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
  videoId,
  src,
  timestamps,
  onTimestampClick
}) => {
  // Video.js wrapper with timestamp markers
};
```

---

## 7. Multi-Language Support Strategy

### 7.1 Language Detection Pipeline

```
Video Audio → Whisper Transcription → Language Detection Output
                    ↓
            language_hints=['en', 'zh', 'ja', 'es', 'fr', 'de', ...]
                    ↓
            Detected Language Code (ISO 639-1)
                    ↓
            Store with transcript metadata
```

### 7.2 Multilingual Embedding Strategy

**Option A: Multilingual Embeddings (Recommended)**
```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('BAAI/bge-m3')

# Works for any language
embeddings = model.encode([
    "Hello world",  # English
    "你好世界",      # Chinese
    "こんにちは世界" # Japanese
])
```

**Option B: Translation + Monolingual Embeddings**
```python
# Translate query to English
translated_query = translate(query, target_lang='en')

# Embed in English
embedding = embed(translated_query)

# Search
results = vector_db.search(embedding)

# Translate response back
response = translate(llm_response, target_lang=query_language)
```

### 7.3 Cross-Lingual Q&A

For asking questions in a different language than the video:

```
User Query (English) → Detect Language → 
Translate to Video Language (if needed) → 
Search in Video Language → 
Generate Response → 
Translate to User Language (if needed)
```

---

## 8. Voice Input/Output Implementation

### 8.1 Voice Input Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  MediaRecorder API                                   │   │
│  │  - Capture audio stream                              │   │
│  │  - Chunk into 100ms segments                        │   │
│  │  - WebM/Opus format                                  │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ WebSocket                        │
└─────────────────────────┼───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  WebSocket Handler                                   │   │
│  │  - Receive audio chunks                              │   │
│  │  - Buffer and decode                                 │   │
│  │  - Stream to ASR                                     │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  Whisper Streaming ASR                               │   │
│  │  - faster-whisper with VAD                          │   │
│  │  - Real-time partial transcripts                    │   │
│  │  - Final transcript on silence                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 Voice Output Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  LLM Response (text)                                 │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │  TTS Service (OpenAI / ElevenLabs)                   │   │
│  │  - Stream audio chunks (MP3/Opus)                    │   │
│  │  - Support multiple voices/languages                │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │ WebSocket                        │
└─────────────────────────┼───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Audio Player                                        │   │
│  │  - Receive audio chunks                              │   │
│  │  - Play via Web Audio API                           │   │
│  │  - Stream while receiving                           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 Latency Targets

| Stage | Target Latency |
|-------|---------------|
| Voice input → Text | <500ms |
| Text → RAG query | <1s |
| LLM generation (first token) | <300ms |
| TTS first audio chunk | <200ms |
| **Total voice-to-voice** | **<2s** |

---

## 9. Data Models & Storage

### 9.1 Database Schema

```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Videos
CREATE TABLE videos (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    title VARCHAR(500),
    file_path VARCHAR(1000),
    file_size BIGINT,
    duration_seconds FLOAT,
    language VARCHAR(10),
    processing_status VARCHAR(50),
    processing_progress FLOAT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Transcripts
CREATE TABLE transcripts (
    id UUID PRIMARY KEY,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    language VARCHAR(10),
    full_text TEXT,
    word_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Transcript Segments (time-aligned)
CREATE TABLE transcript_segments (
    id UUID PRIMARY KEY,
    transcript_id UUID REFERENCES transcripts(id) ON DELETE CASCADE,
    start_time FLOAT NOT NULL,
    end_time FLOAT NOT NULL,
    text TEXT NOT NULL,
    speaker_id VARCHAR(50),
    INDEX idx_transcript_time (transcript_id, start_time, end_time)
);

-- Chat Sessions
CREATE TABLE chat_sessions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    title VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Chat Messages
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY,
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, -- 'user' or 'assistant'
    content TEXT NOT NULL,
    input_type VARCHAR(20), -- 'text' or 'voice'
    citations JSONB, -- [{video_id, start_time, end_time, text}]
    created_at TIMESTAMP DEFAULT NOW()
);

-- Session Videos (many-to-many)
CREATE TABLE session_videos (
    session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
    video_id UUID REFERENCES videos(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (session_id, video_id)
);
```

### 9.2 Vector Store Schema

```python
# ChromaDB Collection Schema
{
    "name": "video_chunks",
    "metadata": {
        "hnsw:space": "cosine",
        "hnsw:construction_ef": 128,
        "hnsw:M": 16
    }
}

# Document Schema
{
    "id": "chunk_uuid",
    "embedding": [float, ...],  # 1024-dim from BGE-M3
    "metadata": {
        "video_id": "uuid",
        "transcript_id": "uuid",
        "segment_id": "uuid",
        "start_time": float,
        "end_time": float,
        "language": "str",
        "chunk_index": int
    },
    "document": "text content"
}
```

---

## 10. API Design

### 10.1 REST Endpoints

```yaml
# Video Management
POST   /api/videos                    # Upload video
GET    /api/videos/{video_id}         # Get video metadata
GET    /api/videos/{video_id}/status  # Processing status
DELETE /api/videos/{video_id}         # Delete video

# Transcript
GET    /api/videos/{video_id}/transcript      # Get full transcript
GET    /api/videos/{video_id}/transcript/vtt  # VTT format for subtitles

# Sessions
POST   /api/sessions                  # Create session
GET    /api/sessions/{session_id}     # Get session details
PUT    /api/sessions/{session_id}     # Update session (add videos)
DELETE /api/sessions/{session_id}     # Delete session

# Chat
POST   /api/sessions/{session_id}/chat        # Send text message
GET    /api/sessions/{session_id}/messages    # Get chat history

# RAG
POST   /api/query                     # Query videos directly
```

### 10.2 WebSocket Endpoints

```yaml
# Voice Chat
WS /ws/chat/{session_id}
  # Client -> Server: Audio chunks (binary)
  # Server -> Client: Transcription updates (text)
  # Client -> Server: Text messages (JSON)
  # Server -> Client: AI response with TTS audio (binary + JSON)

# Streaming Chat
WS /ws/stream/{session_id}
  # Client -> Server: Text message
  # Server -> Client: Streaming text tokens
  # Server -> Client: Final response with citations
```

### 10.3 API Response Examples

```json
// POST /api/query
{
  "query": "What is the main topic of this video?",
  "videos": ["video_uuid_1", "video_uuid_2"],
  "language": "en",
  "options": {
    "top_k": 5,
    "include_citations": true,
    "voice_response": false
  }
}

// Response
{
  "answer": "The main topic of the video is...",
  "citations": [
    {
      "video_id": "video_uuid_1",
      "video_title": "Introduction to Machine Learning",
      "start_time": 45.2,
      "end_time": 78.5,
      "text": "In this video, we'll explore...",
      "relevance_score": 0.92
    }
  ],
  "detected_language": "en",
  "processing_time_ms": 1234
}
```

---

## 11. Deployment Strategy

### 11.1 Development Environment

```yaml
# docker-compose.dev.yml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
    environment:
      - API_URL=http://backend:8000

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./backend:/app
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/vinq
      - REDIS_URL=redis://redis:6379
      - CHROMA_HOST=chroma
    depends_on:
      - db
      - redis
      - chroma

  worker:
    build: ./backend
    command: celery -A app.worker worker -l info
    volumes:
      - ./backend:/app
    environment:
      - DATABASE_URL=postgresql://postgres:password@db:5432/vinq
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:15
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=vinq
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  chroma:
    image: chromadb/chroma:latest
    ports:
      - "8001:8000"
    volumes:
      - chroma_data:/chroma/data

  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  chroma_data:
  minio_data:
```

### 11.2 Production Environment

- **Kubernetes** for orchestration
- **Horizontal Pod Autoscaler** for backend workers
- **Managed PostgreSQL** (RDS/Cloud SQL)
- **Managed Redis** (ElastiCache/Memorystore)
- **S3-compatible storage** for videos
- **CDN** for video delivery
- **GPU nodes** for ASR/LLM inference

---

## 12. Timeline & Milestones

### 12.1 Milestone Overview

| Milestone | Week | Deliverable |
|-----------|------|-------------|
| M1: MVP Text Q&A | 4 | Video upload, ASR, text chat working |
| M2: Multi-Language | 6 | Full multilingual support |
| M3: Voice I/O | 8 | Voice input and output working |
| M4: Production Ready | 10 | Docker, docs, evaluation |

### 12.2 Detailed Timeline

```
Week 1-2: Backend Foundation
├── Project setup (FastAPI, DB models)
├── Video upload and storage
├── Audio extraction (FFmpeg)
└── Basic API structure

Week 3-4: ASR + RAG
├── Whisper integration
├── Language detection
├── Semantic chunking
├── Embeddings (BGE-M3)
├── Vector DB setup
└── Basic RAG query

Week 5-6: Multi-Language + Frontend
├── React app setup
├── Chat UI components
├── Video player
├── Language detection UI
└── Cross-lingual support

Week 7-8: Voice Features
├── Voice input UI
├── WebSocket handlers
├── Streaming STT
├── TTS integration
└── Voice output UI

Week 9-10: Polish + Deploy
├── Session persistence
├── Multi-video support
├── Docker setup
├── Documentation
└── Testing & QA
```

---

## Appendix A: Configuration Reference

```yaml
# config.yaml
app:
  name: vinq
  version: 1.0.0

database:
  url: postgresql://localhost/vinq
  
vector_db:
  type: chroma
  host: localhost
  port: 8001
  
asr:
  provider: faster-whisper
  model: large-v3
  language_hints: [en, zh, ja, es, fr, de, ko, pt, ru, ar]
  
embedding:
  provider: sentence-transformers
  model: BAAI/bge-m3
  
llm:
  provider: openai
  model: gpt-4o
  
tts:
  provider: openai
  model: tts-1
  voice: alloy
  
translation:
  provider: deepl
  api_key: ${DEEPL_API_KEY}

storage:
  type: s3
  bucket: vinq-videos
  
celery:
  broker: redis://localhost:6379
  backend: redis://localhost:6379
```


## 13. UI Design & Components

### 13.1 UI Design Philosophy

**Principles:**
- **Open-Source First**: All UI components from open-source libraries
- **Modern & Accessible**: Follow WAI-ARIA guidelines, keyboard navigation
- **Dark/Light Theme**: Support both themes with CSS variables
- **Responsive**: Mobile-first design, works on all screen sizes
- **Internationalized**: RTL support, 50+ language UI

### 13.2 UI Technology Stack (Open-Source)

| Layer | Technology | Why Open-Source |
|-------|------------|-----------------|
| **Framework** | Next.js 14+ (App Router) | MIT license, React-based |
| **UI Library** | shadcn/ui | Copy-paste ownership, not a dependency |
| **Styling** | Tailwind CSS | MIT license, utility-first |
| **Base Components** | Radix UI Primitives | MIT license, accessible |
| **Icons** | Lucide React | ISC license, tree-shakeable |
| **Animation** | Framer Motion | MIT license, smooth animations |
| **Video Player** | Vidstack | MIT license, modern, accessible |
| **State** | Zustand | MIT license, simple |
| **i18n** | next-intl | MIT license, RTL support |
| **Chat Components** | assistant-ui | MIT license, AI-optimized |

### 13.3 Main Layout Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HEADER: vinq Logo │ Language Selector │ Theme Toggle │ User Avatar    │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  SIDEBAR   │                    MAIN CONTENT                               │
│            │                                                                │
│ ┌────────┐ │  ┌─────────────────────────────────────────────────────────┐  │
│ │Videos  │ │  │                                                         │  │
│ │ Library │ │  │                    VIDEO PLAYER                       │  │
│ │        │ │  │                    (with transcript)                   │  │
│ │ ▸ Vid1 │ │  │                                                         │  │
│ │ ▸ Vid2 │ │  └─────────────────────────────────────────────────────────┘  │
│ │ ▸ Vid3 │ │                                                                │
│ │        │ │  ┌─────────────────────────────────────────────────────────┐  │
│ │Upload  │ │  │                     CHAT AREA                           │  │
│ │ Video  │ │  │                                                         │  │
│ └────────┘ │  │  🤖 AI: The main topic of this video is about...       │  │
│            │  │     📹 [0:45] [1:23] [2:10]                             │  │
│ ┌────────┐ │  │                                                         │  │
│ │Settings│ │  │  👤 You: Can you explain more about that?              │  │
│ └────────┘ │  │                                                         │  │
│            │  │  🤖 AI: Certainly! Let me show you...                   │  │
│            │  │                                                         │  │
│            │  └─────────────────────────────────────────────────────────┘  │
│            │                                                                │
│            │  ┌─────────────────────────────────────────────────────────┐  │
│            │  │ 🎤 Voice │ Ask a question about your videos...    [Send]│  │
│            │  └─────────────────────────────────────────────────────────┘  │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### 13.4 Component Samples

#### A. Chat Interface (shadcn/ui + Tailwind)

```tsx
// components/chat/ChatInterface.tsx
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Send, Mic, Square, Video } from 'lucide-react'

// Features: Message list, voice input button, citation timestamps
// Uses gradient bubbles (blue->purple) from VideoRAG pattern
```

#### B. Video Player with Transcript Sync

```tsx
// components/video/VideoPlayer.tsx
import { ScrollArea } from '@/components/ui/scroll-area'

// Features: Video element with controls, transcript panel with click-to-seek
// Highlights current transcript segment based on playback time
```

#### C. Welcome Screen

```tsx
// components/welcome/WelcomeScreen.tsx
import { Video, Upload, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// Features: Centered upload card, feature highlights, gradient title
```

#### D. Voice Input Component

```tsx
// components/voice/VoiceInput.tsx
import { Button } from '@/components/ui/button'
import { Mic, Square, Loader2 } from 'lucide-react'

// Features: MediaRecorder API, recording indicator, processing state
```


###  Quick Start Commands

```bash
# Create Next.js app
npx create-next-app@latest vinq --typescript --tailwind --eslint --app

# Initialize shadcn/ui
npx shadcn@latest init

# Add essential components
npx shadcn@latest add button input textarea scroll-area avatar dialog sheet tabs card

# Install additional dependencies
npm install vidstack lucide-react zustand framer-motion next-intl
```

---
