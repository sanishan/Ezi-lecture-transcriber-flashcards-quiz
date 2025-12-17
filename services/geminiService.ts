import { GoogleGenAI, Type, Chat, Content } from "@google/genai";
import { Flashcard, QuizQuestion, SummaryData, ChatMessage } from '../types';

const getAiClient = () => {
    if (!process.env.API_KEY) {
        throw new Error("API Key is missing");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

// Use the Flash model for everything to ensure speed and stay within free tier quotas
const MODEL_FAST = 'gemini-2.5-flash';
const MODEL_COMPLEX = 'gemini-2.5-flash'; // Changed from gemini-3-pro-preview to avoid 429 errors

export const generateSummary = async (transcript: string): Promise<SummaryData> => {
    const ai = getAiClient();
    
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Create a comprehensive structured summary of the following lecture transcript.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`, // Limit context window safely
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    overview: { type: Type.STRING, description: "2-3 sentence overview" },
                    mainPoints: { 
                        type: Type.ARRAY, 
                        items: { type: Type.STRING },
                        description: "5-7 main bullet points"
                    },
                    keyTerms: {
                        type: Type.ARRAY, 
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                term: { type: Type.STRING },
                                definition: { type: Type.STRING }
                            }
                        }
                    }
                }
            }
        }
    });

    if (response.text) {
        return JSON.parse(response.text) as SummaryData;
    }
    throw new Error("Failed to generate summary");
};

export const expandSummary = async (transcript: string, currentSummary: SummaryData): Promise<SummaryData> => {
    const ai = getAiClient();
    
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `I have a summary of a lecture but I need to expand it with more details.
        
        CURRENT MAIN POINTS:
        ${currentSummary.mainPoints.join('\n')}
        
        CURRENT KEY TERMS:
        ${currentSummary.keyTerms.map(k => k.term).join(', ')}
        
        TASK:
        1. Identify 3-5 NEW main points or details from the transcript that are missing above.
        2. Identify 4-6 NEW key terms/definitions from the transcript that are missing above.
        3. Do NOT change the overview.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    newMainPoints: { 
                        type: Type.ARRAY, 
                        items: { type: Type.STRING },
                        description: "Additional bullet points"
                    },
                    newKeyTerms: {
                        type: Type.ARRAY, 
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                term: { type: Type.STRING },
                                definition: { type: Type.STRING }
                            }
                        }
                    }
                }
            }
        }
    });

    if (response.text) {
        const data = JSON.parse(response.text);
        return {
            overview: currentSummary.overview,
            mainPoints: [...currentSummary.mainPoints, ...(data.newMainPoints || [])],
            keyTerms: [...currentSummary.keyTerms, ...(data.newKeyTerms || [])]
        };
    }
    throw new Error("Failed to expand summary");
};

export const generateFlashcards = async (transcript: string): Promise<Flashcard[]> => {
    const ai = getAiClient();
    
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Generate 8-12 study flashcards from this lecture transcript.
        
        Instructions:
        1. The 'front' should be a clear Question or a Key Term to define.
        2. The 'back' should be the Answer or Definition.
        3. Ensure content is concise and suitable for rapid review.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        front: { type: Type.STRING, description: "The question or term on the front of the card" },
                        back: { type: Type.STRING, description: "The answer or definition on the back of the card" },
                        difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
                        topic: { type: Type.STRING }
                    }
                }
            }
        }
    });

    if (response.text) {
        return JSON.parse(response.text) as Flashcard[];
    }
    throw new Error("Failed to generate flashcards");
};

export const generateMoreFlashcards = async (transcript: string, existingCards: Flashcard[]): Promise<Flashcard[]> => {
    const ai = getAiClient();
    const existingFronts = existingCards.map(c => c.front).join("; ");
    
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Generate 5-8 NEW and DISTINCT study flashcards from this lecture transcript.
        Do NOT repeat the following concepts which are already covered: ${existingFronts.slice(0, 1000)}...
        
        Instructions:
        1. The 'front' should be a clear Question or a Key Term to define.
        2. The 'back' should be the Answer or Definition.
        3. Ensure content is concise.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        front: { type: Type.STRING },
                        back: { type: Type.STRING },
                        difficulty: { type: Type.STRING, enum: ["Easy", "Medium", "Hard"] },
                        topic: { type: Type.STRING }
                    }
                }
            }
        }
    });

    if (response.text) {
        return JSON.parse(response.text) as Flashcard[];
    }
    throw new Error("Failed to generate more flashcards");
};

export const generateQuiz = async (transcript: string): Promise<QuizQuestion[]> => {
    const ai = getAiClient();
    
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Create a 5-question multiple choice quiz based on this transcript.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        question: { type: Type.STRING },
                        options: { 
                            type: Type.ARRAY, 
                            items: { type: Type.STRING },
                            description: "4 possible answers"
                        },
                        correctAnswer: { type: Type.STRING, description: "Must match one of the options exactly" },
                        explanation: { type: Type.STRING }
                    }
                }
            }
        }
    });

    if (response.text) {
        return JSON.parse(response.text) as QuizQuestion[];
    }
    throw new Error("Failed to generate quiz");
};

export const generateMoreQuiz = async (transcript: string, existingQuestions: QuizQuestion[]): Promise<QuizQuestion[]> => {
    const ai = getAiClient();
    const existingQs = existingQuestions.map(q => q.question).join("; ");

    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Create 5 NEW multiple choice questions based on this transcript.
        Avoid these topics/questions: ${existingQs.slice(0, 1000)}...
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        question: { type: Type.STRING },
                        options: { 
                            type: Type.ARRAY, 
                            items: { type: Type.STRING },
                            description: "4 possible answers"
                        },
                        correctAnswer: { type: Type.STRING },
                        explanation: { type: Type.STRING }
                    }
                }
            }
        }
    });

    if (response.text) {
        return JSON.parse(response.text) as QuizQuestion[];
    }
    throw new Error("Failed to generate more quiz questions");
};

export const generateStudyNotes = async (transcript: string): Promise<string> => {
    const ai = getAiClient();
    
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Transform this lecture transcript into structured, markdown-formatted study notes. Use headers, bullet points, and bold text for emphasis. Include a "Quick Review" section at the end.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
    });

    if (response.text) {
        return response.text;
    }
    throw new Error("Failed to generate notes");
};

export const generateMoreNotes = async (transcript: string, currentNotes: string): Promise<string> => {
    const ai = getAiClient();

    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `You are an expert tutor.
        1. Analyze the lecture transcript and the existing study notes provided below.
        2. Identify the 3-4 most complex or significant concepts that need further clarification.
        3. Generate a "Deep Dive & Explanations" section in Markdown. 
        4. For each selected concept, provide a detailed explanation, a useful analogy, and a concrete example.
        5. Do NOT repeat the existing notes verbatim.
        6. Start your response with a horizontal rule (---) and a header "## Deep Dive & Explanations".
        
        EXISTING NOTES:
        ${currentNotes.slice(0, 5000)}

        TRANSCRIPT:
        ${transcript.slice(0, 25000)}`,
    });

    if (response.text) {
        return response.text;
    }
    throw new Error("Failed to explain notes");
};

export const generateMindMap = async (transcript: string): Promise<string> => {
    const ai = getAiClient();
    
    // We request plain text, not JSON, because Mermaid syntax is text-based.
    const response = await ai.models.generateContent({
        model: MODEL_FAST,
        contents: `Analyze the following lecture transcript and create a hierarchical mind map structure using Mermaid.js syntax (Graph).
        
        RULES:
        1. Use 'graph LR' (Left to Right) as the base direction.
        2. The root node should be the main topic of the lecture.
        3. Branch out into major concepts, then sub-concepts.
        4. Keep node text concise (1-4 words max) to ensure the map remains readable.
        5. Use standard brackets for nodes with QUOTED labels: id["Label"].
        6. Output ONLY the raw Mermaid syntax. Do not wrap it in markdown code blocks.
        7. Do not use special characters inside labels that might break SVG rendering.
        
        TRANSCRIPT:
        ${transcript.slice(0, 30000)}`,
    });

    if (response.text) {
        // Clean up any potential markdown wrapping just in case
        return response.text.replace(/```mermaid/g, '').replace(/```/g, '').trim();
    }
    throw new Error("Failed to generate mind map");
};

export const createLectureChat = (transcript: string, history: ChatMessage[] = []): Chat => {
    const ai = getAiClient();
    
    // Safety: Slice transcript to prevent context overflow
    const safeTranscript = transcript ? transcript.slice(0, 40000) : "No transcript available.";
    
    // Convert generic ChatMessage to GoogleGenAI Content format
    // Take the last 10 messages (5 turns) for context to save tokens/avoid clutter, as requested
    const recentHistory = history.slice(-10);
    const formattedHistory: Content[] = recentHistory.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
    }));

    return ai.chats.create({
        model: MODEL_COMPLEX,
        history: formattedHistory,
        config: {
            systemInstruction: `You are a helpful and knowledgeable teaching assistant. 
            You will be answering questions about a specific lecture.
            
            LECTURE CONTENT:
            ${safeTranscript}
            
            RULES:
            1. Answer questions based ONLY on the provided lecture content.
            2. If the answer cannot be found in the lecture, politely state that the information is not in the recording.
            3. Keep answers concise and helpful.
            4. Do not hallucinate information outside of the provided text.`
        }
    });
};