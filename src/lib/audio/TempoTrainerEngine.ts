import type { AudioEngine } from './AudioEngine';

export type MetronomeSoundType = 'beep' | 'click' | 'woodblock';

interface MetronomeConfig {
	startBpm: number;
	endBpm: number;
	durationSeconds: number;
	sound: MetronomeSoundType;
}

interface SegmentConfig {
	audioEngine: AudioEngine;
	songBpm: number;
	startBpm: number;
	endBpm: number;
	durationSeconds: number;
	segmentStart: number;
	segmentEnd: number;
}

export class TempoTrainerEngine {
	private audioContext: AudioContext | null = null;
	private isRunning = false;
	private animationFrameId: number | null = null;
	private schedulerIntervalId: number | null = null;

	// Metronome state
	private nextClickTime = 0;
	private startTime = 0;
	private config: MetronomeConfig | null = null;

	// Segment state
	private segmentConfig: SegmentConfig | null = null;
	private segmentStartTimestamp = 0;

	// Scheduling constants
	private readonly LOOKAHEAD_MS = 25; // Check schedule every 25ms
	private readonly SCHEDULE_AHEAD_TIME = 0.1; // Schedule clicks 100ms ahead

	// Progress callbacks
	public onProgress: ((progress: number, currentBpm: number) => void) | null = null;
	public onComplete: (() => void) | null = null;

	/**
	 * Initialize the audio context
	 */
	private async ensureAudioContext(): Promise<AudioContext> {
		if (!this.audioContext) {
			this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		}

		if (this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
		}

		return this.audioContext;
	}

	/**
	 * Calculate current BPM based on linear interpolation
	 */
	private calculateCurrentBpm(elapsed: number, durationSeconds: number, startBpm: number, endBpm: number): number {
		const progress = Math.min(1, elapsed / durationSeconds);
		return startBpm + (endBpm - startBpm) * progress;
	}

	/**
	 * Generate a click sound
	 */
	private scheduleClick(time: number, sound: MetronomeSoundType): void {
		if (!this.audioContext) return;

		switch (sound) {
			case 'beep':
				this.scheduleBeep(time);
				break;
			case 'click':
				this.scheduleNoiseBurst(time);
				break;
			case 'woodblock':
				this.scheduleWoodblock(time);
				break;
		}
	}

	/**
	 * Schedule a beep sound (1000Hz sine wave)
	 */
	private scheduleBeep(time: number): void {
		if (!this.audioContext) return;

		const oscillator = this.audioContext.createOscillator();
		const gainNode = this.audioContext.createGain();

		oscillator.type = 'sine';
		oscillator.frequency.value = 1000;

		gainNode.gain.setValueAtTime(0.5, time);
		gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

		oscillator.connect(gainNode);
		gainNode.connect(this.audioContext.destination);

		oscillator.start(time);
		oscillator.stop(time + 0.05);
	}

	/**
	 * Schedule a click sound (noise burst)
	 */
	private scheduleNoiseBurst(time: number): void {
		if (!this.audioContext) return;

		const bufferSize = this.audioContext.sampleRate * 0.02; // 20ms of noise
		const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
		const data = buffer.getChannelData(0);

		// Generate white noise
		for (let i = 0; i < bufferSize; i++) {
			data[i] = Math.random() * 2 - 1;
		}

		const source = this.audioContext.createBufferSource();
		const gainNode = this.audioContext.createGain();
		const filter = this.audioContext.createBiquadFilter();

		source.buffer = buffer;
		filter.type = 'highpass';
		filter.frequency.value = 1500;

		gainNode.gain.setValueAtTime(0.3, time);
		gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.02);

		source.connect(filter);
		filter.connect(gainNode);
		gainNode.connect(this.audioContext.destination);

		source.start(time);
		source.stop(time + 0.02);
	}

	/**
	 * Schedule a woodblock sound (800Hz triangle wave)
	 */
	private scheduleWoodblock(time: number): void {
		if (!this.audioContext) return;

		const oscillator = this.audioContext.createOscillator();
		const gainNode = this.audioContext.createGain();

		oscillator.type = 'triangle';
		oscillator.frequency.setValueAtTime(800, time);
		oscillator.frequency.exponentialRampToValueAtTime(400, time + 0.03);

		gainNode.gain.setValueAtTime(0.4, time);
		gainNode.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

		oscillator.connect(gainNode);
		gainNode.connect(this.audioContext.destination);

		oscillator.start(time);
		oscillator.stop(time + 0.08);
	}

	/**
	 * Metronome scheduler - runs every LOOKAHEAD_MS
	 */
	private metronomeScheduler = (): void => {
		if (!this.isRunning || !this.audioContext || !this.config) return;

		const elapsed = this.audioContext.currentTime - this.startTime;
		const { startBpm, endBpm, durationSeconds, sound } = this.config;

		// Check if training is complete
		if (elapsed >= durationSeconds) {
			this.stop();
			this.onComplete?.();
			return;
		}

		// Calculate current BPM
		const currentBpm = this.calculateCurrentBpm(elapsed, durationSeconds, startBpm, endBpm);
		const secondsPerBeat = 60 / currentBpm;

		// Schedule all clicks that fall within the lookahead window
		while (this.nextClickTime < this.audioContext.currentTime + this.SCHEDULE_AHEAD_TIME) {
			if (this.nextClickTime >= this.startTime) {
				this.scheduleClick(this.nextClickTime, sound);
			}
			this.nextClickTime += secondsPerBeat;
		}

		// Update progress
		const progress = elapsed / durationSeconds;
		this.onProgress?.(progress, currentBpm);
	};

	/**
	 * Start the standalone metronome mode
	 */
	async startMetronome(config: MetronomeConfig): Promise<void> {
		// Stop any existing session
		this.stop();

		const audioContext = await this.ensureAudioContext();
		this.config = config;
		this.isRunning = true;
		this.startTime = audioContext.currentTime;
		this.nextClickTime = this.startTime;

		// Start scheduler interval
		this.schedulerIntervalId = window.setInterval(this.metronomeScheduler, this.LOOKAHEAD_MS);

		// Trigger initial schedule
		this.metronomeScheduler();
	}

	/**
	 * Segment training animation loop
	 */
	private segmentAnimationLoop = (timestamp: number): void => {
		if (!this.isRunning || !this.segmentConfig) return;

		const { audioEngine, songBpm, startBpm, endBpm, durationSeconds, segmentStart, segmentEnd } = this.segmentConfig;

		// Calculate elapsed time
		const elapsedMs = timestamp - this.segmentStartTimestamp;
		const elapsedSeconds = elapsedMs / 1000;

		// Check if training is complete
		if (elapsedSeconds >= durationSeconds) {
			// Reset playback rate to original before stopping
			const originalRate = startBpm / songBpm;
			audioEngine.setPlaybackRate(originalRate);
			audioEngine.pause();
			this.stop();
			this.onComplete?.();
			return;
		}

		// Calculate current BPM and playback rate
		const currentBpm = this.calculateCurrentBpm(elapsedSeconds, durationSeconds, startBpm, endBpm);
		const targetRate = currentBpm / songBpm;

		// Clamp to valid range (0.25 to 2.0)
		const clampedRate = Math.max(0.25, Math.min(2.0, targetRate));
		audioEngine.setPlaybackRate(clampedRate);

		// Check if we need to loop back to segment start
		const currentTime = audioEngine.getCurrentTime();
		if (currentTime >= segmentEnd || currentTime < segmentStart) {
			audioEngine.seekTo(segmentStart);
		}

		// Update progress
		const progress = elapsedSeconds / durationSeconds;
		this.onProgress?.(progress, currentBpm);

		// Continue animation loop
		this.animationFrameId = requestAnimationFrame(this.segmentAnimationLoop);
	};

	/**
	 * Start the segment training mode
	 */
	async startSegmentTraining(config: SegmentConfig): Promise<void> {
		// Stop any existing session
		this.stop();

		this.segmentConfig = config;
		this.isRunning = true;

		const { audioEngine, startBpm, songBpm, segmentStart, segmentEnd } = config;

		// Calculate initial playback rate
		const initialRate = startBpm / songBpm;
		const clampedRate = Math.max(0.25, Math.min(2.0, initialRate));

		// Set up loop for the segment
		audioEngine.setLoopSegments([{ start: segmentStart, end: segmentEnd }]);

		// Set initial playback rate
		audioEngine.setPlaybackRate(clampedRate);

		// Seek to segment start and play
		await audioEngine.seekTo(segmentStart);
		await audioEngine.play();

		// Start animation loop
		this.segmentStartTimestamp = performance.now();
		this.animationFrameId = requestAnimationFrame(this.segmentAnimationLoop);
	}

	/**
	 * Stop the current training session
	 */
	stop(): void {
		this.isRunning = false;

		// Clear metronome scheduler
		if (this.schedulerIntervalId !== null) {
			clearInterval(this.schedulerIntervalId);
			this.schedulerIntervalId = null;
		}

		// Clear segment animation
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}

		// Reset segment playback if applicable
		if (this.segmentConfig) {
			this.segmentConfig.audioEngine.clearLoop();
			this.segmentConfig.audioEngine.setPlaybackRate(1.0);
			this.segmentConfig = null;
		}

		this.config = null;
	}

	/**
	 * Check if training is currently running
	 */
	get running(): boolean {
		return this.isRunning;
	}

	/**
	 * Dispose resources
	 */
	dispose(): void {
		this.stop();

		if (this.audioContext && this.audioContext.state !== 'closed') {
			try {
				this.audioContext.close();
			} catch (e) {
				console.warn('Error closing tempo trainer audio context:', e);
			}
		}
		this.audioContext = null;
	}
}
