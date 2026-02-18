import type { AudioAnalysisData } from '../types';

interface StemSource {
	sourceNode: AudioBufferSourceNode;
	gainNode: GainNode;
	enabled: boolean;
}

export class AudioEngine {
	private audioContext: AudioContext | null = null;
	private audioBuffer: AudioBuffer | null = null;
	private sourceNode: AudioBufferSourceNode | null = null;
	private analyserNode: AnalyserNode | null = null;
	private gainNode: GainNode | null = null;
	private startTime = 0;
	private pauseTime = 0;
	private isPlaying = false;
	
	// Stem mode support
	private stemBuffers: AudioBuffer[] = [];
	private stemSources: StemSource[] = [];
	private stemEnabledStates: boolean[] = [];
	private isStemMode = false;
	
	// Playback rate control
	private playbackRate = 1.0;
	
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

		// Resume context if suspended (required by browser autoplay policies)
		if (this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
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

		// Clear stem mode state
		this.isStemMode = false;
		this.stemBuffers = [];
		this.stemSources = [];

		try {
			this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
		} catch (error) {
			throw new Error(`Failed to decode audio: ${error}`);
		}
	}

	/**
	 * Load multiple stems from ArrayBuffers
	 */
	async loadStems(buffers: ArrayBuffer[]): Promise<void> {
		await this.initialize();
		
		if (!this.audioContext) {
			throw new Error('Audio context not initialized');
		}

		if (buffers.length < 2) {
			throw new Error('Stem mode requires at least 2 audio files');
		}

		// Clear single-track state
		this.audioBuffer = null;
		this.sourceNode = null;

		// Enable stem mode
		this.isStemMode = true;
		this.stemBuffers = [];
		this.stemSources = [];
		this.stemEnabledStates = [];

		try {
			// Decode all buffers
			this.stemBuffers = await Promise.all(
				buffers.map(buffer => this.audioContext!.decodeAudioData(buffer))
			);

			// Initialize all stems as enabled by default
			this.stemEnabledStates = this.stemBuffers.map(() => true);

			// Use first stem as canonical buffer for duration/BPM detection
			this.audioBuffer = this.stemBuffers[0];
		} catch (error) {
			throw new Error(`Failed to decode stems: ${error}`);
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

		if (this.isStemMode) {
			await this.playStems();
		} else {
			await this.playSingle();
		}
	}

	/**
	 * Play single-track audio
	 */
	private async playSingle(): Promise<void> {
		if (!this.audioContext || !this.audioBuffer) return;

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
		this.sourceNode.playbackRate.value = this.playbackRate;
		this.applyNativeLooping(this.sourceNode);
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
			
			// Adjust startTime calculation for playback rate
			// We want: getCurrentTime() = (audioContext.currentTime - startTime) * playbackRate = offset
			// So: startTime = audioContext.currentTime - (offset / playbackRate)
			this.startTime = this.audioContext.currentTime - (offset / this.playbackRate);
			this.isPlaying = true;
		} catch (error) {
			console.error('Failed to start audio source:', error);
			this.isPlaying = false;
			throw error;
		}
	}

	/**
	 * Play multiple stems in sync
	 */
	private async playStems(): Promise<void> {
		if (!this.audioContext || this.stemBuffers.length === 0) return;

		// Clean up existing stem sources
		this.cleanupStemSources();

		// Create a mixer gain node to combine all stems (signals automatically sum)
		const mixerGain = this.audioContext.createGain();
		mixerGain.connect(this.analyserNode!);

		// Start playback from current position
		let offset = Number.isNaN(this.pauseTime) ? 0 : this.pauseTime;
		offset = Math.max(0, Math.min(offset, this.getDuration()));
		
		if (this.loopEnabled && this.loopSegments.length > 0) {
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

		// Create source nodes for each stem
		let endedCount = 0;
		const totalStems = this.stemBuffers.length;

		for (let i = 0; i < this.stemBuffers.length; i++) {
			const buffer = this.stemBuffers[i];
			const sourceNode = this.audioContext.createBufferSource();
			const gainNode = this.audioContext.createGain();
			
			sourceNode.buffer = buffer;
			sourceNode.playbackRate.value = this.playbackRate;
			this.applyNativeLooping(sourceNode);
			sourceNode.connect(gainNode);

			// Connect each stem's gain node to the mixer
			gainNode.connect(mixerGain);

			// Set gain based on stored enabled state
			const isEnabled = this.stemEnabledStates[i] ?? true;
			gainNode.gain.value = isEnabled ? 1.0 : 0.0;

			// Handle playback end - only trigger when all stems end
			sourceNode.onended = () => {
				endedCount++;
				if (endedCount === totalStems) {
					if (this.loopEnabled && this.isPlaying && this.loopSegments.length > 0) {
						this.pauseTime = this.loopSegments[0].start;
						this.currentLoopSegmentIndex = 0;
						this.play();
					} else {
						this.isPlaying = false;
						this.onEnded?.();
					}
				}
			};

			try {
				sourceNode.start(0, offset);
				this.stemSources.push({
					sourceNode,
					gainNode,
					enabled: isEnabled
				});
			} catch (error) {
				console.error(`Failed to start stem ${i}:`, error);
			}
		}

		// Adjust startTime calculation for playback rate
		this.startTime = this.audioContext.currentTime - (offset / this.playbackRate);
		this.isPlaying = true;
	}

	/**
	 * Clean up stem sources
	 */
	private cleanupStemSources(): void {
		for (const stemSource of this.stemSources) {
			try {
				stemSource.sourceNode.onended = null;
				stemSource.sourceNode.stop();
				stemSource.sourceNode.disconnect();
				stemSource.gainNode.disconnect();
			} catch (e) {
				// Ignore errors if already stopped/disconnected
			}
		}
		this.stemSources = [];
	}

	/**
	 * Pause playback
	 */
	pause(): void {
		if (!this.isPlaying || !this.audioContext) return;

		// Capture wrapped position before stopping (getCurrentTime accounts for native looping)
		const currentPlaybackTime = this.getCurrentTime();

		if (this.isStemMode) {
			this.cleanupStemSources();
		} else {
			if (!this.sourceNode) return;

			this.sourceNode.onended = null;
			try {
				this.sourceNode.stop();
				this.sourceNode.disconnect();
			} catch (e) {
				// Ignore errors if already stopped/disconnected
			}
		}

		this.pauseTime = currentPlaybackTime;
		this.isPlaying = false;
	}

	/**
	 * Stop playback and reset to beginning
	 */
	stop(): void {
		if (this.isStemMode) {
			this.cleanupStemSources();
		} else {
			if (this.sourceNode) {
				this.sourceNode.onended = null;
				try {
					this.sourceNode.stop();
					this.sourceNode.disconnect();
				} catch (e) {
					// Ignore errors if already stopped/disconnected
				}
			}
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
		const clampedTime = Math.max(0, Math.min(time, this.getDuration()));

		if (this.isPlaying) {
			this.pause();
		}

		// Set the new pause time
		this.pauseTime = clampedTime;

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
			// Calculate elapsed time since start
			const elapsedTime = this.audioContext.currentTime - this.startTime;
			// Adjust for playback rate to get actual position in the audio
			let currentTime = elapsedTime * this.playbackRate;

			// When native looping is active, the audio thread wraps playback at
			// loopEnd, but our linear calculation keeps increasing. Wrap it to
			// match the actual audio position.
			if (this.loopEnabled && this.loopSegments.length > 0) {
				const loopStart = this.loopSegments[0].start;
				const loopEnd = this.loopSegments[this.loopSegments.length - 1].end;
				const loopDuration = loopEnd - loopStart;
				if (loopDuration > 0 && currentTime > loopEnd) {
					currentTime = loopStart + ((currentTime - loopStart) % loopDuration);
				}
			}

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
	 * Set playback rate (0.25 to 2.0)
	 */
	setPlaybackRate(rate: number): void {
		// Clamp rate to reasonable bounds
		const newRate = Math.max(0.25, Math.min(2.0, rate));
		
		if (this.isStemMode) {
			// For stem mode, update all stem sources
			if (this.isPlaying && this.audioContext && newRate !== this.playbackRate) {
				const currentPosition = this.getCurrentTime();
				this.playbackRate = newRate;
				
				// Update playback rate for all stem sources
				for (const stemSource of this.stemSources) {
					stemSource.sourceNode.playbackRate.value = this.playbackRate;
				}
				
				// Recalculate startTime
				this.startTime = this.audioContext.currentTime - (currentPosition / this.playbackRate);
			} else {
				this.playbackRate = newRate;
			}
		} else {
			// If currently playing and rate is changing, we need to adjust startTime
			if (this.sourceNode && this.isPlaying && this.audioContext && newRate !== this.playbackRate) {
				// Calculate current position before rate change
				const currentPosition = this.getCurrentTime();
				
				// Update the playback rate
				this.playbackRate = newRate;
				this.sourceNode.playbackRate.value = this.playbackRate;
				
				// Recalculate startTime so getCurrentTime() returns the same position
				// We want: currentPosition = (audioContext.currentTime - newStartTime) * newRate
				// So: newStartTime = audioContext.currentTime - (currentPosition / newRate)
				this.startTime = this.audioContext.currentTime - (currentPosition / this.playbackRate);
			} else {
				// Not playing, just update the rate
				this.playbackRate = newRate;
				if (this.sourceNode) {
					this.sourceNode.playbackRate.value = this.playbackRate;
				}
			}
		}
	}
	
	/**
	 * Get current playback rate
	 */
	getPlaybackRate(): number {
		return this.playbackRate;
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
	 * Apply native Web Audio API looping to a source node.
	 * This ensures loops are enforced at the audio thread level,
	 * even when the browser tab is backgrounded and rAF is throttled.
	 */
	private applyNativeLooping(sourceNode: AudioBufferSourceNode): void {
		if (this.loopEnabled && this.loopSegments.length > 0) {
			sourceNode.loop = true;
			sourceNode.loopStart = this.loopSegments[0].start;
			sourceNode.loopEnd = this.loopSegments[this.loopSegments.length - 1].end;
		} else {
			sourceNode.loop = false;
		}
	}

	/**
	 * Update native looping on all live source nodes
	 */
	private updateLiveSourceLooping(): void {
		if (!this.isPlaying) return;
		if (this.isStemMode) {
			for (const stemSource of this.stemSources) {
				this.applyNativeLooping(stemSource.sourceNode);
			}
		} else if (this.sourceNode) {
			this.applyNativeLooping(this.sourceNode);
		}
	}

	/**
	 * Set loop segments for playback (supports non-contiguous looping)
	 */
	setLoopSegments(segments: Array<{ start: number; end: number }>): void {
		// Capture position under the OLD loop bounds before changing anything
		const currentPos = this.isPlaying ? this.getCurrentTime() : null;

		this.loopSegments = segments
			.map(seg => ({
				start: Math.max(0, seg.start),
				end: Math.min(this.getDuration(), seg.end)
			}))
			.sort((a, b) => a.start - b.start); // Sort by start time
		this.loopEnabled = segments.length > 0;
		this.currentLoopSegmentIndex = 0;
		this.updateLiveSourceLooping();

		// Re-anchor startTime so the linear calculation aligns with the new bounds
		if (this.isPlaying && this.audioContext && currentPos !== null) {
			this.startTime = this.audioContext.currentTime - (currentPos / this.playbackRate);

			// If playhead is now outside the new loop, jump into the nearest segment
			if (this.loopEnabled && this.loopSegments.length > 0) {
				const inSegment = this.loopSegments.some(
					seg => currentPos >= seg.start && currentPos <= seg.end
				);
				if (!inSegment) {
					const nearest = this.loopSegments.reduce((best, seg) =>
						Math.abs(seg.start - currentPos) < Math.abs(best.start - currentPos) ? seg : best
					);
					this.jumpToSegment(nearest.start);
				}
			}
		}
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
		// Capture wrapped position before disabling loop
		const currentPos = this.isPlaying ? this.getCurrentTime() : null;

		this.loopEnabled = false;
		this.loopSegments = [];
		this.currentLoopSegmentIndex = 0;
		this.updateLiveSourceLooping();

		// Re-anchor so linear time starts from actual position, not the
		// inflated value that accumulated while native looping held audio back
		if (this.isPlaying && this.audioContext && currentPos !== null) {
			this.startTime = this.audioContext.currentTime - (currentPos / this.playbackRate);
		}
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
		
		if (this.isStemMode) {
			// For stem mode, preserve enabled state before cleanup
			const preservedEnabledState = this.stemSources.map(s => s.enabled);
			
			// Recreate all stem sources at the new position
			this.cleanupStemSources();
			
			// Create a mixer gain node to combine all stems
			const mixerGain = this.audioContext.createGain();
			mixerGain.connect(this.analyserNode!);
			
			let endedCount = 0;
			const totalStems = this.stemBuffers.length;
			
			for (let i = 0; i < this.stemBuffers.length; i++) {
				const buffer = this.stemBuffers[i];
				const sourceNode = this.audioContext.createBufferSource();
				const gainNode = this.audioContext.createGain();
				
				sourceNode.buffer = buffer;
				sourceNode.playbackRate.value = this.playbackRate;
				this.applyNativeLooping(sourceNode);
				sourceNode.connect(gainNode);
				gainNode.connect(mixerGain);
				
				// Set gain based on preserved enabled state
				const enabled = preservedEnabledState[i] ?? true;
				gainNode.gain.value = enabled ? 1.0 : 0.0;
				
				// Handle playback end
				sourceNode.onended = () => {
					endedCount++;
					if (endedCount === totalStems) {
						if (this.loopEnabled && this.isPlaying && this.loopSegments.length > 0) {
							this.pauseTime = this.loopSegments[0].start;
							this.currentLoopSegmentIndex = 0;
							this.play();
						} else {
							this.isPlaying = false;
							this.onEnded?.();
						}
					}
				};
				
				try {
					sourceNode.start(0, clampedTime);
					this.stemSources.push({
						sourceNode,
						gainNode,
						enabled: enabled
					});
				} catch (error) {
					console.error(`Failed to jump stem ${i}:`, error);
				}
			}
			
			// Adjust startTime calculation for playback rate
			this.startTime = this.audioContext.currentTime - (clampedTime / this.playbackRate);
		} else {
			// Single track mode
			// Detach handler before stopping to prevent spurious onended firing
			if (this.sourceNode) {
				this.sourceNode.onended = null;
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
			this.sourceNode.playbackRate.value = this.playbackRate;
			this.applyNativeLooping(this.sourceNode);
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
				// Adjust startTime calculation for playback rate
				this.startTime = this.audioContext.currentTime - (clampedTime / this.playbackRate);
			} catch (error) {
				console.error('Failed to jump to segment:', error);
			}
		}
	}

	/**
	 * Process one frame: handle loop boundary detection and fire onTimeUpdate.
	 * Called externally by PlayheadAnimator's rAF loop — no self-scheduling.
	 */
	tick(): void {
		if (!this.isPlaying) return;

		const currentTime = this.getCurrentTime();

		// Check if we need to handle segment-based looping
		if (this.loopEnabled && this.loopSegments.length > 0) {
			// Find which segment (if any) contains the current time
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
				if (now - this.lastJumpTime < 250) { // 250ms minimum between jumps
					this.onTimeUpdate?.(currentTime);
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

				this.currentLoopSegmentIndex = nextSegmentIndex;
				const nextSegment = this.loopSegments[nextSegmentIndex];

				this.jumpToSegment(nextSegment.start);
				this.lastJumpTime = now;

				// Fire callback with corrected time after jump
				this.onTimeUpdate?.(this.getCurrentTime());
				return;
			} else {
				this.currentLoopSegmentIndex = currentSegmentIndex;
			}
		}

		this.onTimeUpdate?.(currentTime);
	}

	/**
	 * Set enabled state for a specific stem (by index)
	 */
	setStemEnabled(index: number, enabled: boolean): void {
		if (!this.isStemMode || index < 0) {
			return;
		}

		// Always update the stored state (works even when not playing)
		if (index < this.stemEnabledStates.length) {
			this.stemEnabledStates[index] = enabled;
		}

		// Also update the live source if it exists (when playing)
		if (index < this.stemSources.length) {
			const stemSource = this.stemSources[index];
			if (stemSource) {
				stemSource.enabled = enabled;
				stemSource.gainNode.gain.value = enabled ? 1.0 : 0.0;
			}
		}
	}

	/**
	 * Get enabled state for all stems
	 */
	getStemsState(): boolean[] {
		if (!this.isStemMode) {
			return [];
		}
		return this.stemSources.map(source => source.enabled);
	}

	/**
	 * Get all stem buffers (for visualization)
	 */
	getStemBuffers(): AudioBuffer[] {
		if (!this.isStemMode) {
			return [];
		}
		return [...this.stemBuffers];
	}

	/**
	 * Check if in stem mode
	 */
	get isInStemMode(): boolean {
		return this.isStemMode;
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		this.stop();
		
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