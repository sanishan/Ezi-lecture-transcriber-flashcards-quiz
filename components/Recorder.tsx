import React, { useState, useEffect, useRef } from 'react';
import { MicIcon, StopIcon } from './icons';
import { TranscriptChunk } from '../types';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

interface RecordingResult {
    startTime: string;
    endTime: string;
    duration: number;
    text: string;
    chunks: TranscriptChunk[];
}

interface RecorderProps {
    onFinish: (result: RecordingResult) => void;
    onCancel: () => void;
    existingTitle?: string;
}

// Audio encoding helpers
function encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        const s = Math.max(-1, Math.min(1, data[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

const Recorder: React.FC<RecorderProps> = ({ onFinish, onCancel, existingTitle }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [elapsedTime, setElapsedTime] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [startTime, setStartTime] = useState<string | null>(null);

    // Microphone Selection State
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [previewVolume, setPreviewVolume] = useState(0);

    // Refs
    const chunksRef = useRef<TranscriptChunk[]>([]);
    const currentTurnRef = useRef('');
    const turnStartTimeRef = useRef<number>(0);
    const isTurnActiveRef = useRef(false);
    const elapsedTimeRef = useRef(0);

    // Media/Session Refs
    const streamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const sessionRef = useRef<any>(null);
    const timerRef = useRef<number | null>(null);

    // Preview Refs
    const previewContextRef = useRef<AudioContext | null>(null);
    const previewStreamRef = useRef<MediaStream | null>(null);
    const previewAnimationFrameRef = useRef<number | null>(null);

    // Cleanup function
    const stopEverything = () => {
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }
        if (sourceRef.current) {
            sourceRef.current.disconnect();
            sourceRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (sessionRef.current) {
            sessionRef.current = null;
        }
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setIsRecording(false);
    };

    const stopPreview = () => {
        if (previewAnimationFrameRef.current) {
            cancelAnimationFrame(previewAnimationFrameRef.current);
            previewAnimationFrameRef.current = null;
        }
        if (previewStreamRef.current) {
            previewStreamRef.current.getTracks().forEach(t => t.stop());
            previewStreamRef.current = null;
        }
        if (previewContextRef.current) {
            previewContextRef.current.close();
            previewContextRef.current = null;
        }
        setPreviewVolume(0);
    };

    const startPreview = async (deviceId: string) => {
        stopPreview();
        if (!deviceId) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: deviceId } }
            });
            previewStreamRef.current = stream;

            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            previewContextRef.current = ctx;

            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.5;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const updateVolume = () => {
                if (!previewStreamRef.current?.active) return;
                analyser.getByteFrequencyData(dataArray);
                const sum = dataArray.reduce((a, b) => a + b, 0);
                const avg = sum / dataArray.length;
                // Normalize roughly to 0-100 scale for UI
                setPreviewVolume(Math.min(100, (avg / 50) * 100));
                previewAnimationFrameRef.current = requestAnimationFrame(updateVolume);
            };
            updateVolume();
        } catch (e) {
            console.warn("Preview stream failed", e);
        }
    };

    // Initialize devices on mount
    useEffect(() => {
        const initDevices = async () => {
            try {
                // Request permission first to ensure we get labels
                const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                tempStream.getTracks().forEach(t => t.stop());

                const devices = await navigator.mediaDevices.enumerateDevices();
                const audioInputs = devices.filter(d => d.kind === 'audioinput');
                setDevices(audioInputs);

                if (audioInputs.length > 0) {
                    // Try to restore previous selection, or pick default
                    const defaultDevice = audioInputs.find(d => d.deviceId === 'default');
                    const initialId = defaultDevice ? defaultDevice.deviceId : audioInputs[0].deviceId;
                    setSelectedDeviceId(initialId);
                }
            } catch (e) {
                console.error("Device enumeration failed", e);
                setError("Please enable microphone access to record.");
            }
        };
        initDevices();

        return () => {
            stopEverything();
            stopPreview();
        };
    }, []);

    // Manage preview lifecycle
    useEffect(() => {
        if (isRecording) {
            stopPreview();
        } else if (selectedDeviceId && !transcript) {
            // Only preview if not recording and transcript is empty (setup phase)
            // Or if we just want to allow monitoring when paused. 
            // Let's stick to setup phase for now to save battery/resources.
            startPreview(selectedDeviceId);
        }
        return () => stopPreview();
    }, [selectedDeviceId, isRecording, transcript]);

    const startRecording = async () => {
        setError(null);
        setTranscript('');
        setElapsedTime(0);
        elapsedTimeRef.current = 0;
        const start = new Date().toISOString();
        setStartTime(start);

        chunksRef.current = [];
        currentTurnRef.current = '';
        isTurnActiveRef.current = false;
        turnStartTimeRef.current = 0;

        // Stop the preview stream before starting the actual recording stream
        stopPreview();

        try {
            if (!process.env.API_KEY) {
                throw new Error("API Key not found");
            }

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const audioContext = new AudioContextClass({ sampleRate: 16000 });
            audioContextRef.current = audioContext;

            // Use the selected device ID
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
                    channelCount: 1,
                    sampleRate: 16000
                }
            });
            streamRef.current = stream;

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    systemInstruction: "You are a professional stenographer. Transcribe the user's speech exactly as spoken.",
                },
                callbacks: {
                    onopen: () => {
                        setIsRecording(true);

                        timerRef.current = window.setInterval(() => {
                            setElapsedTime(prev => prev + 1);
                            elapsedTimeRef.current += 1;
                        }, 1000);

                        const source = audioContext.createMediaStreamSource(stream);
                        sourceRef.current = source;

                        const processor = audioContext.createScriptProcessor(4096, 1, 1);
                        processorRef.current = processor;

                        processor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromise.then(session => {
                                sessionRef.current = session;
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };

                        source.connect(processor);
                        processor.connect(audioContext.destination);
                    },
                    onmessage: (message: LiveServerMessage) => {
                        const content = message.serverContent;
                        let needsUpdate = false;

                        if (content?.inputTranscription) {
                            let text = content.inputTranscription.text;
                            if (text) {
                                if (!isTurnActiveRef.current) {
                                    isTurnActiveRef.current = true;
                                    turnStartTimeRef.current = elapsedTimeRef.current;

                                    if (chunksRef.current.length > 0) {
                                        const lastChunk = chunksRef.current[chunksRef.current.length - 1];
                                        if (lastChunk.text.length > 5 && text.startsWith(lastChunk.text)) {
                                            text = text.substring(lastChunk.text.length);
                                        }
                                    }
                                }
                                currentTurnRef.current += text;
                                needsUpdate = true;
                            }
                        }

                        if (content?.turnComplete) {
                            if (currentTurnRef.current.trim()) {
                                const newChunk: TranscriptChunk = {
                                    timestamp: turnStartTimeRef.current,
                                    text: currentTurnRef.current.trim()
                                };
                                chunksRef.current.push(newChunk);
                            }
                            currentTurnRef.current = '';
                            isTurnActiveRef.current = false;
                            needsUpdate = true;
                        }

                        if (needsUpdate) {
                            const committedText = chunksRef.current.map(c => c.text).join(' ');
                            const currentText = currentTurnRef.current;
                            const fullText = committedText + (committedText && currentText ? ' ' : '') + currentText;
                            setTranscript(fullText);
                        }
                    },
                    onclose: () => setIsRecording(false),
                    onerror: (e) => {
                        let msg = "Connection error. Please try again.";
                        if (e instanceof Error) msg = e.message;
                        setError(msg);
                        stopEverything();
                    }
                }
            });

        } catch (err: any) {
            setError(err.message || "Could not start recording");
            stopEverything();
        }
    };

    const toggleRecording = () => {
        if (isRecording) {
            stopEverything();
        } else {
            startRecording();
        }
    };

    const handleFinish = () => {
        if (isRecording) stopEverything();

        if (currentTurnRef.current.trim()) {
            const newChunk: TranscriptChunk = {
                timestamp: turnStartTimeRef.current || elapsedTimeRef.current,
                text: currentTurnRef.current.trim()
            };
            chunksRef.current.push(newChunk);
        }

        if (chunksRef.current.length === 0) {
            if (!confirm("Transcript is empty. Save anyway?")) return;
        }

        const finalTranscript = chunksRef.current.map(c => c.text).join(' ');

        onFinish({
            startTime: startTime || new Date().toISOString(),
            endTime: new Date().toISOString(),
            duration: elapsedTime,
            text: finalTranscript,
            chunks: chunksRef.current
        });
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                    <h2 className="text-lg font-semibold text-slate-800">
                        {existingTitle ? `Continuing: ${existingTitle}` : 'New Recording'}
                    </h2>
                    <p className="text-sm text-slate-500">Live Transcription (Gemini AI)</p>
                </div>
                <div className="font-mono text-xl font-medium text-slate-700">
                    {formatTime(elapsedTime)}
                </div>
            </div>

            {/* Transcript Area */}
            <div className="flex-1 p-6 overflow-y-auto bg-white">
                {error ? (
                    <div className="h-full flex flex-col items-center justify-center text-red-500">
                        <p className="mb-4 text-center px-4">{error}</p>
                        <button onClick={() => setError(null)} className="text-sm underline">Dismiss</button>
                    </div>
                ) : transcript ? (
                    <div className="text-lg leading-relaxed text-slate-800">
                        {chunksRef.current.map((chunk, idx) => (
                            <span key={idx} title={`Timestamp: ${formatTime(chunk.timestamp)}`}>
                                {chunk.text}{' '}
                            </span>
                        ))}
                        <p className="whitespace-pre-wrap inline">
                            {currentTurnRef.current}
                            {isRecording && <span className="animate-pulse text-blue-500 ml-1">|</span>}
                        </p>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <MicIcon className="w-16 h-16 mb-4 opacity-20" />
                        <p className="mb-6 text-center">Press the microphone button to start recording...</p>

                        {/* Microphone Selection & Visualizer */}
                        <div className="w-full max-w-sm bg-slate-50 p-4 rounded-xl border border-slate-100 flex flex-col gap-3">
                            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Select Microphone</label>
                            <select
                                value={selectedDeviceId}
                                onChange={(e) => setSelectedDeviceId(e.target.value)}
                                className="w-full p-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {devices.map(device => (
                                    <option key={device.deviceId} value={device.deviceId}>
                                        {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
                                    </option>
                                ))}
                                {devices.length === 0 && <option value="">Default Microphone</option>}
                            </select>

                            <div className="mt-1">
                                <div className="flex justify-between text-xs text-slate-500 mb-1">
                                    <span>Input Level</span>
                                    <span>{Math.round(previewVolume)}%</span>
                                </div>
                                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-green-500 transition-all duration-100 ease-out"
                                        style={{ width: `${previewVolume}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-center gap-6">
                <button
                    onClick={onCancel}
                    className="px-6 py-3 rounded-full text-slate-600 font-medium hover:bg-slate-200 transition-colors"
                >
                    Cancel
                </button>

                <button
                    onClick={toggleRecording}
                    className={`h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${isRecording
                            ? 'bg-red-500 hover:bg-red-600 ring-4 ring-red-200'
                            : 'bg-indigo-600 hover:bg-indigo-700 ring-4 ring-indigo-200'
                        }`}
                >
                    {isRecording ? (
                        <StopIcon className="w-8 h-8 text-white" />
                    ) : (
                        <MicIcon className="w-8 h-8 text-white" />
                    )}
                </button>

                <button
                    onClick={handleFinish}
                    disabled={transcript.length === 0 && !isRecording}
                    className="px-6 py-3 rounded-full bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    Finish & Save
                </button>
            </div>

            {isRecording && (
                <div className="absolute top-4 right-4 h-3 w-3 bg-red-500 rounded-full animate-ping"></div>
            )}
        </div>
    );
};

export default Recorder;