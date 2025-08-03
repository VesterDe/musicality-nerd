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
	private updateLoopRunning = false;
	
	// Loop functionality
	private loopEnabled = false;
	private loopStartTime = 0;
	private loopEndTime = 0;

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

		// Clean up any existing source node
		if (this.sourceNode) {
			try {
				this.sourceNode.disconnect();
			} catch (e) {
				// Ignore errors if already disconnected
			}
		}

		// Create new source node (they can only be used once)
		this.sourceNode = this.audioContext.createBufferSource();
		this.sourceNode.buffer = this.audioBuffer;
		this.sourceNode.connect(this.analyserNode!);

		// Handle playback end
		this.sourceNode.onended = () => {
			if (this.loopEnabled && this.isPlaying) {
				// Restart from loop start point
				this.pauseTime = this.loopStartTime;
				this.play();
			} else {
				this.isPlaying = false;
				this.onEnded?.();
			}
		};

		// Start playback from current position
		let offset = Number.isNaN(this.pauseTime) ? 0 : this.pauseTime;
		
		// Ensure offset is within valid bounds
		offset = Math.max(0, Math.min(offset, this.getDuration()));
		
		if (this.loopEnabled) {
			// Ensure we're within loop bounds
			offset = Math.max(this.loopStartTime, Math.min(this.loopEndTime, offset));
		}
		
		try {
			// Always start without duration limit - we'll handle looping manually in the time update loop
			this.sourceNode.start(0, offset);
			
			this.startTime = this.audioContext.currentTime - offset;
			this.isPlaying = true;
		} catch (error) {
			console.error('Failed to start audio source:', error);
			this.isPlaying = false;
			throw error;
		}

		// Start time update loop
		this.startTimeUpdateLoop();
	}

	/**
	 * Pause playback
	 */
	pause(): void {
		if (!this.isPlaying || !this.sourceNode) return;

		// Calculate pause time BEFORE stopping to get accurate time
		const currentPlaybackTime = this.getCurrentTime();
		
		try {
			this.sourceNode.stop();
			this.sourceNode.disconnect();
		} catch (e) {
			// Ignore errors if already stopped/disconnected
		}
		
		this.pauseTime = currentPlaybackTime;
		this.isPlaying = false;
		this.updateLoopRunning = false;
	}

	/**
	 * Stop playback and reset to beginning
	 */
	stop(): void {
		if (this.sourceNode) {
			try {
				this.sourceNode.stop();
				this.sourceNode.disconnect();
			} catch (e) {
				// Ignore errors if already stopped/disconnected
			}
		}
		this.isPlaying = false;
		this.pauseTime = 0;
		this.startTime = 0;
		this.updateLoopRunning = false;
	}

	/**
	 * Seek to specific time
	 */
	async seekTo(time: number): Promise<void> {
		const wasPlaying = this.isPlaying;
		const clampedTime = Math.max(0, Math.min(time, this.getDuration()));
		
		// Stop update loop immediately to prevent conflicts
		this.updateLoopRunning = false;
		
		if (this.isPlaying) {
			this.pause();
		}

		// Set the new pause time
		this.pauseTime = clampedTime;

		if (wasPlaying) {
			// Small delay to ensure clean state transition
			await new Promise(resolve => setTimeout(resolve, 5));
			await this.play();
		}
	}

	/**
	 * Get current playback time in seconds
	 */
	getCurrentTime(): number {
		if (!this.audioContext) return 0;

		if (this.isPlaying) {
			const currentTime = this.audioContext.currentTime - this.startTime;
			// Ensure time is within valid bounds
			return Math.max(0, Math.min(currentTime, this.getDuration()));
		} else {
			// Ensure pause time is within valid bounds
			return Math.max(0, Math.min(this.pauseTime, this.getDuration()));
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
	 * Set loop points for playback
	 */
	setLoopPoints(startTime: number, endTime: number): void {
		this.loopStartTime = Math.max(0, startTime);
		this.loopEndTime = Math.min(this.getDuration(), endTime);
		this.loopEnabled = true;
	}
	
	/**
	 * Clear loop points and disable looping
	 */
	clearLoop(): void {
		this.loopEnabled = false;
		this.loopStartTime = 0;
		this.loopEndTime = 0;
		
		// No need to restart playback - looping is handled in the time update loop
	}
	
	/**
	 * Check if looping is enabled
	 */
	isLooping(): boolean {
		return this.loopEnabled;
	}
	
	/**
	 * Get current loop points
	 */
	getLoopPoints(): { start: number; end: number } | null {
		if (!this.loopEnabled) return null;
		return { start: this.loopStartTime, end: this.loopEndTime };
	}

	/**
	 * Start the time update loop
	 */
	private startTimeUpdateLoop(): void {
		// Prevent multiple concurrent update loops
		if (this.updateLoopRunning) {
			return;
		}
		
		this.updateLoopRunning = true;
		
		const updateTime = () => {
			if (this.isPlaying && this.updateLoopRunning) {
				const currentTime = this.getCurrentTime();
				
				// Check if we need to loop
				if (this.loopEnabled && currentTime >= this.loopEndTime) {
					// Force loop by stopping and restarting
					this.pause();
					this.pauseTime = this.loopStartTime;
					this.play();
					return;
				}
				
				this.onTimeUpdate?.(currentTime);
				requestAnimationFrame(updateTime);
			} else {
				// Stop the update loop when not playing
				this.updateLoopRunning = false;
			}
		};
		requestAnimationFrame(updateTime);
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.stop();
		this.updateLoopRunning = false;
		
		if (this.sourceNode) {
			try {
				this.sourceNode.disconnect();
			} catch (e) {
				// Ignore errors if already disconnected
			}
			this.sourceNode = null;
		}
		
		if (this.audioContext && this.audioContext.state !== 'closed') {
			try {
				this.audioContext.close();
			} catch (e) {
				console.warn('Error closing audio context:', e);
			}
		}
		this.audioContext = null;
		this.audioBuffer = null;
	}
} 