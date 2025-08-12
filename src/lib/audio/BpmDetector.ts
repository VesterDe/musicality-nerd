// Dynamically import analyzer in browser to avoid bundling it in SSR build
let analyze: ((audioBuffer: AudioBuffer) => Promise<number>) | null = null;

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
    if (!analyze) {
      // Only load in the browser
      if (typeof window === 'undefined') {
        throw new Error('BPM detection not available during SSR');
      }
      const mod = await import('web-audio-beat-detector');
      analyze = mod.analyze as (buf: AudioBuffer) => Promise<number>;
    }
		if (this.isDetecting) {
			throw new Error('BPM detection already in progress');
		}

		this.isDetecting = true;

		try {
			// Use web-audio-beat-detector to analyze the audio
      const bpm = await analyze(audioBuffer);

			// Round to 1 decimal place
			const roundedBpm = Math.round(bpm * 10) / 10;
      console.log('bpm rounding', {
        bpm,
        roundedBpm,
      });

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