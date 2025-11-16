export class AudioExportService {
	private audioContext: AudioContext | null = null;

	/**
	 * Initialize the audio context for export operations
	 */
	private async initialize(): Promise<void> {
		if (!this.audioContext) {
			this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		}

		if (this.audioContext.state === 'suspended') {
			await this.audioContext.resume();
		}
	}

	/**
	 * Extract audio segment from source AudioBuffer and export as MP3
	 */
	async exportChunk(
		sourceBuffer: AudioBuffer, 
		startTime: number, 
		endTime: number, 
        filename: string,
        options?: { playbackRate?: number }
	): Promise<void> {
		await this.initialize();
		
		if (!this.audioContext) {
			throw new Error('Audio context not available');
		}

		// Calculate sample indices
		const sampleRate = sourceBuffer.sampleRate;
		const startSample = Math.floor(startTime * sampleRate);
		const endSample = Math.floor(endTime * sampleRate);
		const chunkLength = endSample - startSample;

		if (chunkLength <= 0) {
			throw new Error('Invalid time range for export');
		}

		// Create a new AudioBuffer for the chunk
		const chunkBuffer = this.audioContext.createBuffer(
			sourceBuffer.numberOfChannels,
			chunkLength,
			sampleRate
		);

		// Copy audio data for each channel
		for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
			const sourceData = sourceBuffer.getChannelData(channel);
			const chunkData = chunkBuffer.getChannelData(channel);
			
			for (let i = 0; i < chunkLength; i++) {
				const sourceIndex = startSample + i;
				if (sourceIndex < sourceData.length) {
					chunkData[i] = sourceData[sourceIndex];
				} else {
					chunkData[i] = 0; // Pad with silence if beyond source
				}
			}
		}

        // If a playbackRate is provided and differs from 1, time-scale the buffer
        const playbackRate = options?.playbackRate ?? 1;
        const outputBuffer = playbackRate !== 1
            ? await this.timeScaleBuffer(chunkBuffer, playbackRate)
            : chunkBuffer;

        // Convert AudioBuffer to WAV and download
        await this.downloadAudioBuffer(outputBuffer, filename);
	}

	/**
	 * Export multiple contiguous chunks as a single MP3 file
	 */
	async exportChunkGroup(
		sourceBuffer: AudioBuffer,
		chunks: Array<{ startTime: number; endTime: number; index: number }>,
        filename: string,
        options?: { playbackRate?: number }
	): Promise<void> {
		await this.initialize();
		
		if (!this.audioContext || chunks.length === 0) {
			throw new Error('Invalid parameters for group export');
		}

		// Sort chunks by start time to ensure proper order
		const sortedChunks = chunks.sort((a, b) => a.startTime - b.startTime);
		
		// Calculate total duration and find gaps
		let totalDuration = 0;
		const segments: Array<{ startTime: number; endTime: number; sourceStart: number; sourceEnd: number }> = [];
		
		for (let i = 0; i < sortedChunks.length; i++) {
			const chunk = sortedChunks[i];
			const sampleRate = sourceBuffer.sampleRate;
			
			segments.push({
				startTime: totalDuration,
				endTime: totalDuration + (chunk.endTime - chunk.startTime),
				sourceStart: chunk.startTime,
				sourceEnd: chunk.endTime
			});
			
			totalDuration += (chunk.endTime - chunk.startTime);
		}

		// Create a new AudioBuffer for the combined chunks
		const combinedBuffer = this.audioContext.createBuffer(
			sourceBuffer.numberOfChannels,
			Math.floor(totalDuration * sourceBuffer.sampleRate),
			sourceBuffer.sampleRate
		);

		// Copy audio data from each segment
		for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel++) {
			const sourceData = sourceBuffer.getChannelData(channel);
			const combinedData = combinedBuffer.getChannelData(channel);
			
			for (const segment of segments) {
				const sourceStartSample = Math.floor(segment.sourceStart * sourceBuffer.sampleRate);
				const sourceEndSample = Math.floor(segment.sourceEnd * sourceBuffer.sampleRate);
				const destStartSample = Math.floor(segment.startTime * sourceBuffer.sampleRate);
				
				for (let i = 0; i < (sourceEndSample - sourceStartSample); i++) {
					const sourceIndex = sourceStartSample + i;
					const destIndex = destStartSample + i;
					
					if (sourceIndex < sourceData.length && destIndex < combinedData.length) {
						combinedData[destIndex] = sourceData[sourceIndex];
					}
				}
			}
		}

        // Apply optional time scaling to the combined buffer
        const playbackRate = options?.playbackRate ?? 1;
        const outputBuffer = playbackRate !== 1
            ? await this.timeScaleBuffer(combinedBuffer, playbackRate)
            : combinedBuffer;

        // Convert combined buffer to WAV and download
        await this.downloadAudioBuffer(outputBuffer, filename);
	}

	/**
	 * Export a chunk from multiple stems, mixing only enabled stems
	 * Uses OfflineAudioContext to combine stems and apply BPM scaling
	 */
	async exportStemsChunkCombined(
		stemBuffers: AudioBuffer[],
		enabledFlags: boolean[],
		startTime: number,
		endTime: number,
		filename: string,
		options?: { playbackRate?: number }
	): Promise<void> {
		// Validation
		if (stemBuffers.length === 0) {
			throw new Error('No stem buffers provided');
		}

		if (enabledFlags.length !== stemBuffers.length) {
			throw new Error('Enabled flags length must match stem buffers length');
		}

		if (endTime <= startTime) {
			throw new Error('Invalid time range for export');
		}

		// Check if any stems are enabled
		const hasEnabledStems = enabledFlags.some(enabled => enabled);
		if (!hasEnabledStems) {
			throw new Error('No stems are enabled for export');
		}

		// Use first stem's properties as canonical (all stems should have same sample rate)
		const sampleRate = stemBuffers[0].sampleRate;
		const numberOfChannels = stemBuffers[0].numberOfChannels;

		// Calculate chunk duration
		const chunkDuration = endTime - startTime;
		const chunkLength = Math.ceil(chunkDuration * sampleRate);

		if (chunkLength <= 0) {
			throw new Error('Invalid chunk duration');
		}

		// Create OfflineAudioContext for mixing
		const offline = new OfflineAudioContext(numberOfChannels, chunkLength, sampleRate);

		// Mix all enabled stems
		for (let i = 0; i < stemBuffers.length; i++) {
			if (!enabledFlags[i]) {
				continue; // Skip disabled stems
			}

			const stemBuffer = stemBuffers[i];
			
			// Validate stem buffer compatibility
			if (stemBuffer.sampleRate !== sampleRate) {
				console.warn(`Stem ${i} has different sample rate (${stemBuffer.sampleRate} vs ${sampleRate}), may cause issues`);
			}

			// Create source node for this stem
			const source = offline.createBufferSource();
			source.buffer = stemBuffer;
			
			// Connect directly to destination (signals will automatically sum)
			// OfflineAudioContext will handle resampling if needed
			source.connect(offline.destination);
			
			// Start playback at the chunk start time
			// Duration is automatically limited by the OfflineAudioContext length
			try {
				source.start(0, startTime);
			} catch (error) {
				console.warn(`Failed to start stem ${i} at offset ${startTime}:`, error);
				// Continue with other stems
			}
		}

		// Render the mixed audio
		let mixedBuffer: AudioBuffer;
		try {
			mixedBuffer = await offline.startRendering();
		} catch (error) {
			throw new Error(`Failed to render mixed stems: ${error instanceof Error ? error.message : String(error)}`);
		}

		// Check for clipping and normalize if needed
		const maxSample = this.findMaxSample(mixedBuffer);
		if (maxSample > 1.0) {
			console.warn(`Mixed audio clips (max sample: ${maxSample.toFixed(3)}), normalizing...`);
			mixedBuffer = this.normalizeBuffer(mixedBuffer, maxSample);
		}

		// Apply playback rate scaling if needed
		const playbackRate = options?.playbackRate ?? 1;
		const outputBuffer = playbackRate !== 1
			? await this.timeScaleBuffer(mixedBuffer, playbackRate)
			: mixedBuffer;

		// Convert to WAV and download
		await this.downloadAudioBuffer(outputBuffer, filename);
	}

	/**
	 * Find the maximum absolute sample value in an AudioBuffer
	 */
	private findMaxSample(buffer: AudioBuffer): number {
		let max = 0;
		for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
			const channelData = buffer.getChannelData(channel);
			for (let i = 0; i < channelData.length; i++) {
				const abs = Math.abs(channelData[i]);
				if (abs > max) {
					max = abs;
				}
			}
		}
		return max;
	}

	/**
	 * Normalize an AudioBuffer to prevent clipping
	 */
	private normalizeBuffer(buffer: AudioBuffer, maxSample: number): AudioBuffer {
		if (maxSample <= 0 || maxSample <= 1.0) {
			return buffer; // No normalization needed
		}

		const scale = 0.99 / maxSample; // Scale to 99% to leave headroom
		const normalized = new AudioBuffer({
			length: buffer.length,
			numberOfChannels: buffer.numberOfChannels,
			sampleRate: buffer.sampleRate
		});

		for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
			const sourceData = buffer.getChannelData(channel);
			const destData = normalized.getChannelData(channel);
			for (let i = 0; i < sourceData.length; i++) {
				destData[i] = sourceData[i] * scale;
			}
		}

		return normalized;
	}

	/**
	 * Convert AudioBuffer to WAV and trigger download
	 * Note: This creates a WAV file since MP3 encoding would require additional dependencies
	 */
	private async downloadAudioBuffer(audioBuffer: AudioBuffer, filename: string): Promise<void> {
		// Use WAV format since it's simpler and doesn't require additional libraries
		const wavBlob = this.audioBufferToWav(audioBuffer);
		
		// Create download link
		const url = URL.createObjectURL(wavBlob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename.replace('.mp3', '.wav'); // Use WAV extension
		
		// Trigger download
		document.body.appendChild(link);
		link.click();
		
		// Cleanup
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	/**
	 * Convert AudioBuffer to WAV blob
	 */
	private audioBufferToWav(audioBuffer: AudioBuffer): Blob {
		const numberOfChannels = audioBuffer.numberOfChannels;
		const sampleRate = audioBuffer.sampleRate;
		const length = audioBuffer.length;
		
		// Calculate buffer size
		const bytesPerSample = 2; // 16-bit
		const dataLength = length * numberOfChannels * bytesPerSample;
		const headerLength = 44;
		const totalLength = headerLength + dataLength;
		
		// Create array buffer
		const arrayBuffer = new ArrayBuffer(totalLength);
		const view = new DataView(arrayBuffer);
		
		// Write WAV header
		let offset = 0;
		
		// RIFF chunk descriptor
		this.writeString(view, offset, 'RIFF'); offset += 4;
		view.setUint32(offset, totalLength - 8, true); offset += 4;
		this.writeString(view, offset, 'WAVE'); offset += 4;
		
		// fmt sub-chunk
		this.writeString(view, offset, 'fmt '); offset += 4;
		view.setUint32(offset, 16, true); offset += 4; // Sub-chunk size
		view.setUint16(offset, 1, true); offset += 2; // Audio format (PCM)
		view.setUint16(offset, numberOfChannels, true); offset += 2;
		view.setUint32(offset, sampleRate, true); offset += 4;
		view.setUint32(offset, sampleRate * numberOfChannels * bytesPerSample, true); offset += 4; // Byte rate
		view.setUint16(offset, numberOfChannels * bytesPerSample, true); offset += 2; // Block align
		view.setUint16(offset, 16, true); offset += 2; // Bits per sample
		
		// data sub-chunk
		this.writeString(view, offset, 'data'); offset += 4;
		view.setUint32(offset, dataLength, true); offset += 4;
		
		// Write audio data
		const channels: Float32Array[] = [];
		for (let i = 0; i < numberOfChannels; i++) {
			channels.push(audioBuffer.getChannelData(i));
		}
		
		for (let i = 0; i < length; i++) {
			for (let channel = 0; channel < numberOfChannels; channel++) {
				// Convert float32 to int16
				const sample = Math.max(-1, Math.min(1, channels[channel][i]));
				const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
				view.setInt16(offset, int16Sample, true);
				offset += 2;
			}
		}
		
		return new Blob([arrayBuffer], { type: 'audio/wav' });
	}

    /**
     * Render a buffer at a given playbackRate using OfflineAudioContext.
     * Pitch will shift with tempo (no time-stretching algorithm).
     */
    private async timeScaleBuffer(buffer: AudioBuffer, playbackRate: number): Promise<AudioBuffer> {
        if (playbackRate <= 0) {
            throw new Error('playbackRate must be > 0');
        }

        // Calculate the length of the rendered buffer after rate change
        const channels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const scaledLength = Math.ceil(buffer.length / playbackRate);

        // Use OfflineAudioContext for high-quality resampling
        const offline = new OfflineAudioContext(channels, scaledLength, sampleRate);
        const source = offline.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;
        source.connect(offline.destination);
        source.start(0);
        const rendered = await offline.startRendering();
        return rendered;
    }

	/**
	 * Write string to DataView
	 */
	private writeString(view: DataView, offset: number, string: string): void {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	}

	/**
	 * Clean up resources
	 */
	dispose(): void {
		if (this.audioContext && this.audioContext.state !== 'closed') {
			this.audioContext.close();
		}
		this.audioContext = null;
	}
}