/**
 * Core data types for Music Nerd application
 */

export interface Beat {
	index: number;
	time: number;
}


export interface Annotation {
	id: string;
	startTimeMs: number; // Absolute start time in milliseconds from song beginning
	endTimeMs: number; // Absolute end time in milliseconds from song beginning (for point annotations: startTimeMs === endTimeMs)
	label: string;
	color: string;
	isPoint?: boolean; // True for point annotations, false/undefined for duration annotations
	rowIndex?: number; // For vertical stacking when annotations overlap
}

export interface Stem {
	id: string;
	filename: string;
	mp3Blob: ArrayBuffer;
	enabled: boolean; // Whether this stem is currently playing
	color?: string; // Optional color for visualization
	downloadBlob?: Blob; // Optional blob for downloading (preserved from ffmpeg extraction)
}

export interface TrackSession {
	id: string;
	mp3Blob?: ArrayBuffer; // Optional for backward compatibility - required when mode === 'single', not used when mode === 'stem'
	filename: string;
	created: string; // ISO date string
	bpm: number;
	beatOffset: number; // Offset in milliseconds
	manualBpm: boolean; // Whether BPM was manually set
	beatsPerLine: number; // Number of beats per chunk/line in spectrogram
	beats: Beat[];
	annotations: Annotation[]; // Array of annotations with absolute timing
	targetBPM: number; // Target BPM for practice
	rectsPerBeatMode?: 'auto' | number; // 'auto' for automatic selection between 8 and upper limit, or a number for manual value
	mode?: 'single' | 'stem'; // Session mode - defaults to 'single' for backward compatibility
	stems?: Stem[]; // Array of stems for stem mode sessions
}

export interface SpectrogramConfig {
	fftSize: number;
	overlap: number;
	colorMap: string;
}

export interface AudioAnalysisData {
	timeData: Float32Array;
	frequencyData: Float32Array;
	currentTime: number;
	duration: number;
} 