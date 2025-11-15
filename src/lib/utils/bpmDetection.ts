import type { AudioEngine } from '$lib/audio/AudioEngine';
import type { BpmDetector } from '$lib/audio/BpmDetector';
import { sessionStore } from '$lib/stores/sessionStore.svelte';

/**
 * Detect BPM with fallback to multiple stems if in stem mode
 * Tries stems in priority order: drums/percussion > bass > others
 */
export async function detectBpmWithStemFallback(
	audioEngine: AudioEngine,
	bpmDetector: BpmDetector
): Promise<number> {
	// If not in stem mode, use standard single-buffer detection
	if (!audioEngine.isInStemMode) {
		const audioBuffer = audioEngine.getAudioBuffer();
		if (!audioBuffer) {
			throw new Error('No audio buffer available');
		}
		return await bpmDetector.detectBpm(audioBuffer);
	}

	// In stem mode, try multiple stems in priority order
	const stemBuffers = audioEngine.getStemBuffers();
	const session = sessionStore.currentSession;
	
	if (!session || !session.stems || stemBuffers.length === 0) {
		throw new Error('No stems available for BPM detection');
	}

	// Build priority-ordered list of stem indices
	// Priority: drums/percussion > bass > others (in original order)
	const stemIndices: number[] = [];
	const drumsIndices: number[] = [];
	const bassIndices: number[] = [];
	const otherIndices: number[] = [];

	for (let i = 0; i < session.stems.length && i < stemBuffers.length; i++) {
		const stem = session.stems[i];
		const filenameLower = stem.filename.toLowerCase();
		
		if (filenameLower.includes('drum') || filenameLower.includes('hihat') || 
		    filenameLower.includes('perc') || filenameLower.includes('beat')) {
			drumsIndices.push(i);
		} else if (filenameLower.includes('bass')) {
			bassIndices.push(i);
		} else {
			otherIndices.push(i);
		}
	}

	// Combine in priority order
	stemIndices.push(...drumsIndices, ...bassIndices, ...otherIndices);

	// Try each stem in priority order
	let lastError: Error | null = null;
	for (const index of stemIndices) {
		const buffer = stemBuffers[index];
		const stem = session.stems[index];
		
		if (!buffer) continue;

		try {
			const bpm = await bpmDetector.detectBpm(buffer);
			console.log(`BPM detected successfully from stem "${stem.filename}" (index ${index}): ${bpm} BPM`);
			return bpm;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			lastError = err;
			console.warn(`BPM detection failed for stem "${stem.filename}" (index ${index}):`, err.message);
			// Continue to next stem
		}
	}

	// All stems failed
	if (lastError) {
		throw lastError;
	}
	throw new Error('No stems available for BPM detection');
}

