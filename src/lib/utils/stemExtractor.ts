import {
	Input,
	BlobSource,
	ALL_FORMATS,
	Output,
	Mp3OutputFormat,
	BufferTarget,
	Conversion,
	canEncodeAudio
} from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';

export interface StemFile {
	name: string;
	mimeType: string;
	data: Uint8Array;
	blob: Blob; // Keep original blob for download
}

// VirtualDJ stem mapping: stream index -> stem name
const STEM_MAPPING: Record<number, string> = {
	0: 'Vocals',
	1: 'HiHat',
	2: 'Bass',
	3: 'Melody',
	4: 'Drums'
};

class StemExtractor {
	private mp3EncoderRegistered = false;

	/**
	 * Ensure MP3 encoder is registered (lazy initialization)
	 */
	private async ensureMp3Encoder(): Promise<void> {
		if (this.mp3EncoderRegistered) {
			return;
		}

		// Check if native MP3 encoding is available, if not register the custom encoder
		if (!(await canEncodeAudio('mp3'))) {
			registerMp3Encoder();
		}
		this.mp3EncoderRegistered = true;
	}

	/**
	 * Extract stems from a VirtualDJ .vdjstems file using Mediabunny
	 * @param file The .vdjstems file to extract from
	 * @param onProgress Optional callback for progress updates
	 */
	async extractVirtualDjStems(
		file: File,
		onProgress?: (message: string) => void
	): Promise<StemFile[]> {
		const outputFiles: StemFile[] = [];

		try {
			// Initialize Mediabunny input and ensure MP3 encoder is available
			if (onProgress) {
				onProgress('Initializing Mediabunny...');
			}
			await this.ensureMp3Encoder();

			const input = new Input({
				source: new BlobSource(file),
				formats: ALL_FORMATS
			});

			// Get available audio tracks
			if (onProgress) {
				onProgress('Reading audio tracks...');
			}
			const audioTracks = await input.getAudioTracks();

			if (audioTracks.length === 0) {
				throw new Error('No audio tracks found in the file');
			}

			// Extract up to 5 stems (standard VirtualDJ mapping)
			const maxStems = Math.min(5, audioTracks.length);

			if (onProgress) {
				onProgress(`Extracting ${maxStems} stems...`);
			}

			// Process each track
			for (let i = 0; i < maxStems; i++) {
				const stemName = STEM_MAPPING[i];
				if (!stemName) break;

				const track = audioTracks[i];
				if (!track) {
					console.warn(`Track ${i} not available, skipping ${stemName}`);
					continue;
				}

				try {
					if (onProgress) {
						onProgress(`Extracting ${stemName}...`);
					}

					// Create output target for this stem
					const target = new BufferTarget();
					const output = new Output({
						format: new Mp3OutputFormat(),
						target
					});

					// Create conversion that keeps only this track
					// Use the function form of audio to filter by track index
					const conversion = await Conversion.init({
						input,
						output,
						audio: (audioTrack, trackIndex) => {
							// Only keep the track at the current index, discard all others
							if (trackIndex === i + 1) {
								// Keep the track and set bitrate
								return {
									bitrate: 192e3 // 192 kbps
								};
							} else {
								// Discard all other tracks
								return { discard: true };
							}
						}
					});

					// Check if conversion is valid before executing
					if (!conversion.isValid) {
						const discardedReasons = conversion.discardedTracks.map(t => t.reason).join(', ');
						throw new Error(`Conversion invalid for ${stemName}. Discarded tracks: ${discardedReasons}`);
					}

					// Execute conversion
					await conversion.execute();

					// Get the output data from BufferTarget
					if (!target.buffer) {
						throw new Error(`No buffer generated for ${stemName}`);
					}

					// Ensure we have a proper ArrayBuffer (not SharedArrayBuffer)
					const arrayBuffer = target.buffer.slice(0) as ArrayBuffer;
					const uint8Array = new Uint8Array(arrayBuffer);
					const blob = new Blob([uint8Array], { type: 'audio/mpeg' });

					outputFiles.push({
						name: stemName,
						mimeType: 'audio/mpeg',
						data: uint8Array,
						blob: blob
					});
				} catch (error) {
					// If a stem fails to extract, log but continue with others
					console.warn(`Failed to extract stem ${stemName}:`, error);
					if (onProgress) {
						onProgress(`Warning: Failed to extract ${stemName}, continuing...`);
					}
				}
			}

			if (outputFiles.length === 0) {
				throw new Error('No stems were successfully extracted from the file');
			}

			if (onProgress) {
				onProgress(`Successfully extracted ${outputFiles.length} stems`);
			}

			return outputFiles;
		} catch (error) {
			throw new Error(`Failed to extract stems: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Get initialization status (kept for backward compatibility)
	 * Mediabunny doesn't require initialization, so this always returns true
	 */
	get isReady(): boolean {
		return true;
	}
}

// Export singleton instance
export const stemExtractor = new StemExtractor();

