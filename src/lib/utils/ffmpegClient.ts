import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

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

class FFmpegClient {
	private ffmpeg: FFmpeg | null = null;
	private isInitialized = false;
	private initPromise: Promise<void> | null = null;

	/**
	 * Initialize ffmpeg.wasm (lazy-loaded, singleton)
	 */
	private async initialize(): Promise<void> {
		// Return existing promise if initialization is in progress
		if (this.initPromise) {
			return this.initPromise;
		}

		this.initPromise = (async () => {
			if (this.isInitialized && this.ffmpeg) {
				return;
			}

			this.ffmpeg = new FFmpeg();

			// Set up progress logging (optional, for debugging)
			this.ffmpeg.on('log', ({ message }) => {
				console.log('[FFmpeg]', message);
			});

			// Load ffmpeg.wasm core on demand
			// Use CDN URLs for the wasm files (they'll be fetched when needed)
			// This avoids Vite bundling issues with worker files
			
			// Try to use multi-threaded version if SharedArrayBuffer is available (faster)
			// Otherwise fall back to single-threaded version
			const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
			const coreVersion = hasSharedArrayBuffer ? 'mt' : '';
			const baseURL = `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm`;
			
			try {
				// Use toBlobURL to convert the CDN URLs to blob URLs
				// This ensures they're loaded dynamically and not processed by Vite
				const coreURL = await toBlobURL(
					`${baseURL}/ffmpeg-core${coreVersion}.js`, 
					'text/javascript'
				);
				const wasmURL = await toBlobURL(
					`${baseURL}/ffmpeg-core${coreVersion}.wasm`, 
					'application/wasm'
				);
				
				await this.ffmpeg.load({
					coreURL,
					wasmURL,
				});
				this.isInitialized = true;
				
				if (hasSharedArrayBuffer) {
					console.log('[FFmpeg] Using multi-threaded core for better performance');
				}
			} catch (error) {
				console.error('Failed to load ffmpeg.wasm:', error);
				this.initPromise = null;
				throw new Error(`Failed to initialize ffmpeg: ${error}`);
			}
		})();

		return this.initPromise;
	}

	/**
	 * Extract stems from a VirtualDJ .vdjstems file
	 * @param file The .vdjstems file to extract from
	 * @param onProgress Optional callback for progress updates
	 */
	async extractVirtualDjStems(
		file: File, 
		onProgress?: (message: string) => void
	): Promise<StemFile[]> {
		// Ensure ffmpeg is initialized
		await this.initialize();

		if (!this.ffmpeg) {
			throw new Error('FFmpeg not initialized');
		}

		const inputFileName = 'input.vdjstems';
		const outputFiles: StemFile[] = [];
		const outputFileNames: string[] = [];

		// Set up progress handler
		const progressHandler = ({ message }: { message: string }) => {
			if (onProgress) {
				// Parse ffmpeg output for useful progress info
				// FFmpeg outputs lines like: "frame=  123 fps= 45 q=28.0 size=    1024kB time=00:00:05.12 bitrate=1638.4kbits/s"
				if (message.includes('time=')) {
					// Extract time information
					const timeMatch = message.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
					if (timeMatch) {
						onProgress(`Processing: ${timeMatch[1]}`);
					} else {
						// Show the log message if it's not just noise
						if (!message.includes('frame=') || message.includes('error') || message.includes('warning')) {
							onProgress(message);
						}
					}
				} else if (message.includes('error') || message.includes('Error')) {
					onProgress(`Error: ${message}`);
				} else if (!message.includes('frame=') && message.trim().length > 0) {
					// Show other meaningful messages
					onProgress(message);
				}
			}
		};

		// Set up log handler for progress
		this.ffmpeg.on('log', progressHandler);

		try {
			// Write input file to virtual filesystem
			if (onProgress) {
				onProgress('Reading input file...');
			}
			await this.ffmpeg.writeFile(inputFileName, await fetchFile(file));

			// Extract each stem using ffmpeg's -map option
			// Build command: -i input.vdjstems -map 0:a:0 Vocals.mp3 -map 0:a:1 HiHat.mp3 ...
			const mapArgs: string[] = [];

			// First, probe the file to see how many audio streams exist
			// We'll try to extract up to 5 stems (the standard VirtualDJ mapping)
			for (let i = 0; i < 5; i++) {
				const stemName = STEM_MAPPING[i];
				if (!stemName) break;

				const outputFileName = `${stemName}.mp3`;
				outputFileNames.push(outputFileName);
				mapArgs.push('-map', `0:a:${i}`, outputFileName);
			}

			// Run ffmpeg command to extract all stems
			// Try -c copy first (fastest), but if that fails, we'll re-encode
			// Format: ffmpeg -i input.vdjstems -c copy -map 0:a:0 Vocals.mp3 -map 0:a:1 HiHat.mp3 ...
			// Note: Using -c:a libmp3lame to ensure browser-compatible MP3 encoding
			if (onProgress) {
				onProgress(`Extracting ${outputFileNames.length} stems...`);
			}
			await this.ffmpeg.exec([
				'-i', inputFileName,
				'-c:a', 'libmp3lame', // Re-encode to MP3 for browser compatibility
				'-b:a', '192k', // Bitrate for quality/speed balance
				...mapArgs
			]);

			// Read each output file from virtual filesystem
			for (let i = 0; i < outputFileNames.length; i++) {
				const outputFileName = outputFileNames[i];
				try {
					if (onProgress) {
						onProgress(`Reading stem ${i + 1}/${outputFileNames.length}: ${outputFileName.replace('.mp3', '')}...`);
					}
					const data = await this.ffmpeg.readFile(outputFileName) as Uint8Array;
					
					// readFile returns Uint8Array - ensure we have a proper ArrayBuffer
					// Create a new ArrayBuffer to avoid SharedArrayBuffer issues
					const arrayBuffer = data.buffer.slice(
						data.byteOffset,
						data.byteOffset + data.byteLength
					) as ArrayBuffer;
					const uint8Array = new Uint8Array(arrayBuffer);

					// Create blob for download - ensure we use ArrayBuffer, not SharedArrayBuffer
					const blob = new Blob([uint8Array], { type: 'audio/mpeg' });

					// Extract stem name from filename (remove .mp3 extension)
					const stemName = outputFileName.replace('.mp3', '');

					outputFiles.push({
						name: stemName,
						mimeType: 'audio/mpeg',
						data: uint8Array,
						blob: blob
					});

					// Clean up virtual file
					await this.ffmpeg.deleteFile(outputFileName);
				} catch (error) {
					// If a stem fails to extract, log but continue with others
					console.warn(`Failed to extract stem ${outputFileName}:`, error);
				}
			}

			// Clean up input file
			await this.ffmpeg.deleteFile(inputFileName);

			if (outputFiles.length === 0) {
				throw new Error('No stems were successfully extracted from the file');
			}

			return outputFiles;
		} catch (error) {
			// Clean up on error
			if (this.ffmpeg) {
				try {
					try {
						await this.ffmpeg.deleteFile(inputFileName);
					} catch (e) {
						// Ignore cleanup errors
					}
					for (const outputFileName of outputFileNames) {
						try {
							await this.ffmpeg.deleteFile(outputFileName);
						} catch (e) {
							// Ignore cleanup errors
						}
					}
				} catch (e) {
					// Ignore cleanup errors
				}
			}

			throw new Error(`Failed to extract stems: ${error}`);
		} finally {
			// Remove progress handler
			this.ffmpeg.off('log', progressHandler);
		}
	}

	/**
	 * Get initialization status
	 */
	get isReady(): boolean {
		return this.isInitialized;
	}
}

// Export singleton instance
export const ffmpegClient = new FFmpegClient();

