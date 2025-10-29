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