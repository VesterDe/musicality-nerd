import { analyze } from 'web-audio-beat-detector';

export class BpmDetector {
	// Event handlers
	public onBpmChanged: ((bpm: number) => void) | null = null;
	public onDetectionComplete: (() => void) | null = null;
	public onDetectionError: ((error: Error) => void) | null = null;

	private isDetecting = false;
	private currentBpm = 120;

	/**
	 * Detect BPM from an AudioBuffer
	 */
	async detectBpm(audioBuffer: AudioBuffer): Promise<number> {
		if (this.isDetecting) {
			throw new Error('BPM detection already in progress');
		}

		this.isDetecting = true;

		try {
			// Use web-audio-beat-detector to analyze the audio
			const bpm = await analyze(audioBuffer);

			// Round to 1 decimal place
			const roundedBpm = Math.round(bpm * 10) / 10;
			
			// Sanity check: reasonable BPM range for dance music
			if (roundedBpm < 60 || roundedBpm > 200) {
				throw new Error(`Detected BPM ${roundedBpm} is outside reasonable range (60-200)`);
			}

			this.currentBpm = roundedBpm;
			this.onBpmChanged?.(roundedBpm);
			this.onDetectionComplete?.();

			return roundedBpm;
		} catch (error) {
			const err = error instanceof Error ? error : new Error('Unknown error during BPM detection');
			this.onDetectionError?.(err);
			throw err;
		} finally {
			this.isDetecting = false;
		}
	}

	/**
	 * Get the last detected BPM
	 */
	getCurrentBpm(): number {
		return this.currentBpm;
	}

	/**
	 * Check if detection is in progress
	 */
	isAnalyzing(): boolean {
		return this.isDetecting;
	}

	/**
	 * Manually set BPM (for override functionality)
	 */
	setManualBpm(bpm: number): void {
		// Sanity check
		if (bpm < 60 || bpm > 200) {
			throw new Error(`BPM ${bpm} is outside reasonable range (60-200)`);
		}
		
		this.currentBpm = Math.round(bpm * 10) / 10;
		this.onBpmChanged?.(this.currentBpm);
	}
}