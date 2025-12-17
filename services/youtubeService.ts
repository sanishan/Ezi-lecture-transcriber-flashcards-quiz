import { TranscriptChunk } from '../types';

// RapidAPI Configuration moved to process.env for security and flexibility
const RAPID_API_HOST = process.env.RAPID_API_HOST;
const RAPID_API_KEY = process.env.RAPID_API_KEY;

export interface TranscriptOption {
    languageCode: string;
    languageName?: string; // Optional, derived from code if needed
    text: string;
    chunks: TranscriptChunk[];
}

export interface YoutubeVideoResult {
    videoId: string;
    title: string;
    transcripts: TranscriptOption[];
}

const extractVideoId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
};

// Helper to convert SRT timestamp "00:00:21,050" to seconds
const parseTimestampToSeconds = (timeStr: string): number => {
    if (!timeStr) return 0;
    const parts = timeStr.split(','); // Split seconds and ms
    const timeParts = parts[0].split(':'); // Split h:m:s
    
    let seconds = 0;
    if (timeParts.length === 3) {
        seconds += parseInt(timeParts[0]) * 3600;
        seconds += parseInt(timeParts[1]) * 60;
        seconds += parseInt(timeParts[2]);
    } else if (timeParts.length === 2) {
        seconds += parseInt(timeParts[0]) * 60;
        seconds += parseInt(timeParts[1]);
    }
    
    // Add milliseconds if present
    if (parts.length > 1) {
        seconds += parseInt(parts[1]) / 1000;
    }
    
    return seconds;
};

// Helper to parse SRT into structured chunks
const parseSrtToChunks = (srtData: string): TranscriptChunk[] => {
    const chunks: TranscriptChunk[] = [];
    // Normalize newlines and split by double newline to separate blocks
    const blocks = srtData.replace(/\r\n/g, '\n').split(/\n\n+/);

    for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) continue;

        // Try to find the timestamp line (contains -->)
        const timeLineIndex = lines.findIndex(l => l.includes('-->'));
        if (timeLineIndex === -1) continue;

        const timeLine = lines[timeLineIndex];
        // Text is everything after the timestamp line
        const textLines = lines.slice(timeLineIndex + 1);
        
        if (textLines.length === 0) continue;

        const startTimeStr = timeLine.split('-->')[0].trim();
        const timestamp = parseTimestampToSeconds(startTimeStr);
        
        // Remove HTML tags and join
        const text = textLines.join(' ').replace(/<[^>]+>/g, '');

        // Avoid adding empty or purely numeric/symbolic noise if possible
        if (text.length > 0) {
            chunks.push({ timestamp, text });
        }
    }
    return chunks;
};

// Helper to clean SRT format to plain text (kept for legacy/AI context)
const parseSrtToText = (srtData: string): string => {
    return srtData
        .replace(/\r\n/g, '\n')
        .replace(/\n\n+/g, '\n') // Normalize newlines
        .replace(/^\d+$/gm, '') // Remove sequence numbers
        .replace(/^[\d:,]+ --> [\d:,]+.*$/gm, '') // Remove timestamps
        .replace(/<[^>]+>/g, '') // Remove HTML tags
        .split('\n')
        .map(line => line.trim())
        .filter(line => line) // Remove empty lines
        // Simple deduplication for lines that might repeat exactly (common in some captions)
        .filter((line, index, self) => index === 0 || line !== self[index - 1])
        .join(' ');
};

const fetchVideoTitle = async (videoId: string): Promise<string> => {
    try {
        // Use Noembed or YouTube oEmbed as a public way to get title without API key
        const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await response.json();
        return data.title || `YouTube Video ${videoId}`;
    } catch (e) {
        console.warn("Failed to fetch title via oEmbed", e);
        return `YouTube Video ${videoId}`;
    }
};

export const getYoutubeVideoDetails = async (url: string): Promise<YoutubeVideoResult> => {
    const videoId = extractVideoId(url);
    if (!videoId) {
        throw new Error("Invalid YouTube URL");
    }

    // Ensure RapidAPI is configured before making requests
    if (!RAPID_API_KEY || !RAPID_API_HOST) {
        throw new Error("RapidAPI configuration missing. Please ensure RAPID_API_KEY and RAPID_API_HOST are set in your environment variables.");
    }

    // 1. Fetch Title (Parallel)
    const titlePromise = fetchVideoTitle(videoId);

    // 2. Fetch Transcripts via RapidAPI
    const rapidApiUrl = `https://${RAPID_API_HOST}/download-all/${videoId}?format_subtitle=srt&format_answer=json`;
    
    const transcriptResponsePromise = fetch(rapidApiUrl, {
        method: 'GET',
        headers: {
            'x-rapidapi-host': RAPID_API_HOST,
            'x-rapidapi-key': RAPID_API_KEY
        }
    });

    const [title, response] = await Promise.all([titlePromise, transcriptResponsePromise]);

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to fetch transcripts: ${response.status} ${errText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
        throw new Error("No transcripts found for this video.");
    }

    const transcripts: TranscriptOption[] = data.map((item: any) => ({
        languageCode: item.languageCode,
        text: parseSrtToText(item.subtitle),
        chunks: parseSrtToChunks(item.subtitle)
    }));

    // Filter out empty transcripts
    const validTranscripts = transcripts.filter(t => t.text.length > 50);

    if (validTranscripts.length === 0) {
        throw new Error("Transcripts were found but appeared to be empty.");
    }

    return {
        videoId,
        title,
        transcripts: validTranscripts
    };
};