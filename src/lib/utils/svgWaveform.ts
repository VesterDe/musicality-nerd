/**
 * SVG Waveform Utilities
 * Functions for processing audio peak data and generating SVG waveform visualizations
 */

export interface ChunkBounds {
	startSample: number;
	endSample: number;
	startTimeMs: number;
	endTimeMs: number;
}

export interface WaveformConfig {
	width: number;
	height: number;
	sampleRate: number;
	audioDuration: number;
	beatOffset: number;
	chunkDuration: number;
}

/**
 * Calculate sample bounds for a specific chunk
 */
export function calculateChunkBounds(
	chunkIndex: number,
	config: WaveformConfig
): ChunkBounds {
	const { sampleRate, audioDuration, beatOffset, chunkDuration } = config;
	
	let chunkStartTime: number;
	let chunkEndTime: number;
	
	if (chunkIndex === -1) {
		// Special pre-song chunk - represents time before song starts
		// This chunk shows the transition from "no audio" to "audio starts"
		if (beatOffset > 0) {
			// Positive offset: song starts partway through the chunk
			// We need audio from 0 to (chunkDuration - offsetInSeconds)
			const offsetInSeconds = beatOffset / 1000;
			chunkStartTime = 0;
			chunkEndTime = chunkDuration - offsetInSeconds;
		} else if (beatOffset < 0) {
			// Negative offset: chunk -1 shows only the first bit of audio
			// that gets "pushed into" the pre-song space
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			chunkStartTime = 0;
			chunkEndTime = offsetInSeconds; // Only show this much audio
		} else {
			// No offset - chunk -1 shouldn't exist, but handle gracefully
			chunkStartTime = 0;
			chunkEndTime = 0;
		}
	} else {
		if (beatOffset > 0) {
			const offsetInSeconds = beatOffset / 1000;
			chunkStartTime = chunkDuration - offsetInSeconds + chunkIndex * chunkDuration;
			chunkEndTime = chunkDuration - offsetInSeconds + (chunkIndex + 1) * chunkDuration;
		} else if (beatOffset < 0) {
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			chunkStartTime = chunkIndex * chunkDuration + offsetInSeconds;
			chunkEndTime = (chunkIndex + 1) * chunkDuration + offsetInSeconds;
		} else {
			chunkStartTime = chunkIndex * chunkDuration;
			chunkEndTime = (chunkIndex + 1) * chunkDuration;
		}
	}
	
	// Ensure we don't go beyond audio bounds
	chunkStartTime = Math.max(0, chunkStartTime);
	chunkEndTime = Math.min(audioDuration, chunkEndTime);
	
	const startSample = Math.floor(chunkStartTime * sampleRate);
	const endSample = Math.floor(chunkEndTime * sampleRate);
	
	return {
		startSample,
		endSample,
		startTimeMs: chunkStartTime * 1000,
		endTimeMs: chunkEndTime * 1000
	};
}

/**
 * Downsample peak data for efficient rendering
 * Groups samples into visual bars with min/max values
 */
export function downsamplePeaks(
	peaksData: Float32Array,
	startSample: number,
	endSample: number,
	targetBars: number
): Array<{ min: number; max: number }> {
	const sampleCount = endSample - startSample;
	const samplesPerBar = Math.max(1, Math.floor(sampleCount / targetBars));
	const bars: Array<{ min: number; max: number }> = [];
	
	for (let i = 0; i < targetBars; i++) {
		const barStart = startSample + i * samplesPerBar;
		const barEnd = Math.min(endSample, barStart + samplesPerBar);
		
		let min = 0;
		let max = 0;
		
		for (let j = barStart; j < barEnd; j++) {
			if (j < peaksData.length) {
				const sample = peaksData[j];
				min = Math.min(min, sample);
				max = Math.max(max, sample);
			}
		}
		
		bars.push({ min, max });
	}
	
	return bars;
}

/**
 * Generate SVG path for smooth waveform curve
 */
export function generateSmoothWaveformPath(
	peaksData: Float32Array,
	bounds: ChunkBounds,
	width: number,
	height: number,
	targetPoints: number = 200
): string {
	const { startSample, endSample } = bounds;
	const sampleCount = endSample - startSample;
	const samplesPerPoint = Math.max(1, Math.floor(sampleCount / targetPoints));
	
	const points: Array<{ x: number; y: number }> = [];
	const centerY = height / 2;
	
	for (let i = 0; i < targetPoints; i++) {
		const sampleIndex = startSample + i * samplesPerPoint;
		
		if (sampleIndex >= peaksData.length) break;
		
		const amplitude = peaksData[sampleIndex];
		const x = (i / (targetPoints - 1)) * width;
		const y = centerY - (amplitude * centerY * 0.8); // 80% of available height
		
		points.push({ x, y });
	}
	
	if (points.length === 0) return '';
	
	// Create smooth SVG path using quadratic bezier curves
	let path = `M ${points[0].x} ${points[0].y}`;
	
	for (let i = 1; i < points.length; i++) {
		const curr = points[i];
		
		if (i === points.length - 1) {
			// Last point - straight line
			path += ` L ${curr.x} ${curr.y}`;
		} else {
			// Smooth curve to next point
			const next = points[i + 1];
			const cpX = curr.x;
			const cpY = (curr.y + next.y) / 2;
			path += ` Q ${cpX} ${curr.y} ${(curr.x + next.x) / 2} ${cpY}`;
		}
	}
	
	return path;
}

/**
 * Generate SVG bars for waveform visualization
 */
export function generateWaveformBars(
	peaksData: Float32Array,
	bounds: ChunkBounds,
	width: number,
	height: number,
	targetBars: number = 100,
	chunkIndex?: number,
	beatOffset?: number,
	chunkDuration?: number
): Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> {
	// Special handling for chunk -1 (pre-song chunk with offset)
	if (chunkIndex === -1 && beatOffset !== undefined && chunkDuration !== undefined) {
		return generatePreSongChunkBars(peaksData, bounds, width, height, targetBars, beatOffset, chunkDuration);
	}

	const { startSample, endSample } = bounds;
	const bars = downsamplePeaks(peaksData, startSample, endSample, targetBars);
	const barWidth = width / targetBars;
	const centerY = height / 2;
	
	return bars.map((bar, index) => {
		const amplitude = Math.max(Math.abs(bar.min), Math.abs(bar.max));
		const barHeight = amplitude * centerY * 0.8; // 80% of available height
		
		return {
			x: index * barWidth,
			y: centerY - barHeight / 2,
			width: Math.max(1, barWidth - 1), // Small gap between bars
			height: Math.max(1, barHeight),
			isEmpty: false // Regular chunks are never empty
		};
	});
}

/**
 * Generate waveform bars for chunk -1 (pre-song chunk with offset)
 */
function generatePreSongChunkBars(
	peaksData: Float32Array,
	bounds: ChunkBounds,
	width: number,
	height: number,
	targetBars: number,
	beatOffset: number,
	chunkDuration: number
): Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> {
	const barWidth = width / targetBars;
	const centerY = height / 2;
	const offsetInSeconds = Math.abs(beatOffset) / 1000;

	if (beatOffset > 0) {
		// Positive offset: song appears after the offset time
		const songStartPosition = offsetInSeconds / chunkDuration;
		const songStartBar = Math.floor(songStartPosition * targetBars);
		
		// Only generate song bars, no empty bars (empty area handled by SVG rect)
		const bars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> = [];
		const songBarsCount = targetBars - songStartBar;
		
		if (songBarsCount > 0 && bounds.endSample > bounds.startSample) {
			const songPeaks = downsamplePeaks(peaksData, bounds.startSample, bounds.endSample, songBarsCount);
			
			songPeaks.forEach((bar, index) => {
				const amplitude = Math.max(Math.abs(bar.min), Math.abs(bar.max));
				const barHeight = amplitude * centerY * 0.8;
				
				bars.push({
					x: (songStartBar + index) * barWidth,
					y: centerY - barHeight / 2,
					width: Math.max(1, barWidth - 1),
					height: Math.max(1, barHeight),
					isEmpty: false
				});
			});
		}
		
		return bars;
	} else if (beatOffset < 0) {
		// Negative offset: song appears after empty space
		const songPosition = (chunkDuration - offsetInSeconds) / chunkDuration;
		const songStartBar = Math.floor(songPosition * targetBars);
		
		// Only generate song bars, no empty bars (empty area handled by SVG rect)
		const bars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> = [];
		const songBarsCount = targetBars - songStartBar;
		
		if (songBarsCount > 0 && bounds.endSample > bounds.startSample) {
			const songPeaks = downsamplePeaks(peaksData, bounds.startSample, bounds.endSample, songBarsCount);
			
			songPeaks.forEach((bar, index) => {
				const amplitude = Math.max(Math.abs(bar.min), Math.abs(bar.max));
				const barHeight = amplitude * centerY * 0.8;
				
				bars.push({
					x: (songStartBar + index) * barWidth,
					y: centerY - barHeight / 2,
					width: Math.max(1, barWidth - 1),
					height: Math.max(1, barHeight),
					isEmpty: false
				});
			});
		}
		
		return bars;
	}

	// Fallback - shouldn't reach here for chunk -1
	return [];
}

/**
 * Generate beat grid lines for a chunk
 */
export function generateBeatGrid(
	beatsPerChunk: number,
	width: number,
	_height: number
): Array<{ x: number; type: 'quarter' | 'beat' }> {
	const lines: Array<{ x: number; type: 'quarter' | 'beat' }> = [];
	
	// Skip start (i=0) and end (i=beatsPerChunk) markers
	for (let i = 1; i < beatsPerChunk; i++) {
		const x = (i / beatsPerChunk) * width;
		
		let type: 'quarter' | 'beat';
		if (i % 4 === 0) {
			type = 'quarter';
		} else {
			type = 'beat';
		}
		
		lines.push({ x, type });
	}
	
	return lines;
}

/**
 * Convert time position to pixel coordinate within a chunk
 */
export function timeToPixel(
	timeMs: number,
	chunkBounds: ChunkBounds,
	width: number
): number {
	const { startTimeMs, endTimeMs } = chunkBounds;
	const progress = (timeMs - startTimeMs) / (endTimeMs - startTimeMs);
	return Math.max(0, Math.min(width, progress * width));
}

/**
 * Convert pixel coordinate to time position within a chunk
 */
export function pixelToTime(
	x: number,
	chunkBounds: ChunkBounds,
	width: number
): number {
	const { startTimeMs, endTimeMs } = chunkBounds;
	const progress = Math.max(0, Math.min(1, x / width));
	return startTimeMs + progress * (endTimeMs - startTimeMs);
}