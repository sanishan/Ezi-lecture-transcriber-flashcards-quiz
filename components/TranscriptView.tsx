import React, { useState, useRef, useEffect } from 'react';
import { LectureData, DetailTab, Flashcard, QuizQuestion, ChatMessage } from '../types';
import { ChevronLeftIcon, SparklesIcon, BookOpenIcon, DocumentTextIcon, AcademicCapIcon, BoltIcon, TrashIcon, ChatBubbleLeftRightIcon, PaperAirplaneIcon, MicIcon, HashtagIcon, XMarkIcon, CheckCircleIcon, EyeIcon, ChatBubbleLeftEllipsisIcon, MapIcon } from './icons';
import * as GeminiService from '../services/geminiService';
import * as StorageService from '../services/storageService';
import { marked } from 'marked';
import { Chat } from '@google/genai';
import MindMapRenderer from './MindMapRenderer';

declare global {
    interface AIStudio {
        openSelectKey: () => Promise<void>;
        hasSelectedApiKey: () => Promise<boolean>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}

interface TranscriptViewProps {
    lecture: LectureData;
    onBack: () => void;
    onUpdate: (updated: LectureData) => void;
    onDelete: (id: string) => void;
    onContinueRecording: () => void;
    isProcessing?: boolean;
}

const TranscriptView: React.FC<TranscriptViewProps> = ({ lecture, onBack, onUpdate, onDelete, onContinueRecording, isProcessing }) => {
    const [activeTab, setActiveTab] = useState<DetailTab>('transcript');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Title Editing State
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [tempTitle, setTempTitle] = useState(lecture.title);

    // Tag State
    const [isAddingTag, setIsAddingTag] = useState(false);
    const [newTagText, setNewTagText] = useState('');
    const tagInputRef = useRef<HTMLInputElement>(null);

    // Chat State
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>(lecture.chatHistory || []);
    const [chatInput, setChatInput] = useState('');
    const [chatSession, setChatSession] = useState<Chat | null>(null);
    const [isChatLoading, setIsChatLoading] = useState(false);

    // Quiz State
    const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
    const [isQuizSubmitted, setIsQuizSubmitted] = useState(false);

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);

    // Helper for fuzzy matching options to handle trailing spaces/case issues from AI
    const normalizeText = (text: string | undefined) => text ? text.trim() : '';

    // Helper to format timestamps
    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // State Reset on Lecture Change
    useEffect(() => {
        setChatMessages(lecture.chatHistory || []);
        setChatSession(null);
        setQuizAnswers({});
        setIsQuizSubmitted(false);
        setTempTitle(lecture.title);
    }, [lecture.id]);

    // State Reset on Quiz Data Change (Regeneration)
    useEffect(() => {
        // Only reset if completely regenerated (handled by empty keys). 
        // If appending, we might want to keep state, but current logic resets.
        // Actually, for "More Questions", we want to allow answering new ones.
        // The simplistic approach is to reset answers when data changes length significantly or is replaced.
    }, [lecture.quiz]);

    // Title Editing Handlers
    const handleTitleSave = () => {
        if (tempTitle.trim() !== lecture.title) {
            onUpdate({ ...lecture, title: tempTitle.trim() });
        }
        setIsEditingTitle(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleTitleSave();
        if (e.key === 'Escape') {
            setTempTitle(lecture.title);
            setIsEditingTitle(false);
        }
    };

    // Tag Handlers
    const handleAddTag = () => {
        const tag = newTagText.trim();
        if (tag) {
            const currentTags = lecture.tags || [];
            if (!currentTags.includes(tag)) {
                onUpdate({ ...lecture, tags: [...currentTags, tag] });
            }
        }
        setNewTagText('');
        setIsAddingTag(false);
    };

    const handleRemoveTag = (tagToRemove: string) => {
        const currentTags = lecture.tags || [];
        onUpdate({ ...lecture, tags: currentTags.filter(t => t !== tagToRemove) });
    };

    const handleTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleAddTag();
        if (e.key === 'Escape') {
            setNewTagText('');
            setIsAddingTag(false);
        }
    };

    useEffect(() => {
        if (isAddingTag && tagInputRef.current) {
            tagInputRef.current.focus();
        }
    }, [isAddingTag]);


    // Auto-scroll chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages, activeTab]);

    // Force focus chat input when tab changes
    useEffect(() => {
        if (activeTab === 'chat') {
            setTimeout(() => {
                chatInputRef.current?.focus();
            }, 100);
        }
    }, [activeTab]);

    // Initialize Chat Session when entering Chat Tab
    useEffect(() => {
        if (activeTab === 'chat') {
            if (!chatSession) {
                try {
                    // Pass existing history to initialize context
                    const history = lecture.chatHistory || [];
                    const session = GeminiService.createLectureChat(lecture.transcriptText, history);
                    setChatSession(session);

                    // If no history, add greeting
                    if (history.length === 0) {
                        setChatMessages([{ role: 'model', text: 'Hello! I can answer questions about this lecture. What would you like to know?' }]);
                    } else {
                        setChatMessages(history);
                    }
                } catch (e) {
                    console.error("Failed to init chat", e);
                    setChatMessages([{ role: 'model', text: 'Sorry, I could not connect to the AI service. Please check your API key.' }]);
                }
            }
        }
    }, [activeTab, chatSession, lecture.transcriptText, lecture.chatHistory]);

    const handleSendMessage = async () => {
        if (!chatInput.trim() || !chatSession || isChatLoading) return;

        const userMsg = chatInput.trim();
        const newHistoryUser: ChatMessage[] = [...chatMessages, { role: 'user', text: userMsg }];

        setChatInput('');
        setChatMessages(newHistoryUser);
        setIsChatLoading(true);

        // Keep focus on input
        if (chatInputRef.current) chatInputRef.current.focus();

        try {
            const response = await chatSession.sendMessage({ message: userMsg });
            let modelText = "I'm having trouble thinking right now.";
            if (response.text) {
                modelText = response.text;
            }

            const newHistoryModel: ChatMessage[] = [...newHistoryUser, { role: 'model', text: modelText }];
            setChatMessages(newHistoryModel);

            // Persist to lecture data
            onUpdate({ ...lecture, chatHistory: newHistoryModel });

        } catch (e: any) {
            console.error("Chat Error", e);

            let errorMessage = e.message || "Unknown error";
            try {
                if (typeof errorMessage === 'string' && errorMessage.trim().startsWith('{')) {
                    const parsed = JSON.parse(errorMessage);
                    if (parsed.error?.code === 429) {
                        errorMessage = "Usage Limit Exceeded. You have hit the free tier limit for Gemini. Please wait a moment or check your API plan.";
                    } else if (parsed.error?.message) {
                        errorMessage = parsed.error.message;
                    }
                } else if (errorMessage.includes("429")) {
                    errorMessage = "Usage Limit Exceeded. Please try again in a few moments.";
                }
            } catch (parseError) { }

            const errorMsg: ChatMessage = { role: 'model', text: `⚠️ **Error**: ${errorMessage}` };
            const newHistoryError = [...newHistoryUser, errorMsg];
            setChatMessages(newHistoryError);
        } finally {
            setIsChatLoading(false);
            // Ensure focus is regained
            setTimeout(() => {
                chatInputRef.current?.focus();
            }, 50);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleSelectKey = async () => {
        if (window.aistudio?.openSelectKey) {
            try {
                await window.aistudio.openSelectKey();
                setChatSession(null); // Force re-init
            } catch (e) {
                console.error("Failed to open key selector", e);
            }
        } else {
            alert("API Key selection is not available in this environment.");
        }
    };

    const handleDelete = () => {
        if (window.confirm(`Are you sure you want to delete "${lecture.title}"? This cannot be undone.`)) {
            onDelete(lecture.id);
        }
    };

    // Generic handler for AI generation
    const handleGenerate = async (type: 'summary' | 'flashcards' | 'quiz' | 'notes' | 'mindmap') => {
        setIsLoading(true);
        setError(null);
        try {
            const updatedLecture = { ...lecture };

            if (type === 'summary') {
                updatedLecture.summary = await GeminiService.generateSummary(lecture.transcriptText);
            } else if (type === 'flashcards') {
                updatedLecture.flashcards = await GeminiService.generateFlashcards(lecture.transcriptText);
            } else if (type === 'quiz') {
                updatedLecture.quiz = await GeminiService.generateQuiz(lecture.transcriptText);
                setQuizAnswers({});
                setIsQuizSubmitted(false);
            } else if (type === 'notes') {
                updatedLecture.studyNotes = await GeminiService.generateStudyNotes(lecture.transcriptText);
            } else if (type === 'mindmap') {
                updatedLecture.mindmap = await GeminiService.generateMindMap(lecture.transcriptText);
            }

            StorageService.saveLecture(updatedLecture);
            onUpdate(updatedLecture);
        } catch (err: any) {
            setError(err.message || "Failed to generate content. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    // Handlers for "Generate More"
    const handleExpandSummary = async () => {
        if (!lecture.summary) return;
        setIsLoading(true);
        setError(null);
        try {
            const newSummaryData = await GeminiService.expandSummary(lecture.transcriptText, lecture.summary);
            const updatedLecture = { ...lecture, summary: newSummaryData };
            StorageService.saveLecture(updatedLecture);
            onUpdate(updatedLecture);
        } catch (e: any) {
            setError(e.message || "Failed to expand summary.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleMoreFlashcards = async () => {
        if (!lecture.flashcards) return;
        setIsLoading(true);
        setError(null);
        try {
            const newCards = await GeminiService.generateMoreFlashcards(lecture.transcriptText, lecture.flashcards);
            const updatedLecture = { ...lecture, flashcards: [...lecture.flashcards, ...newCards] };
            StorageService.saveLecture(updatedLecture);
            onUpdate(updatedLecture);
        } catch (e: any) {
            setError(e.message || "Failed to generate more flashcards.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleMoreQuiz = async () => {
        if (!lecture.quiz) return;
        setIsLoading(true);
        setError(null);
        try {
            const newQuestions = await GeminiService.generateMoreQuiz(lecture.transcriptText, lecture.quiz);
            const updatedLecture = { ...lecture, quiz: [...lecture.quiz, ...newQuestions] };

            // Allow user to answer new questions without resetting old ones if they wish,
            // but for simplicity, we treat "Generate More" as extending the quiz.
            // Reset submitted state to allow interactions with new questions.
            setIsQuizSubmitted(false);

            StorageService.saveLecture(updatedLecture);
            onUpdate(updatedLecture);
        } catch (e: any) {
            setError(e.message || "Failed to generate more questions.");
        } finally {
            setIsLoading(false);
        }
    };

    // Specific handler to expand notes
    const handleExplainNotes = async () => {
        if (!lecture.studyNotes) return;

        setIsLoading(true);
        setError(null);
        try {
            const extraContent = await GeminiService.generateMoreNotes(lecture.transcriptText, lecture.studyNotes);
            const updatedNotes = lecture.studyNotes + "\n\n" + extraContent;

            const updatedLecture = { ...lecture, studyNotes: updatedNotes };
            StorageService.saveLecture(updatedLecture);
            onUpdate(updatedLecture);
        } catch (err: any) {
            setError(err.message || "Failed to explain notes.");
        } finally {
            setIsLoading(false);
        }
    };

    // Quiz Handlers
    const handleQuizOptionSelect = (questionIndex: number, option: string) => {
        if (isQuizSubmitted) return;
        setQuizAnswers(prev => ({
            ...prev,
            [questionIndex]: option
        }));
    };

    const handleSubmitQuiz = () => {
        if (Object.keys(quizAnswers).length < (lecture.quiz?.length || 0)) {
            if (!confirm("You haven't answered all questions. Submit anyway?")) {
                return;
            }
        }
        setIsQuizSubmitted(true);
    };

    const handleRevealAnswers = () => {
        const hasAnswers = Object.keys(quizAnswers).length > 0;
        if (hasAnswers) {
            if (confirm("This will reveal all correct answers. You won't get a score for this attempt.")) {
                setIsQuizSubmitted(true);
            }
        } else {
            // No need to confirm if they haven't started
            setIsQuizSubmitted(true);
        }
    };

    const handleRetakeQuiz = () => {
        setQuizAnswers({});
        setIsQuizSubmitted(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const calculateScore = () => {
        if (!lecture.quiz) return 0;
        let correct = 0;
        lecture.quiz.forEach((q, i) => {
            if (normalizeText(quizAnswers[i]) === normalizeText(q.correctAnswer)) correct++;
        });
        return correct;
    };

    const renderSummary = () => {
        if (!lecture.summary) {
            return (
                <EmptyState
                    icon={<DocumentTextIcon className="w-12 h-12 text-blue-500" />}
                    title={isProcessing ? "Generating Summary..." : "No Summary Yet"}
                    description={isProcessing ? "AI is processing your new recording." : "Generate a concise summary of the key points and terms from this lecture."}
                    action={() => handleGenerate('summary')}
                    loading={isLoading || isProcessing}
                />
            );
        }
        return (
            <div className="space-y-6 animate-fadeIn pb-12">
                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
                    <h3 className="font-semibold text-blue-900 mb-2">Overview</h3>
                    <p className="text-blue-800 leading-relaxed">{lecture.summary.overview}</p>
                </div>

                {lecture.summary.mainPoints && lecture.summary.mainPoints.length > 0 && (
                    <div>
                        <h3 className="font-bold text-slate-800 text-lg mb-3">Main Points</h3>
                        <ul className="space-y-3">
                            {lecture.summary.mainPoints.map((point, i) => (
                                <li key={i} className="flex gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold">{i + 1}</span>
                                    <span className="text-slate-700">{point}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {lecture.summary.keyTerms && lecture.summary.keyTerms.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {lecture.summary.keyTerms.map((term, i) => (
                            <div key={i} className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                                <span className="block font-bold text-slate-900 mb-1">{term.term}</span>
                                <span className="text-sm text-slate-600">{term.definition}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex justify-center mt-8">
                    <button
                        onClick={handleExpandSummary}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-6 py-2.5 bg-white border border-indigo-200 text-indigo-600 rounded-full font-medium hover:bg-indigo-50 shadow-sm transition-all disabled:opacity-70"
                    >
                        {isLoading ? "Expanding..." : (
                            <>
                                <SparklesIcon className="w-4 h-4" />
                                <span>Expand Summary</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    const renderFlashcards = () => {
        if (!lecture.flashcards) {
            return (
                <EmptyState
                    icon={<BoltIcon className="w-12 h-12 text-amber-500" />}
                    title={isProcessing ? "Creating Flashcards..." : "Generate Flashcards"}
                    description={isProcessing ? "AI is crafting study cards for you." : "Create study cards automatically to test your knowledge."}
                    action={() => handleGenerate('flashcards')}
                    loading={isLoading || isProcessing}
                />
            );
        }
        return (
            <div className="pb-12">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn mb-8">
                    {lecture.flashcards.map((card, i) => (
                        <FlashcardItem key={i} card={card} />
                    ))}
                </div>
                <div className="flex justify-center">
                    <button
                        onClick={handleMoreFlashcards}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-6 py-2.5 bg-white border border-indigo-200 text-indigo-600 rounded-full font-medium hover:bg-indigo-50 shadow-sm transition-all disabled:opacity-70"
                    >
                        {isLoading ? "Generating..." : (
                            <>
                                <BoltIcon className="w-4 h-4" />
                                <span>Generate More Cards</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    const renderQuiz = () => {
        if (!lecture.quiz) {
            return (
                <EmptyState
                    icon={<AcademicCapIcon className="w-12 h-12 text-emerald-500" />}
                    title={isProcessing ? "Building Quiz..." : "Generate Quiz"}
                    description={isProcessing ? "AI is generating quiz questions." : "Test yourself with a multiple choice quiz based on the lecture."}
                    action={() => handleGenerate('quiz')}
                    loading={isLoading || isProcessing}
                />
            );
        }

        const score = calculateScore();
        const total = lecture.quiz.length;
        // If the user hasn't selected any answers, we assume they used "Reveal Answers"
        const isRevealMode = isQuizSubmitted && Object.keys(quizAnswers).length === 0;

        return (
            <div className="space-y-8 animate-fadeIn max-w-2xl mx-auto pb-8">
                {/* Quiz Header & Controls */}
                {!isQuizSubmitted && (
                    <div className="flex justify-between items-center bg-indigo-50 p-5 rounded-2xl border border-indigo-100 shadow-sm">
                        <div>
                            <h3 className="font-bold text-indigo-900 text-lg">Knowledge Check</h3>
                            <p className="text-sm text-indigo-700/80">Test your understanding of the lecture.</p>
                        </div>
                        <button
                            onClick={handleRevealAnswers}
                            className="flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-800 bg-white px-4 py-2 rounded-xl border border-indigo-100 shadow-sm hover:shadow-md transition-all active:scale-95"
                            title="Reveal all answers without scoring"
                        >
                            <EyeIcon className="w-4 h-4" />
                            Reveal Answers
                        </button>
                    </div>
                )}

                {isQuizSubmitted && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center animate-fadeIn">
                        <div className="inline-flex p-3 bg-emerald-100 text-emerald-600 rounded-full mb-3">
                            <CheckCircleIcon className="w-8 h-8" />
                        </div>
                        {isRevealMode ? (
                            <>
                                <h3 className="text-2xl font-bold text-emerald-900 mb-1">Answers Revealed</h3>
                                <p className="text-emerald-700">Review the correct answers and explanations below.</p>
                            </>
                        ) : (
                            <>
                                <h3 className="text-2xl font-bold text-emerald-900 mb-1">Quiz Completed!</h3>
                                <p className="text-emerald-700">You scored <span className="font-bold">{score}</span> out of <span className="font-bold">{total}</span></p>
                            </>
                        )}

                        <div className="flex flex-wrap justify-center gap-3 mt-6">
                            <button
                                onClick={handleRetakeQuiz}
                                className="px-5 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-lg hover:bg-emerald-100 font-medium transition-colors"
                            >
                                {isRevealMode ? "Take Quiz" : "Retake Quiz"}
                            </button>
                            <button
                                onClick={() => {
                                    if (confirm("This will replace the current quiz with new questions. Continue?")) {
                                        handleGenerate('quiz');
                                    }
                                }}
                                className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium shadow-sm transition-colors flex items-center gap-2"
                            >
                                <SparklesIcon className="w-4 h-4" /> Generate New Set
                            </button>

                            <button
                                onClick={handleMoreQuiz}
                                disabled={isLoading}
                                className="px-5 py-2 bg-white border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 font-medium shadow-sm transition-colors flex items-center gap-2 disabled:opacity-70"
                            >
                                {isLoading ? "Adding..." : (
                                    <>
                                        <AcademicCapIcon className="w-4 h-4" />
                                        <span>Add 5 More Questions</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                )}

                {lecture.quiz.map((q, i) => {
                    const userAnswer = quizAnswers[i];
                    const isCorrect = normalizeText(userAnswer) === normalizeText(q.correctAnswer);

                    return (
                        <div key={i} className={`bg-white p-6 rounded-xl border shadow-sm transition-all ${isQuizSubmitted
                                ? isCorrect
                                    ? 'border-emerald-200 shadow-emerald-50'
                                    : userAnswer
                                        ? 'border-red-200 shadow-red-50'
                                        : 'border-slate-200'
                                : 'border-slate-200'
                            }`}>
                            <div className="flex gap-3 mb-4">
                                <span className="flex-shrink-0 w-8 h-8 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center font-bold text-sm">
                                    {i + 1}
                                </span>
                                <h4 className="font-bold text-lg text-slate-900 mt-0.5">{q.question}</h4>
                            </div>

                            <div className="space-y-2 ml-11">
                                {q.options.map((opt, idx) => {
                                    let optionClass = "border-slate-200 hover:bg-slate-50 text-slate-600";
                                    let icon = null;
                                    const isOptCorrect = normalizeText(opt) === normalizeText(q.correctAnswer);

                                    if (isQuizSubmitted) {
                                        if (isOptCorrect) {
                                            optionClass = "bg-emerald-50 border-emerald-300 text-emerald-800 font-medium ring-1 ring-emerald-300";
                                            icon = <CheckCircleIcon className="w-5 h-5 text-emerald-500" />;
                                        } else if (normalizeText(opt) === normalizeText(userAnswer)) {
                                            optionClass = "bg-red-50 border-red-300 text-red-800 font-medium ring-1 ring-red-300";
                                            icon = <XMarkIcon className="w-5 h-5 text-red-500" />;
                                        } else {
                                            optionClass = "border-slate-100 text-slate-400 opacity-60";
                                        }
                                    } else {
                                        if (normalizeText(userAnswer) === normalizeText(opt)) {
                                            optionClass = "bg-indigo-50 border-indigo-500 text-indigo-700 ring-1 ring-indigo-500";
                                        }
                                    }

                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => handleQuizOptionSelect(i, opt)}
                                            disabled={isQuizSubmitted}
                                            className={`w-full text-left p-3 rounded-lg border transition-all flex justify-between items-center ${optionClass}`}
                                        >
                                            <span>{opt}</span>
                                            {icon}
                                        </button>
                                    );
                                })}
                            </div>

                            {isQuizSubmitted && (
                                <div className="mt-4 ml-11 text-sm bg-slate-50 p-3 rounded-lg border border-slate-100 text-slate-600 flex gap-2">
                                    <span className="flex-shrink-0">💡</span>
                                    <span>{q.explanation}</span>
                                </div>
                            )}
                        </div>
                    );
                })}

                {!isQuizSubmitted && (
                    <div className="flex flex-col items-center gap-4 pt-4">
                        <button
                            onClick={handleSubmitQuiz}
                            className="px-8 py-3 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transform hover:scale-105 transition-all"
                        >
                            Submit Answers
                        </button>
                        <button
                            onClick={handleRevealAnswers}
                            className="text-slate-500 hover:text-indigo-600 text-sm font-medium px-4 py-2 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            See All Answers
                        </button>
                    </div>
                )}
            </div>
        );
    };

    const renderNotes = () => {
        if (!lecture.studyNotes) {
            return (
                <EmptyState
                    icon={<BookOpenIcon className="w-12 h-12 text-purple-500" />}
                    title={isProcessing ? "Writing Notes..." : "Create Study Notes"}
                    description={isProcessing ? "AI is formatting your study notes." : "Format the raw transcript into readable markdown notes."}
                    action={() => handleGenerate('notes')}
                    loading={isLoading || isProcessing}
                />
            );
        }

        const htmlContent = marked.parse(lecture.studyNotes, { async: false }) as string;

        return (
            <div className="relative">
                <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm animate-fadeIn mb-20">
                    <div
                        className="prose prose-slate max-w-none"
                        dangerouslySetInnerHTML={{ __html: htmlContent }}
                    />
                </div>

                {/* Floating Action Button for Explain More */}
                <div className="fixed bottom-8 right-8 z-20 flex flex-col gap-2 items-end">
                    <button
                        onClick={handleExplainNotes}
                        disabled={isLoading}
                        className="flex items-center gap-2 bg-indigo-100 text-indigo-700 px-5 py-3 rounded-full font-semibold shadow-lg hover:bg-indigo-200 transition-all hover:scale-105 disabled:opacity-70 disabled:scale-100"
                    >
                        {isLoading ? (
                            <>
                                <div className="animate-spin h-5 w-5 border-2 border-indigo-700 border-t-transparent rounded-full"></div>
                                <span>Explaining...</span>
                            </>
                        ) : (
                            <>
                                <ChatBubbleLeftEllipsisIcon className="w-5 h-5" />
                                <span>Explain More</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    const renderMindMap = () => {
        if (!lecture.mindmap) {
            return (
                <EmptyState
                    icon={<MapIcon className="w-12 h-12 text-pink-500" />}
                    title={isProcessing ? "Drawing Map..." : "Generate Mind Map"}
                    description={isProcessing ? "AI is connecting the dots." : "Visualize the lecture structure with an interactive diagram."}
                    action={() => handleGenerate('mindmap')}
                    loading={isLoading || isProcessing}
                />
            );
        }

        return (
            <div className="animate-fadeIn pb-12">
                <div className="mb-4">
                    <h3 className="text-lg font-bold text-slate-800">Visual Overview</h3>
                    <p className="text-sm text-slate-500">A hierarchical map of the key concepts in this lecture.</p>
                </div>

                <MindMapRenderer chart={lecture.mindmap} />

                <div className="flex justify-center mt-6">
                    <button
                        onClick={() => {
                            if (confirm("Regenerate the mind map? This will replace the current one.")) {
                                handleGenerate('mindmap');
                            }
                        }}
                        className="px-4 py-2 text-sm text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <SparklesIcon className="w-4 h-4" /> Regenerate Map
                    </button>
                </div>
            </div>
        );
    };

    const renderChat = () => {
        return (
            <div className="flex flex-col h-full bg-slate-50 relative animate-fadeIn">
                <div className="flex-1 overflow-y-auto p-4 space-y-4 mb-20">
                    {chatMessages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user'
                                    ? 'bg-indigo-600 text-white rounded-br-none'
                                    : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none prose prose-sm'
                                }`}>
                                {msg.role === 'model' ? (
                                    <div className="flex flex-col gap-2">
                                        <div dangerouslySetInnerHTML={{ __html: marked.parse(msg.text, { async: false }) as string }} />
                                        {msg.text.includes("Error") && (
                                            <button
                                                onClick={handleSelectKey}
                                                className="self-start text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full hover:bg-red-200 transition-colors"
                                            >
                                                Configure API Key
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    msg.text
                                )}
                            </div>
                        </div>
                    ))}
                    {isChatLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white p-4 rounded-2xl rounded-bl-none border border-slate-200">
                                <div className="flex gap-1">
                                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className="absolute bottom-4 left-4 right-4">
                    <div className="flex gap-2 p-2 bg-white border border-slate-200 rounded-full shadow-lg">
                        <input
                            ref={chatInputRef}
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask a question about the lecture..."
                            className="flex-1 px-4 py-2 bg-transparent focus:outline-none text-slate-700 placeholder:text-slate-400"
                            autoFocus
                        />
                        <button
                            onClick={handleSendMessage}
                            disabled={!chatInput.trim() || isChatLoading}
                            className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <PaperAirplaneIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const formatSessionTime = (isoString: string) => {
        return new Date(isoString).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-slate-100 p-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-4 flex-1 overflow-hidden">
                    <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 flex-shrink-0">
                        <ChevronLeftIcon className="w-6 h-6" />
                    </button>
                    <div className="flex-1 overflow-hidden min-w-0">
                        {isEditingTitle ? (
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={tempTitle}
                                    onChange={(e) => setTempTitle(e.target.value)}
                                    onBlur={handleTitleSave}
                                    onKeyDown={handleTitleKeyDown}
                                    autoFocus
                                    className="font-bold text-xl text-slate-900 bg-white border border-indigo-300 rounded px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                />
                                <button onClick={handleTitleSave} className="p-1 text-green-600 hover:bg-green-50 rounded">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                    </svg>
                                </button>
                            </div>
                        ) : (
                            <h2
                                onClick={() => { setTempTitle(lecture.title); setIsEditingTitle(true); }}
                                className="font-bold text-xl text-slate-900 cursor-pointer hover:bg-slate-50 hover:text-indigo-700 transition-colors rounded px-1 -ml-1 border border-transparent hover:border-slate-200 truncate"
                                title="Click to rename"
                            >
                                {lecture.title}
                            </h2>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-1">
                            <p className="text-sm text-slate-500 whitespace-nowrap">
                                {new Date(lecture.date).toLocaleDateString()} • {Math.floor(lecture.duration / 60)} mins
                            </p>

                            {/* Tag List */}
                            <div className="flex flex-wrap gap-2 items-center">
                                {lecture.tags && lecture.tags.map(tag => (
                                    <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-xs font-medium border border-slate-200 group">
                                        <HashtagIcon className="w-3 h-3 text-slate-400" />
                                        {tag}
                                        <button onClick={() => handleRemoveTag(tag)} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <XMarkIcon className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}

                                {isAddingTag ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            ref={tagInputRef}
                                            type="text"
                                            value={newTagText}
                                            onChange={(e) => setNewTagText(e.target.value)}
                                            onKeyDown={handleTagKeyDown}
                                            onBlur={handleAddTag}
                                            className="w-24 px-2 py-0.5 text-xs border border-indigo-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                            placeholder="New tag..."
                                        />
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setIsAddingTag(true)}
                                        className="text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-0.5 rounded transition-colors font-medium"
                                    >
                                        + Add Tag
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2 ml-4 flex-shrink-0">
                    {isProcessing && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold animate-pulse border border-indigo-100 whitespace-nowrap">
                            <SparklesIcon className="w-3 h-3" />
                            Processing AI...
                        </div>
                    )}
                    <button
                        onClick={handleDelete}
                        className="text-red-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-colors cursor-pointer relative z-50"
                        title="Delete Lecture"
                        type="button"
                    >
                        <TrashIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="bg-slate-50 border-b border-slate-200 px-4 flex gap-1 overflow-x-auto">
                <TabButton active={activeTab === 'transcript'} onClick={() => setActiveTab('transcript')} icon={<DocumentTextIcon className="w-4 h-4" />}>Transcript</TabButton>
                <TabButton active={activeTab === 'summary'} onClick={() => setActiveTab('summary')} icon={<SparklesIcon className="w-4 h-4" />}>Summary</TabButton>
                <TabButton active={activeTab === 'mindmap'} onClick={() => setActiveTab('mindmap')} icon={<MapIcon className="w-4 h-4" />}>Mind Map</TabButton>
                <TabButton active={activeTab === 'flashcards'} onClick={() => setActiveTab('flashcards')} icon={<BoltIcon className="w-4 h-4" />}>Flashcards</TabButton>
                <TabButton active={activeTab === 'quiz'} onClick={() => setActiveTab('quiz')} icon={<AcademicCapIcon className="w-4 h-4" />}>Quiz</TabButton>
                <TabButton active={activeTab === 'notes'} onClick={() => setActiveTab('notes')} icon={<BookOpenIcon className="w-4 h-4" />}>Notes</TabButton>
                <TabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={<ChatBubbleLeftRightIcon className="w-4 h-4" />}>AI Chat</TabButton>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-0 bg-slate-50/50 relative">
                {error && activeTab !== 'chat' && (
                    <div className="m-6 p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg">
                        {error}
                    </div>
                )}

                {activeTab === 'chat' ? (
                    renderChat()
                ) : (
                    <div className="p-6">
                        {activeTab === 'transcript' && (
                            <div className="space-y-4">
                                <div className="flex justify-end">
                                    <button
                                        onClick={onContinueRecording}
                                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm"
                                    >
                                        <MicIcon className="w-4 h-4" />
                                        Continue Recording
                                    </button>
                                </div>

                                {lecture.chunks && lecture.chunks.length > 0 ? (
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-1">
                                        {lecture.chunks.map((chunk, idx) => (
                                            <div key={idx} className="flex gap-4 group hover:bg-slate-50 p-1 -mx-2 rounded-lg transition-colors items-baseline">
                                                <div className="w-20 flex-shrink-0 text-right font-mono text-xs text-slate-400 group-hover:text-indigo-500 select-none pt-1">
                                                    {formatTime(chunk.timestamp)}
                                                </div>
                                                <div className="flex-1 text-slate-700 leading-relaxed">
                                                    {chunk.text}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : lecture.sessions && lecture.sessions.length > 0 ? (
                                    lecture.sessions.map((session, idx) => (
                                        <div key={session.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                            <div className="bg-slate-50 px-6 py-3 border-b border-slate-100 flex justify-between items-center">
                                                <span className="font-bold text-slate-700 text-sm uppercase tracking-wide">
                                                    Session {idx + 1}
                                                </span>
                                                <span className="text-xs text-slate-500 font-mono">
                                                    {formatSessionTime(session.startTime)}
                                                </span>
                                            </div>
                                            <div className="p-8">
                                                <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{session.text}</p>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
                                        <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{lecture.transcriptText}</p>
                                    </div>
                                )}
                            </div>
                        )}
                        {activeTab === 'summary' && renderSummary()}
                        {activeTab === 'flashcards' && renderFlashcards()}
                        {activeTab === 'quiz' && renderQuiz()}
                        {activeTab === 'notes' && renderNotes()}
                        {activeTab === 'mindmap' && renderMindMap()}
                    </div>
                )}
            </div>
        </div>
    );
};

// Sub-components
const TabButton = ({ children, active, onClick, icon }: any) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${active
                ? 'border-indigo-600 text-indigo-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'
            }`}
    >
        {icon}
        {children}
    </button>
);

const EmptyState = ({ icon, title, description, action, loading }: any) => (
    <div className="flex flex-col items-center justify-center h-64 md:h-96 text-center">
        <div className="mb-4 p-4 bg-white rounded-full shadow-sm border border-slate-100">{icon}</div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">{title}</h3>
        <p className="text-slate-500 max-w-sm mb-6">{description}</p>
        <button
            onClick={action}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 disabled:opacity-70 shadow-lg shadow-indigo-200 transition-all"
        >
            {loading ? (
                <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>{title.includes("Generating") ? "Processing..." : "Generating..."}</span>
                </>
            ) : (
                <>
                    <SparklesIcon className="w-5 h-5" />
                    <span>Generate with Gemini AI</span>
                </>
            )}
        </button>
    </div>
);

const FlashcardItem: React.FC<{ card: Flashcard }> = ({ card }) => {
    const [flipped, setFlipped] = useState(false);
    return (
        <div
            onClick={() => setFlipped(!flipped)}
            className="h-72 w-full cursor-pointer perspective-1000 group"
        >
            <div className={`relative w-full h-full transition-all duration-500 transform-style-3d ${flipped ? 'rotate-y-180' : ''}`}>
                {/* Front (Question) */}
                <div className="absolute inset-0 w-full h-full bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col backface-hidden">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-500">Question</span>
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${card.difficulty === 'Easy' ? 'bg-green-100 text-green-700' :
                                card.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-red-100 text-red-700'
                            }`}>{card.difficulty}</span>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <p className="text-xl font-medium text-slate-800 text-center leading-relaxed">{card.front}</p>
                    </div>
                    <div className="mt-4 text-center">
                        <span className="text-xs text-slate-400 font-medium bg-slate-50 px-3 py-1 rounded-full">Click to Reveal Answer</span>
                    </div>
                </div>

                {/* Back (Answer) */}
                <div className="absolute inset-0 w-full h-full bg-slate-900 p-6 rounded-xl shadow-lg flex flex-col backface-hidden rotate-y-180">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Answer</span>
                    </div>
                    <div className="flex-1 flex items-center justify-center overflow-y-auto custom-scrollbar">
                        <p className="text-lg font-medium text-white text-center leading-relaxed">{card.back}</p>
                    </div>
                    <div className="mt-4 text-center flex justify-between items-center text-xs text-slate-500 border-t border-slate-800 pt-3">
                        <span>{card.topic}</span>
                        <span className="text-slate-400">Click to flip back</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TranscriptView;