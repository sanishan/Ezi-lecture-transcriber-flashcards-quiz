import { LectureData } from '../types';

const STORAGE_KEY = 'kragle_transcripts';

export const saveLecture = (lecture: LectureData): void => {
  const existingStr = localStorage.getItem(STORAGE_KEY);
  let lectures: LectureData[] = existingStr ? JSON.parse(existingStr) : [];
  
  const index = lectures.findIndex(l => l.id === lecture.id);
  if (index >= 0) {
    lectures[index] = lecture;
  } else {
    lectures.push(lecture);
  }
  
  // Sort by date desc
  lectures.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lectures));
  } catch (e) {
    console.error("Storage full or error", e);
    alert("Local storage is full. Please export and delete old transcripts.");
  }
};

export const getLectures = (): LectureData[] => {
  const existingStr = localStorage.getItem(STORAGE_KEY);
  if (!existingStr) return [];
  try {
    const data = JSON.parse(existingStr);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("Error parsing storage", e);
    return [];
  }
};

export const getLectureById = (id: string): LectureData | undefined => {
  const lectures = getLectures();
  return lectures.find(l => l.id === id);
};

export const deleteLecture = (id: string): void => {
  const lectures = getLectures();
  const filtered = lectures.filter(l => l.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

export const exportData = (lectures: LectureData[]): void => {
  const dataStr = JSON.stringify({
    app: "Ezi",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    data: lectures
  }, null, 2);
  
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Ezi_export_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const importData = (file: File): Promise<number> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        
        if (!parsed.data || !Array.isArray(parsed.data)) {
          throw new Error("Invalid format");
        }

        const newLectures = parsed.data as LectureData[];
        const currentLectures = getLectures();
        
        // Merge strategy: Add if ID doesn't exist, skip if it does (simplistic for now)
        let addedCount = 0;
        newLectures.forEach(nl => {
            if (!currentLectures.find(cl => cl.id === nl.id)) {
                currentLectures.push(nl);
                addedCount++;
            }
        });

        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentLectures));
        resolve(addedCount);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsText(file);
  });
};
