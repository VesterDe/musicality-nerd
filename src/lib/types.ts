/**
 * Core data types for Music Nerd application
 */

export interface Beat {
	index: number;
	time: number;
	tags: string[];
}

export interface Tag {
	label: string;
	color: string;
}

export interface TrackSession {
	id: string;
	mp3Blob: ArrayBuffer;
	filename: string;
	created: string; // ISO date string
	bpm: number;
	beatOffset: number; // Offset in milliseconds
	manualBpm: boolean; // Whether BPM was manually set
	beats: Beat[];
	tags: Record<string, Tag>;
}

export interface SpectrogramConfig {
	fftSize: number;
	overlap: number;
	colorMap: string;
}

export interface BeatGridConfig {
	groupByFour: boolean;
	snapLength: number; // in beats
}

export interface AudioAnalysisData {
	timeData: Float32Array;
	frequencyData: Float32Array;
	currentTime: number;
	duration: number;
} 