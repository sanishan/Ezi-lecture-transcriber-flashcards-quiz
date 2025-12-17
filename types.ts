export interface Flashcard {
  front: string;
  back: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topic: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export interface SummaryData {
  overview: string;
  mainPoints: string[];
  keyTerms: { term: string; definition: string }[];
}

export interface TranscriptChunk {
  timestamp: number;
  text: string;
}

export interface TranscriptSession {
  id: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  duration: number;
  text: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface LectureData {
  id: string;
  title: string;
  date: string; // ISO string (Created date)
  duration: number; // Total seconds
  
  // The full text (concatenated)
  transcriptText: string;
  // Detailed sessions
  sessions: TranscriptSession[];
  
  // Legacy support for chunk-based view (optional, but good to keep)
  chunks: TranscriptChunk[];
  
  // Organization
  tags?: string[];
  
  // AI Generated Content (Optional/Lazy loaded)
  summary?: SummaryData;
  flashcards?: Flashcard[];
  quiz?: QuizQuestion[];
  studyNotes?: string; // Markdown
  mindmap?: string; // Mermaid.js syntax string
  chatHistory?: ChatMessage[];
}

export type ViewMode = 'dashboard' | 'record' | 'detail';
export type DetailTab = 'transcript' | 'summary' | 'flashcards' | 'quiz' | 'notes' | 'mindmap' | 'chat';