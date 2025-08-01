<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import WaveSurfer from 'wavesurfer.js';
	import type { Beat, Tag } from '../types';

	interface Props {
		beats: Beat[];
		tags: Record<string, Tag>;
		currentBeatIndex: number;
		currentTime: number;
		bpm: number;
		audioBuffer: ArrayBuffer | null;
		beatOffset: number;
		beatsPerLine: number;
		onChunkLoop?: (chunkIndex: number, startTime: number, endTime: number) => void;
		onClearLoop?: () => void;
		loopingChunkIndex?: number;
		onSeek?: (time: number) => void;
		onBeatsPerLineChange?: (value: number) => void;
	}

	let { 
		beats = [], 
		tags = {}, 
		currentBeatIndex = -1, 
		currentTime = 0, 
		bpm = 120,
		audioBuffer = null,
		beatOffset = 0,
		beatsPerLine = 4,
		onChunkLoop,
		onClearLoop,
		loopingChunkIndex = -1,
		onSeek,
		onBeatsPerLineChange
	}: Props = $props();

	let waveformContainer: HTMLDivElement | undefined = $state();
	let chunksContainer: HTMLDivElement | undefined = $state();
	let wavesurfer: WaveSurfer | null = null;
	let beatGrouping = $state(beatsPerLine);
	let isInitialized = $state(false);
	let peaksData: Float32Array | null = $state(null);
	let audioSampleRate = $state(44100); // Will be updated from actual audio
	let audioDuration = $state(0);

	// Derived values
	const chunkDuration = $derived(beatGrouping * (60 / bpm));
	const totalChunks = $derived(audioDuration > 0 ? Math.ceil(audioDuration / chunkDuration) : 0);

	onMount(async () => {
		if (audioBuffer && waveformContainer && chunksContainer) {
			await initializeWaveSurfer();
		}
	});

	onDestroy(() => {
		if (wavesurfer) {
			wavesurfer.destroy();
		}
	});

	async function initializeWaveSurfer() {
		if (!waveformContainer || !audioBuffer) return;

		try {
			// Create WaveSurfer instance (hidden, used only for peak extraction)
			wavesurfer = WaveSurfer.create({
				container: waveformContainer,
				height: 0, // Hidden - we'll render our own chunks
				waveColor: 'transparent',
				progressColor: 'transparent',
				interact: false, // Disable interaction on hidden waveform
			});

			// Load audio from ArrayBuffer
			const blob = new Blob([audioBuffer], { type: 'audio/wav' });
			const url = URL.createObjectURL(blob);
			
			// Listen for decode event to extract peaks
			wavesurfer.on('decode', () => {
				extractPeaksData();
			});

			await wavesurfer.load(url);
			
			// Clean up blob URL
			URL.revokeObjectURL(url);
			
			isInitialized = true;
			setupPlaybackSync();

		} catch (error) {
			console.error('Failed to initialize WaveSurfer:', error);
		}
	}

	function extractPeaksData() {
		if (!wavesurfer) return;

		try {
			// Extract decoded audio data
			const audioBuffer = wavesurfer.getDecodedData();
			if (!audioBuffer) return;

			// Update audio metadata
			audioSampleRate = audioBuffer.sampleRate;
			audioDuration = audioBuffer.duration;

			// Extract peaks from left channel (or mono)
			peaksData = audioBuffer.getChannelData(0);
			
			// Render chunked canvases
			renderChunkedCanvases();
		} catch (error) {
			console.error('Failed to extract peaks data:', error);
		}
	}

	function setupPlaybackSync() {
		if (!wavesurfer) return;

		// Sync WaveSurfer position with external currentTime
		wavesurfer.on('ready', () => {
			// Update WaveSurfer position when currentTime changes externally
			if (wavesurfer && Math.abs(wavesurfer.getCurrentTime() - currentTime) > 0.1) {
				wavesurfer.seekTo(currentTime / wavesurfer.getDuration());
			}
		});
	}

	// Reactive updates
	$effect(() => {
		if (isInitialized && peaksData) {
			// Update playhead bars
			drawPlayheadBars();
		}
	});

	// Update beatGrouping when beatsPerLine prop changes
	$effect(() => {
		beatGrouping = beatsPerLine;
	});

	$effect(() => {
		// Re-initialize when audioBuffer changes
		if (audioBuffer && waveformContainer && !isInitialized) {
			initializeWaveSurfer();
		}
	});

	$effect(() => {
		// Re-render chunks when BPM, cutting number, or beat offset changes
		if (isInitialized && peaksData) {
			renderChunkedCanvases();
		}
	});


	function getChunkStartTime(chunkIndex: number): number {
		return chunkIndex * chunkDuration;
	}

	function getBeatsInChunk(chunkIndex: number): Beat[] {
		const chunkStartTime = getChunkStartTime(chunkIndex);
		const chunkEndTime = chunkStartTime + chunkDuration;
		
		return beats.filter(beat => 
			beat.time >= chunkStartTime && beat.time < chunkEndTime
		);
	}

	function renderChunkedCanvases() {
		if (!peaksData || !chunksContainer || totalChunks === 0) return;

		// Clear existing canvases
		chunksContainer.innerHTML = '';

		// Render each chunk
		for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
			renderChunk(chunkIndex);
		}
	}

	function renderChunk(chunkIndex: number) {
		if (!peaksData || !chunksContainer) return;

		// Calculate chunk boundaries in samples
		const chunkStartTime = chunkIndex * chunkDuration;
		const chunkEndTime = Math.min((chunkIndex + 1) * chunkDuration, audioDuration);
		const startSample = Math.floor(chunkStartTime * audioSampleRate);
		const endSample = Math.floor(chunkEndTime * audioSampleRate);
		
		// Extract chunk peaks
		const chunkPeaks = peaksData.slice(startSample, endSample);
		
		// Create canvas for this chunk
		const canvas = document.createElement('canvas');
		const canvasWidth = chunksContainer.offsetWidth || 800;
		const canvasHeight = 120;
		
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas.className = 'chunk-canvas border border-gray-600 mb-2 rounded';
		canvas.style.display = 'block';
		canvas.style.backgroundColor = '#1f2937';
		
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Draw waveform
		drawWaveform(ctx, chunkPeaks, canvasWidth, canvasHeight);
		
		// Draw beat markers for this chunk
		drawChunkBeatMarkers(ctx, chunkIndex, canvasWidth, canvasHeight);
		
		// Add click listener for seeking
		canvas.addEventListener('click', (e) => {
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const clickTime = chunkStartTime + (x / canvasWidth) * chunkDuration;
			seekToTime(clickTime);
		});

		// Create container for chunk with label and loop button
		const chunkContainer = document.createElement('div');
		chunkContainer.className = 'chunk-container mb-3';
		
		const headerContainer = document.createElement('div');
		headerContainer.className = 'flex items-center justify-between mb-1';
		
		const chunkLabel = document.createElement('div');
		chunkLabel.className = 'text-xs text-gray-400';
		chunkLabel.textContent = `Chunk ${chunkIndex + 1} (${chunkStartTime.toFixed(1)}s - ${chunkEndTime.toFixed(1)}s)`;
		
		const loopButton = document.createElement('button');
		loopButton.className = 'px-2 py-1 text-xs rounded transition-colors ' + 
			(loopingChunkIndex === chunkIndex 
				? 'bg-blue-600 hover:bg-blue-700 text-white' 
				: 'bg-gray-700 hover:bg-gray-600 text-gray-300');
		loopButton.textContent = loopingChunkIndex === chunkIndex ? '🔁 Stop Loop' : '🔁 Loop';
		loopButton.onclick = () => handleLoopToggle(chunkIndex, chunkStartTime, chunkEndTime);
		
		headerContainer.appendChild(chunkLabel);
		headerContainer.appendChild(loopButton);
		chunkContainer.appendChild(headerContainer);
		chunkContainer.appendChild(canvas);
		chunksContainer.appendChild(chunkContainer);
	}

	function drawWaveform(ctx: CanvasRenderingContext2D, peaks: Float32Array, width: number, height: number) {
		const barWidth = width / peaks.length;
		const halfHeight = height / 2;
		
		ctx.fillStyle = '#3b82f6';
		
		for (let i = 0; i < peaks.length; i += Math.ceil(peaks.length / width)) {
			const x = (i / peaks.length) * width;
			const barHeight = Math.abs(peaks[i]) * halfHeight;
			
			// Draw bar from center
			ctx.fillRect(x, halfHeight - barHeight, Math.max(1, barWidth), barHeight * 2);
		}
	}

	function drawChunkBeatMarkers(ctx: CanvasRenderingContext2D, chunkIndex: number, width: number, height: number) {
		const chunkStartTime = chunkIndex * chunkDuration;
		const chunkBeats = getBeatsInChunk(chunkIndex);
		
		chunkBeats.forEach((beat) => {
			const adjustedTime = beat.time + (beatOffset / 1000) - chunkStartTime;
			const x = (adjustedTime / chunkDuration) * width;
			
			// Skip if outside chunk bounds
			if (x < 0 || x > width) return;
			
			// Different line styles for different beat boundaries
			if ((beat.index + 1) % 16 === 0) {
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
				ctx.lineWidth = 3;
			} else if ((beat.index + 1) % 8 === 0) {
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
				ctx.lineWidth = 2;
			} else if ((beat.index + 1) % 4 === 0) {
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
				ctx.lineWidth = 1.5;
			} else {
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
				ctx.lineWidth = 1;
			}
			
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
		});
	}

	function seekToTime(time: number) {
		// Trigger the parent component to seek to the specified time
		onSeek?.(time);
	}
	
	function handleLoopToggle(chunkIndex: number, startTime: number, endTime: number) {
		if (loopingChunkIndex === chunkIndex) {
			// Clear the loop
			onClearLoop?.();
		} else {
			// Set new loop
			onChunkLoop?.(chunkIndex, startTime, endTime);
		}
	}


	function drawPlayheadBars() {
		if (!chunksContainer || !isInitialized || audioDuration <= 0) return;

		// Remove existing playheads
		const existingPlayheads = chunksContainer.querySelectorAll('.playhead-bar');
		existingPlayheads.forEach(el => el.remove());

		// Find which chunk contains the current time
		const currentChunkIndex = Math.floor(currentTime / chunkDuration);
		if (currentChunkIndex < 0 || currentChunkIndex >= totalChunks) return;

		// Find the canvas for the current chunk
		const chunkCanvases = chunksContainer.querySelectorAll('.chunk-canvas');
		const currentCanvas = chunkCanvases[currentChunkIndex] as HTMLCanvasElement;
		if (!currentCanvas) return;

		// Calculate position within the chunk
		const chunkStartTime = currentChunkIndex * chunkDuration;
		const timeInChunk = currentTime - chunkStartTime;
		const x = (timeInChunk / chunkDuration) * currentCanvas.offsetWidth;

		// Create playhead element
		const playhead = document.createElement('div');
		playhead.className = 'playhead-bar';
		playhead.style.position = 'absolute';
		playhead.style.top = '0';
		playhead.style.left = `${x}px`;
		playhead.style.width = '3px';
		playhead.style.height = '100%';
		playhead.style.backgroundColor = '#fbbf24';
		playhead.style.boxShadow = '0 0 4px rgba(251, 191, 36, 0.8)';
		playhead.style.pointerEvents = 'none';
		playhead.style.zIndex = '20';
		playhead.style.transition = 'left 0.1s ease-out';

		// Position relative to the canvas
		const canvasRect = currentCanvas.getBoundingClientRect();
		const containerRect = chunksContainer.getBoundingClientRect();
		
		playhead.style.top = `${canvasRect.top - containerRect.top}px`;
		playhead.style.height = `${currentCanvas.offsetHeight}px`;

		chunksContainer.style.position = 'relative';
		chunksContainer.appendChild(playhead);
	}

</script>

{#if audioBuffer}
	<div class="bg-gray-800 rounded-lg p-4">
		<div class="flex items-center justify-between mb-4">
			<h3 class="text-lg font-semibold text-gray-200">Chunked Waveform Display</h3>
			<div class="flex items-center space-x-4">
				<label class="text-sm text-gray-300 flex items-center space-x-2">
					<span>Beats per line:</span>
					<input 
						type="number" 
						bind:value={beatGrouping}
						on:input={(e) => onBeatsPerLineChange?.(Number(e.currentTarget.value))}
						class="bg-gray-700 text-white px-2 py-1 rounded w-16 text-sm"
						min="1" 
						max="16"
					/>
				</label>
				<div class="text-sm text-gray-400">
					Current: {Math.floor(currentTime / chunkDuration) + 1} / {totalChunks}
				</div>
			</div>
		</div>

		<!-- Hidden WaveSurfer Container (for peak extraction) -->
		<div bind:this={waveformContainer} class="hidden"></div>

		<!-- Chunked Canvases Container -->
		<div bind:this={chunksContainer} class="space-y-2 overflow-y-auto"></div>

		{#if isInitialized && peaksData}
			<!-- Chunk Information -->
			<div class="mt-4 space-y-2">
				<div class="text-sm text-gray-400">
					<span>Duration: {audioDuration.toFixed(1)}s</span>
					<span class="mx-2">•</span>
					<span>Chunk Duration: {chunkDuration.toFixed(2)}s</span>
					<span class="mx-2">•</span>
					<span>Total Chunks: {totalChunks}</span>
					<span class="mx-2">•</span>
					<span>Beats per Chunk: {beatGrouping}</span>
				</div>
				<div class="text-xs text-gray-500">
					Sample Rate: {audioSampleRate}Hz • Samples: {peaksData.length.toLocaleString()}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<div class="bg-gray-800 rounded-lg p-4">
		<div class="text-center text-gray-400">
			<p>Load an audio file to see the chunked waveform</p>
		</div>
	</div>
{/if}

<style>
	/* Custom styles for WaveSurfer container */
	:global(.wavesurfer-container) {
		width: 100%;
	}
</style>