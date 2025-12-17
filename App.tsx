import React, { useEffect, useState, useRef } from 'react';
import { LectureData, ViewMode, TranscriptSession } from './types';
import * as StorageService from './services/storageService';
import * as GeminiService from './services/geminiService';
import * as YoutubeService from './services/youtubeService';
import Recorder from './components/Recorder';
import TranscriptView from './components/TranscriptView';
import { SparklesIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, DocumentTextIcon, HashtagIcon, Bars3Icon, XMarkIcon, PlayCircleIcon, CheckCircleIcon, ChevronLeftIcon, MicIcon, MapIcon } from './components/icons';
import { v4 as uuidv4 } from 'uuid';

interface GenerationOptions {
    summary: boolean;
    flashcards: boolean;
    quiz: boolean;
    notes: boolean;
    mindmap: boolean;
}

const App = () => {
  const [lectures, setLectures] = useState<LectureData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);
  const [isProcessingId, setIsProcessingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  // Mobile/Tablet Sidebar State (Overlay)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Desktop Sidebar State (Collapsible)
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  
  // Modal State
  const [showGenModal, setShowGenModal] = useState(false);
  const [showYoutubeModal, setShowYoutubeModal] = useState(false);
  
  // YouTube Import State
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [isFetchingYoutube, setIsFetchingYoutube] = useState(false);
  const [fetchedVideoData, setFetchedVideoData] = useState<YoutubeService.YoutubeVideoResult | null>(null);
  const [selectedLangIndex, setSelectedLangIndex] = useState<number>(0);

  const [pendingLectureId, setPendingLectureId] = useState<string | null>(null);
  const [genOptions, setGenOptions] = useState<GenerationOptions>({
      summary: true,
      flashcards: true,
      quiz: true,
      notes: true,
      mindmap: true
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLectures(StorageService.getLectures());
  }, []);

  const resetYoutubeModal = () => {
      setShowYoutubeModal(false);
      setYoutubeUrl('');
      setFetchedVideoData(null);
      setIsFetchingYoutube(false);
      setSelectedLangIndex(0);
  };

  const handleRecordingFinished = async (result: { text: string, duration: number, startTime: string, endTime: string, chunks: any[] }) => {
    let lectureToSave: LectureData;

    const newSession: TranscriptSession = {
        id: uuidv4(),
        startTime: result.startTime,
        endTime: result.endTime,
        duration: result.duration,
        text: result.text
    };

    if (selectedLectureId && viewMode === 'record') {
        // APPENDING
        const existing = lectures.find(l => l.id === selectedLectureId);
        if (!existing) {
             console.error("Lecture not found during append");
             return;
        }

        lectureToSave = {
            ...existing,
            duration: existing.duration + result.duration,
            transcriptText: existing.transcriptText + "\n\n" + result.text,
            sessions: existing.sessions ? [...existing.sessions, newSession] : [
                { id: uuidv4(), startTime: existing.date, endTime: new Date().toISOString(), duration: existing.duration, text: existing.transcriptText },
                newSession
            ],
            // Append chunks if existing has them
            chunks: [...(existing.chunks || []), ...result.chunks],
            // Clear AI content so we can regenerate fresh
            summary: undefined,
            flashcards: undefined,
            quiz: undefined,
            studyNotes: undefined,
            mindmap: undefined,
        };
    } else {
        // CREATING NEW
        const id = `lect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        lectureToSave = {
            id,
            title: `Lecture ${new Date().toLocaleString()}`,
            date: result.startTime,
            duration: result.duration,
            transcriptText: result.text,
            chunks: result.chunks || [],
            sessions: [newSession],
            tags: []
        };
        setSelectedLectureId(id);
    }

    StorageService.saveLecture(lectureToSave);
    setLectures(StorageService.getLectures());
    setViewMode('detail');
    
    // Open Modal instead of auto-processing
    setPendingLectureId(lectureToSave.id);
    setShowGenModal(true);
  };

  const processLectureAI = async (lectureId: string, options: GenerationOptions) => {
    setIsProcessingId(lectureId);
    setShowGenModal(false);
    
    const lecture = StorageService.getLectureById(lectureId);
    if (!lecture) return;

    const updateLocally = (partialUpdate: Partial<LectureData>) => {
        const currentLectures = StorageService.getLectures();
        const index = currentLectures.findIndex(l => l.id === lectureId);
        if (index !== -1) {
            const updated = { ...currentLectures[index], ...partialUpdate };
            StorageService.saveLecture(updated);
            setLectures(StorageService.getLectures());
        }
    };

    try {
        const transcript = lecture.transcriptText;
        const promises = [];

        if (options.summary) {
            promises.push(GeminiService.generateSummary(transcript)
                .then(summary => updateLocally({ summary }))
                .catch(e => console.error("Summary failed", e)));
        }

        if (options.flashcards) {
            promises.push(GeminiService.generateFlashcards(transcript)
                .then(flashcards => updateLocally({ flashcards }))
                .catch(e => console.error("Flashcards failed", e)));
        }
            
        if (options.quiz) {
            promises.push(GeminiService.generateQuiz(transcript)
                .then(quiz => updateLocally({ quiz }))
                .catch(e => console.error("Quiz failed", e)));
        }

        if (options.notes) {
            promises.push(GeminiService.generateStudyNotes(transcript)
                .then(studyNotes => updateLocally({ studyNotes }))
                .catch(e => console.error("Notes failed", e)));
        }

        if (options.mindmap) {
            promises.push(GeminiService.generateMindMap(transcript)
                .then(mindmap => updateLocally({ mindmap }))
                .catch(e => console.error("Mindmap failed", e)));
        }

        await Promise.allSettled(promises);
        
    } catch (e) {
        console.error("Processing AI Error", e);
    } finally {
        setIsProcessingId(null);
        setPendingLectureId(null);
    }
  };

  const handleUpdateLecture = (lecture: LectureData) => {
    StorageService.saveLecture(lecture);
    setLectures(StorageService.getLectures());
  };

  const handleDeleteLecture = (id: string) => {
    StorageService.deleteLecture(id);
    setLectures(StorageService.getLectures());
    setViewMode('dashboard');
    setSelectedLectureId(null);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const count = await StorageService.importData(e.target.files[0]);
        setLectures(StorageService.getLectures());
        alert(`Successfully imported ${count} lecture(s).`);
      } catch (err) {
        alert("Failed to import file. Please ensure it is a valid JSON export.");
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Step 1: Fetch details
  const handleFetchYoutubeDetails = async () => {
      if (!youtubeUrl.trim()) return;
      setIsFetchingYoutube(true);
      setFetchedVideoData(null);

      try {
          const result = await YoutubeService.getYoutubeVideoDetails(youtubeUrl);
          setFetchedVideoData(result);
          // Default to first english or just first
          const enIndex = result.transcripts.findIndex(t => t.languageCode.startsWith('en'));
          setSelectedLangIndex(enIndex >= 0 ? enIndex : 0);
      } catch (error: any) {
          alert(error.message || "Failed to import YouTube video.");
      } finally {
          setIsFetchingYoutube(false);
      }
  };

  // Step 2: Confirm Import
  const handleConfirmYoutubeImport = () => {
      if (!fetchedVideoData) return;

      const selectedTranscript = fetchedVideoData.transcripts[selectedLangIndex];
      if (!selectedTranscript) return;

      // Calculate duration from chunks (use last chunk timestamp as approximation)
      let videoDuration = 0;
      if (selectedTranscript.chunks && selectedTranscript.chunks.length > 0) {
          const lastChunk = selectedTranscript.chunks[selectedTranscript.chunks.length - 1];
          videoDuration = lastChunk.timestamp;
      }

      const id = `lect_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newSession: TranscriptSession = {
          id: uuidv4(),
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          duration: videoDuration, 
          text: selectedTranscript.text
      };

      const lectureToSave: LectureData = {
          id,
          title: fetchedVideoData.title || "Imported YouTube Lecture",
          date: new Date().toISOString(),
          duration: videoDuration,
          transcriptText: selectedTranscript.text,
          chunks: selectedTranscript.chunks || [],
          sessions: [newSession],
          tags: ['YouTube', selectedTranscript.languageCode]
      };

      StorageService.saveLecture(lectureToSave);
      setLectures(StorageService.getLectures());
      
      resetYoutubeModal();
      setSelectedLectureId(id);
      setViewMode('detail');
      
      // Trigger AI Generation immediately
      setPendingLectureId(id);
      setTimeout(() => setShowGenModal(true), 500);
  };

  const getFilteredLectures = () => {
    return lectures.filter(l => {
        const matchesSearch = l.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesTag = selectedTag ? l.tags?.includes(selectedTag) : true;
        return matchesSearch && matchesTag;
    });
  };

  const filteredLectures = getFilteredLectures();
  
  // Extract unique tags and sort them
  const allTags = Array.from(new Set(lectures.flatMap(l => l.tags || []))).sort();

  const renderGenerationModal = () => {
    if (!showGenModal) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50">
                    <h3 className="text-xl font-bold text-slate-800">Generate AI Content</h3>
                    <p className="text-sm text-slate-500 mt-1">Select the features you want to generate for this lecture.</p>
                </div>
                
                <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                    <OptionCheckbox 
                        label="Lecture Summary" 
                        desc="Overview, main points, and key terms"
                        checked={genOptions.summary}
                        onChange={(v: boolean) => setGenOptions(prev => ({...prev, summary: v}))}
                        icon="📝"
                    />
                    <OptionCheckbox 
                        label="Flashcards" 
                        desc="Study cards for key concepts"
                        checked={genOptions.flashcards}
                        onChange={(v: boolean) => setGenOptions(prev => ({...prev, flashcards: v}))}
                        icon="⚡️"
                    />
                    <OptionCheckbox 
                        label="Practice Quiz" 
                        desc="Multiple choice questions to test yourself"
                        checked={genOptions.quiz}
                        onChange={(v: boolean) => setGenOptions(prev => ({...prev, quiz: v}))}
                        icon="🎓"
                    />
                    <OptionCheckbox 
                        label="Study Notes" 
                        desc="Structured markdown notes"
                        checked={genOptions.notes}
                        onChange={(v: boolean) => setGenOptions(prev => ({...prev, notes: v}))}
                        icon="📚"
                    />
                    <OptionCheckbox 
                        label="Mind Map" 
                        desc="Visual diagram of concepts"
                        checked={genOptions.mindmap}
                        onChange={(v: boolean) => setGenOptions(prev => ({...prev, mindmap: v}))}
                        icon={<MapIcon className="w-6 h-6 text-pink-500" />}
                    />
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
                    <button 
                        onClick={() => setShowGenModal(false)}
                        className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        Skip
                    </button>
                    <button 
                        onClick={() => pendingLectureId && processLectureAI(pendingLectureId, genOptions)}
                        className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center gap-2"
                    >
                        <SparklesIcon className="w-4 h-4" />
                        Generate Selected
                    </button>
                </div>
            </div>
        </div>
    );
  };

  const renderYoutubeModal = () => {
      if (!showYoutubeModal) return null;
      
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                    <div className="bg-red-100 p-2 rounded-full text-red-600">
                        <PlayCircleIcon className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Import YouTube Lecture</h3>
                        <p className="text-xs text-slate-500">Auto-fetch transcript and generate study aids.</p>
                    </div>
                </div>

                <div className="p-6">
                    {!fetchedVideoData ? (
                        // Step 1: Input URL
                        <>
                            <label className="block text-sm font-medium text-slate-700 mb-2">YouTube Video URL</label>
                            <input 
                                type="text" 
                                value={youtubeUrl}
                                onChange={(e) => setYoutubeUrl(e.target.value)}
                                placeholder="https://www.youtube.com/watch?v=..."
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-all"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleFetchYoutubeDetails()}
                            />
                            <p className="text-xs text-slate-400 mt-2">
                                Paste the full URL of the video you want to study.
                            </p>
                        </>
                    ) : (
                        // Step 2: Select Language
                        <div className="space-y-4">
                            <div>
                                <h4 className="font-semibold text-slate-900 line-clamp-1">{fetchedVideoData.title}</h4>
                                <p className="text-xs text-slate-500">Video Found</p>
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Select Transcript Language</label>
                                <select 
                                    value={selectedLangIndex}
                                    onChange={(e) => setSelectedLangIndex(Number(e.target.value))}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none bg-white"
                                >
                                    {fetchedVideoData.transcripts.map((t, idx) => (
                                        <option key={idx} value={idx}>
                                            {t.languageCode.toUpperCase()} — {t.text.length < 100 ? 'Short' : 'Full'} Transcript
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-slate-400 mt-2">
                                    {fetchedVideoData.transcripts.length} language(s) available.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
                    <button 
                        onClick={resetYoutubeModal}
                        className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-200 rounded-lg transition-colors"
                        disabled={isFetchingYoutube}
                    >
                        Cancel
                    </button>
                    
                    {!fetchedVideoData ? (
                        <button 
                            onClick={handleFetchYoutubeDetails}
                            disabled={!youtubeUrl.trim() || isFetchingYoutube}
                            className="px-6 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 shadow-sm transition-colors flex items-center gap-2 disabled:opacity-70"
                        >
                            {isFetchingYoutube ? (
                                <>
                                    <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                                    <span>Fetching...</span>
                                </>
                            ) : (
                                <span>Fetch Video</span>
                            )}
                        </button>
                    ) : (
                        <button 
                            onClick={handleConfirmYoutubeImport}
                            className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-colors flex items-center gap-2"
                        >
                            <CheckCircleIcon className="w-4 h-4" />
                            Import Transcript
                        </button>
                    )}
                </div>
            </div>
        </div>
      );
  };

  const OptionCheckbox = ({ label, desc, checked, onChange, icon }: any) => (
      <label className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
          checked ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'
      }`}>
          <div className="text-2xl">{typeof icon === 'string' ? icon : icon}</div>
          <div className="flex-1">
              <div className="font-semibold text-slate-900">{label}</div>
              <div className="text-xs text-slate-500">{desc}</div>
          </div>
          <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
              checked ? 'border-indigo-600 bg-indigo-600' : 'border-slate-300'
          }`}>
              {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
          </div>
          <input type="checkbox" className="hidden" checked={checked} onChange={e => onChange(e.target.checked)} />
      </label>
  );

  const renderSidebar = () => (
    <>
      {/* Mobile/Tablet Backdrop */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-fadeIn"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <div className={`
        fixed inset-y-0 left-0 z-50 bg-white border-r border-slate-200 flex flex-col h-full
        transition-all duration-300 ease-in-out shadow-xl lg:shadow-none
        w-80
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0
        ${isDesktopSidebarOpen ? 'lg:w-80' : 'lg:w-0 lg:overflow-hidden lg:border-none'}
      `}>
        {/* Mobile/Tablet Close Button */}
        <button 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 lg:hidden z-50"
        >
            <XMarkIcon className="w-6 h-6" />
        </button>

        <div className="p-6 border-b border-slate-100 relative">
          <div className="flex items-center gap-2 mb-1">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <SparklesIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Ezi</h1>
          </div>
          <p className="text-xs text-slate-500 font-medium ml-1">AI Lecture Assistant</p>

          {/* Desktop Collapse Button */}
          <button 
            onClick={() => setIsDesktopSidebarOpen(false)}
            className="hidden lg:flex absolute top-5 right-4 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Collapse Sidebar"
          >
              <ChevronLeftIcon className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Action Buttons Row */}
          <div className="flex gap-2 mb-4">
              <button 
                onClick={() => {
                  setViewMode('record');
                  setSelectedLectureId(null);
                  setIsSidebarOpen(false);
                }}
                className="flex-1 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-white py-3 rounded-lg transition-all shadow-md hover:shadow-lg"
                title="New Recording"
              >
                  <MicIcon className="w-6 h-6" />
              </button>
              
              <button 
                onClick={() => {
                  setShowYoutubeModal(true);
                  setIsSidebarOpen(false);
                }}
                className="flex-1 flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 py-3 rounded-lg transition-all shadow-sm"
                title="Import YouTube"
              >
                  <PlayCircleIcon className="w-6 h-6" />
              </button>
          </div>

          <div className="px-1 mb-2">
              <input 
                  type="text" 
                  placeholder="Search lectures..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-100 border-transparent focus:bg-white border focus:border-indigo-300 rounded-lg text-sm text-slate-700 placeholder-slate-400 focus:outline-none transition-all"
              />
          </div>

          {/* Tags Section */}
          {allTags.length > 0 && (
              <div className="px-1 mb-4">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 mt-4 px-1">
                      Categories
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                      <button
                          onClick={() => setSelectedTag(null)}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              selectedTag === null
                              ? 'bg-slate-800 text-white border-slate-800'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                          }`}
                      >
                          All
                      </button>
                      {allTags.map(tag => (
                          <button
                              key={tag}
                              onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
                                  selectedTag === tag
                                  ? 'bg-indigo-600 text-white border-indigo-600'
                                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                              }`}
                          >
                              <HashtagIcon className="w-2.5 h-2.5" />
                              {tag}
                          </button>
                      ))}
                  </div>
              </div>
          )}

          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1 mb-2 mt-4">
              {searchTerm ? 'Search Results' : selectedTag ? `Filed under #${selectedTag}` : 'Recent Lectures'}
          </h3>
          
          {filteredLectures.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              {searchTerm ? 'No lectures match your search.' : selectedTag ? 'No lectures found with this tag.' : 'No lectures recorded yet.'}
            </div>
          ) : (
              filteredLectures.map(lecture => (
              <button
                key={lecture.id}
                onClick={() => {
                  setSelectedLectureId(lecture.id);
                  setViewMode('detail');
                  setIsSidebarOpen(false);
                }}
                className={`w-full text-left p-3 rounded-lg transition-colors group ${
                  selectedLectureId === lecture.id 
                  ? 'bg-indigo-50 text-indigo-700' 
                  : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="font-medium truncate">{lecture.title}</div>
                <div className="text-xs text-slate-500 flex justify-between mt-1 items-center">
                  <span>{new Date(lecture.date).toLocaleDateString()}</span>
                  <span className="flex items-center gap-1">
                      {/* Tiny tag indicator */}
                      {lecture.tags && lecture.tags.length > 0 && (
                          <span className="flex items-center text-[10px] bg-slate-100 px-1.5 rounded text-slate-500">
                            #{lecture.tags[0]} {lecture.tags.length > 1 && `+${lecture.tags.length - 1}`}
                          </span>
                      )}
                      {lecture.flashcards && <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>}
                      {lecture.summary && <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>}
                      {isProcessingId === lecture.id && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50">
          <div className="flex gap-2">
              <button 
                  onClick={() => StorageService.exportData(lectures)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                  <ArrowDownTrayIcon className="w-4 h-4" /> Export
              </button>
              <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                  <ArrowUpTrayIcon className="w-4 h-4" /> Import
              </button>
          </div>
          <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImport} 
              accept=".json" 
              className="hidden" 
          />
        </div>
      </div>
    </>
  );

  const renderContent = () => {
    let existingTitle;
    if (viewMode === 'record' && selectedLectureId) {
        existingTitle = lectures.find(l => l.id === selectedLectureId)?.title;
    }

    if (viewMode === 'record') {
      return (
        <div className="h-full p-[10px]">
            <Recorder 
                onFinish={handleRecordingFinished}
                onCancel={() => {
                    if (selectedLectureId) {
                        setViewMode('detail');
                    } else {
                        setViewMode('dashboard');
                    }
                }}
                existingTitle={existingTitle}
            />
        </div>
      );
    }

    if (viewMode === 'detail' && selectedLectureId) {
      const lecture = lectures.find(l => l.id === selectedLectureId);
      if (lecture) {
        return (
            <div className="h-full p-[10px]">
                <TranscriptView 
                    lecture={lecture} 
                    onBack={() => setViewMode('dashboard')}
                    onUpdate={handleUpdateLecture}
                    onDelete={handleDeleteLecture}
                    onContinueRecording={() => setViewMode('record')}
                    isProcessing={isProcessingId === lecture.id}
                />
            </div>
        );
      }
    }

    return (
      <div className="h-full p-[10px] flex flex-col items-center justify-center text-center bg-white/50">
        <div className="w-20 h-20 md:w-24 md:h-24 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
            <DocumentTextIcon className="w-10 h-10 md:w-12 md:h-12 text-indigo-500" />
        </div>
        <h2 className="text-xl md:text-2xl font-bold text-slate-900 mb-2">Welcome to Ezi</h2>
        <p className="text-slate-500 max-w-md mb-8 text-sm md:text-base">
            Your personal AI study assistant. Record your lectures and let Ezi generate summaries, flashcards, and quizzes automatically.
        </p>
        <div className="flex gap-4">
            <button 
                onClick={() => {
                    setSelectedLectureId(null);
                    setViewMode('record');
                }}
                className="px-6 py-3 bg-indigo-600 text-white rounded-full font-medium hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all hover:scale-105"
            >
                Start Recording
            </button>
            <button 
                onClick={() => setShowYoutubeModal(true)}
                className="px-6 py-3 bg-white text-red-600 border border-red-200 rounded-full font-medium hover:bg-red-50 shadow-sm transition-all hover:scale-105 flex items-center gap-2"
            >
                <PlayCircleIcon className="w-5 h-5" />
                Import YouTube
            </button>
        </div>
        
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 text-left max-w-3xl">
            <Feature title="Transcribe" desc="Real-time speech-to-text recording locally in your browser." />
            <Feature title="Summarize" desc="Get concise AI-generated summaries and key terms." />
            <Feature title="Study" desc="Auto-generate flashcards and quizzes to master the material." />
        </div>
      </div>
    );
  };

  const Feature = ({ title, desc }: { title: string, desc: string }) => (
      <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 md:bg-transparent md:shadow-none md:border-none">
          <h4 className="font-semibold text-slate-900 mb-1">{title}</h4>
          <p className="text-sm text-slate-500">{desc}</p>
      </div>
  );

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans relative">
      {renderSidebar()}
      
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
          {/* Mobile/Tablet Header */}
          <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200 flex-shrink-0 z-20 shadow-sm">
             <div className="flex items-center gap-3">
                 <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 rounded-md text-slate-600 hover:bg-slate-100">
                    <Bars3Icon className="w-6 h-6" />
                 </button>
                 <span className="font-bold text-lg text-slate-900 tracking-tight">Ezi</span>
             </div>
             {/* Optional: Add status indicator or small icon here */}
          </div>

          {/* Desktop Show Sidebar Button (Visible only when sidebar is closed) */}
          {!isDesktopSidebarOpen && (
             <div className="hidden lg:flex items-center p-2 bg-white border-b border-slate-200 flex-shrink-0">
                 <button 
                    onClick={() => setIsDesktopSidebarOpen(true)} 
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-800 px-3 py-1.5 hover:bg-slate-50 rounded-lg transition-colors"
                 >
                     <Bars3Icon className="w-5 h-5" />
                     <span className="text-sm font-medium">Show Menu</span>
                 </button>
             </div>
           )}

          <div className="flex-1 overflow-hidden relative">
            {renderContent()}
          </div>
      </main>
      
      {renderGenerationModal()}
      {renderYoutubeModal()}
    </div>
  );
};

export default App;