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
	private loopSegments: Array<{ start: number; end: number }> = [];
	private currentLoopSegmentIndex = 0;
	private lastJumpTime = 0;

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
			if (this.loopEnabled && this.isPlaying && this.loopSegments.length > 0) {
				// Restart from first loop segment
				this.pauseTime = this.loopSegments[0].start;
				this.currentLoopSegmentIndex = 0;
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
		
		if (this.loopEnabled && this.loopSegments.length > 0) {
			// Find which segment we should be in, or default to first segment
			let targetSegmentIndex = 0;
			for (let i = 0; i < this.loopSegments.length; i++) {
				const segment = this.loopSegments[i];
				if (offset >= segment.start && offset <= segment.end) {
					targetSegmentIndex = i;
					break;
				}
			}
			this.currentLoopSegmentIndex = targetSegmentIndex;
			const targetSegment = this.loopSegments[targetSegmentIndex];
			offset = Math.max(targetSegment.start, Math.min(targetSegment.end, offset));
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
	 * Set loop segments for playback (supports non-contiguous looping)
	 */
	setLoopSegments(segments: Array<{ start: number; end: number }>): void {
		this.loopSegments = segments
			.map(seg => ({
				start: Math.max(0, seg.start),
				end: Math.min(this.getDuration(), seg.end)
			}))
			.sort((a, b) => a.start - b.start); // Sort by start time
		this.loopEnabled = segments.length > 0;
		this.currentLoopSegmentIndex = 0;
	}
	
	/**
	 * Set loop points for playback (legacy method for backward compatibility)
	 */
	setLoopPoints(startTime: number, endTime: number): void {
		this.setLoopSegments([{ start: startTime, end: endTime }]);
	}
	
	/**
	 * Clear loop points and disable looping
	 */
	clearLoop(): void {
		this.loopEnabled = false;
		this.loopSegments = [];
		this.currentLoopSegmentIndex = 0;
		
		// No need to restart playback - looping is handled in the time update loop
	}
	
	/**
	 * Check if looping is enabled
	 */
	isLooping(): boolean {
		return this.loopEnabled;
	}
	
	/**
	 * Get current loop segments
	 */
	getLoopSegments(): Array<{ start: number; end: number }> {
		return this.loopSegments;
	}
	
	/**
	 * Get current loop points (legacy method for backward compatibility)
	 */
	getLoopPoints(): { start: number; end: number } | null {
		if (!this.loopEnabled || this.loopSegments.length === 0) return null;
		// Return the overall range from first segment start to last segment end
		return { 
			start: this.loopSegments[0].start, 
			end: this.loopSegments[this.loopSegments.length - 1].end 
		};
	}

	/**
	 * Jump to a specific segment synchronously (for use within time update loop)
	 */
	private jumpToSegment(time: number): void {
		const clampedTime = Math.max(0, Math.min(time, this.getDuration()));
		
		if (!this.audioContext || !this.audioBuffer || !this.isPlaying) return;
		
		// Stop current source
		if (this.sourceNode) {
			try {
				this.sourceNode.stop();
				this.sourceNode.disconnect();
			} catch (e) {
				// Ignore errors if already stopped/disconnected
			}
		}
		
		// Create new source node and start at the new position
		this.sourceNode = this.audioContext.createBufferSource();
		this.sourceNode.buffer = this.audioBuffer;
		this.sourceNode.connect(this.analyserNode!);
		
		// Handle playback end for the new source
		this.sourceNode.onended = () => {
			if (this.loopEnabled && this.isPlaying && this.loopSegments.length > 0) {
				// Restart from first loop segment
				this.pauseTime = this.loopSegments[0].start;
				this.currentLoopSegmentIndex = 0;
				this.play();
			} else {
				this.isPlaying = false;
				this.onEnded?.();
			}
		};
		
		try {
			this.sourceNode.start(0, clampedTime);
			this.startTime = this.audioContext.currentTime - clampedTime;
		} catch (error) {
			console.error('Failed to jump to segment:', error);
		}
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
				
				// Check if we need to handle segment-based looping
				if (this.loopEnabled && this.loopSegments.length > 0) {
					// Find which segment (if any) contains the current time
					// Add small tolerance for timing precision issues
					const timeTolerance = 0.01; // 10ms tolerance
					let currentSegmentIndex = -1;
					for (let i = 0; i < this.loopSegments.length; i++) {
						const segment = this.loopSegments[i];
						if (currentTime >= (segment.start - timeTolerance) && currentTime <= (segment.end + timeTolerance)) {
							currentSegmentIndex = i;
							break;
						}
					}
					
					// If we're not in any loop segment, jump to the next appropriate one
					if (currentSegmentIndex === -1) {
						// Prevent rapid consecutive jumps
						const now = Date.now();
						if (now - this.lastJumpTime < 50) { // 50ms minimum between jumps
							// Skip this jump, let audio settle
							this.onTimeUpdate?.(currentTime);
							requestAnimationFrame(updateTime);
							return;
						}
						
						// Find the next segment to jump to
						let nextSegmentIndex = 0;
						for (let i = 0; i < this.loopSegments.length; i++) {
							if (this.loopSegments[i].start > currentTime) {
								nextSegmentIndex = i;
								break;
							}
						}
						// If no segment found after current time, loop back to first
						
						this.currentLoopSegmentIndex = nextSegmentIndex;
						const nextSegment = this.loopSegments[nextSegmentIndex];
						
						// Perform synchronous segment jump
						this.jumpToSegment(nextSegment.start);
						this.lastJumpTime = now;
						
						// Get the NEW currentTime after the jump and update UI with correct time
						const newCurrentTime = this.getCurrentTime();
						this.onTimeUpdate?.(newCurrentTime);
						
						// Continue to next frame after the jump
						requestAnimationFrame(updateTime);
						return;
					} else {
						// We're in a valid segment, update the index
						this.currentLoopSegmentIndex = currentSegmentIndex;
					}
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