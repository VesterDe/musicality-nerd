import type { AudioAnalysisData } from '../types';

export class AudioEngine {
	private audioContext: AudioContext | null = null;
	private audioBuffer: AudioBuffer | null = null;
	private sourceNode: AudioBufferSourceNode | null = null;
	private analyserNode: AnalyserNode | null = null;
	private gainNode: GainNode | null = null;
	private startTime = 0;
	private pauseTime = 0;
	private isPlaying = false;

	// Event handlers
	public onTimeUpdate: ((time: number) => void) | null = null;
	public onEnded: (() => void) | null = null;

	/**
	 * Initialize the audio context
	 */
	async initialize(): Promise<void> {
		if (!this.audioContext) {
			this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			
			// Create analyser node for spectrogram data
			this.analyserNode = this.audioContext.createAnalyser();
			this.analyserNode.fftSize = 2048;
			this.analyserNode.smoothingTimeConstant = 0.8;
			
			// Create gain node for volume control
			this.gainNode = this.audioContext.createGain();
			this.gainNode.connect(this.audioContext.destination);
			this.analyserNode.connect(this.gainNode);
		}

		// Resume context if suspended (required by browser policies)
		if (this.audioContext.state === 'suspended') {
			setTimeout(async () => {
				await this.audioContext?.resume();
			}, 3000);
		}
	}

	/**
	 * Decode MP3 file from ArrayBuffer
	 */
	async loadTrack(arrayBuffer: ArrayBuffer): Promise<void> {
		await this.initialize();
		
		if (!this.audioContext) {
			throw new Error('Audio context not initialized');
		}

		try {
			this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
		} catch (error) {
			throw new Error(`Failed to decode audio: ${error}`);
		}
	}

	/**
	 * Start or resume playback
	 */
	async play(): Promise<void> {
		if (!this.audioContext || !this.audioBuffer) {
			throw new Error('Audio not loaded');
		}

		await this.initialize();

		if (this.isPlaying) return;

		// Create new source node (they can only be used once)
		this.sourceNode = this.audioContext.createBufferSource();
		this.sourceNode.buffer = this.audioBuffer;
		this.sourceNode.connect(this.analyserNode!);

		// Handle playback end
		this.sourceNode.onended = () => {
			this.isPlaying = false;
			this.onEnded?.();
		};

		// Start playback from current position
		const offset = Number.isNaN(this.pauseTime) ? 0 : this.pauseTime;
		this.sourceNode.start(0, offset);
		this.startTime = this.audioContext.currentTime - offset;
		this.isPlaying = true;

		// Start time update loop
		this.startTimeUpdateLoop();
	}

	/**
	 * Pause playback
	 */
	pause(): void {
		if (!this.isPlaying || !this.sourceNode) return;

		this.sourceNode.stop();
		this.pauseTime = this.getCurrentTime();
		this.isPlaying = false;
	}

	/**
	 * Stop playback and reset to beginning
	 */
	stop(): void {
		if (this.sourceNode) {
			this.sourceNode.stop();
		}
		this.isPlaying = false;
		this.pauseTime = 0;
		this.startTime = 0;
	}

	/**
	 * Seek to specific time
	 */
	async seekTo(time: number): Promise<void> {
		const wasPlaying = this.isPlaying;
		
		if (this.isPlaying) {
			this.pause();
		}

		this.pauseTime = Math.max(0, Math.min(time, this.getDuration()));

		if (wasPlaying) {
			await this.play();
		}
	}

	/**
	 * Get current playback time in seconds
	 */
	getCurrentTime(): number {
		if (!this.audioContext) return 0;

		if (this.isPlaying) {
			return this.audioContext.currentTime - this.startTime;
		} else {
			return this.pauseTime;
		}
	}

	/**
	 * Get total duration in seconds
	 */
	getDuration(): number {
		return this.audioBuffer?.duration || 0;
	}

	/**
	 * Get the audio buffer for analysis
	 */
	getAudioBuffer(): AudioBuffer | null {
		return this.audioBuffer;
	}

	/**
	 * Get current audio analysis data for spectrogram
	 */
	getAnalysisData(): AudioAnalysisData | null {
		if (!this.analyserNode) return null;

		const bufferLength = this.analyserNode.frequencyBinCount;
		const timeData = new Float32Array(bufferLength);
		const frequencyData = new Float32Array(bufferLength);

		this.analyserNode.getFloatTimeDomainData(timeData);
		this.analyserNode.getFloatFrequencyData(frequencyData);

		return {
			timeData,
			frequencyData,
			currentTime: this.getCurrentTime(),
			duration: this.getDuration()
		};
	}

	/**
	 * Set volume (0.0 to 1.0)
	 */
	setVolume(volume: number): void {
		if (this.gainNode) {
			this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
		}
	}

	/**
	 * Check if currently playing
	 */
	get playing(): boolean {
		return this.isPlaying;
	}

	/**
	 * Update analyser settings for spectrogram detail
	 */
	updateAnalyserSettings(fftSize: number): void {
		if (this.analyserNode) {
			// Ensure fftSize is a power of 2 between 32 and 32768
			const validFftSize = Math.pow(2, Math.round(Math.log2(Math.max(32, Math.min(32768, fftSize)))));
			this.analyserNode.fftSize = validFftSize;
		}
	}

	/**
	 * Start the time update loop
	 */
	private startTimeUpdateLoop(): void {
		const updateTime = () => {
			if (this.isPlaying) {
				this.onTimeUpdate?.(this.getCurrentTime());
				requestAnimationFrame(updateTime);
			}
		};
		requestAnimationFrame(updateTime);
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.stop();
		if (this.audioContext && this.audioContext.state !== 'closed') {
			this.audioContext.close();
		}
		this.audioContext = null;
		this.audioBuffer = null;
	}
} 