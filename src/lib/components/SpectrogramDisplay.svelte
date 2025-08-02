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
	let lastRenderedLoopIndex = -999; // Track last rendered state to avoid unnecessary re-renders

	// Derived values
	const chunkDuration = $derived(beatGrouping * (60 / bpm));
	const totalChunks = $derived.by(() => {
		if (audioDuration <= 0) return 0;
		const baseChunks = Math.ceil(audioDuration / chunkDuration);
		// Add extra chunk at beginning when offset is positive (to show pre-song space)
		// Add extra chunk at end when offset is negative (to show post-song space)
		if (beatOffset > 0) return baseChunks + 1;
		if (beatOffset < 0) return baseChunks + 1;
		return baseChunks;
	});

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

	function updateLoopButtonStyling() {
		if (!chunksContainer) return;
		
		// Update all loop buttons
		const loopButtons = chunksContainer.querySelectorAll('button[data-chunk-index]');
		loopButtons.forEach((button) => {
			const btnElement = button as HTMLButtonElement;
			const chunkIndex = parseInt(btnElement.dataset.chunkIndex || '-999');
			const isActive = loopingChunkIndex === chunkIndex;
			
			btnElement.className = 'absolute right-4 px-3 py-1 text-xs font-medium rounded-t-md transition-all transform ' + 
				(isActive 
					? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg' 
					: 'bg-gray-700 hover:bg-gray-600 text-gray-300');
			
			btnElement.innerHTML = isActive 
				? '<span class="flex items-center gap-1">🔁 Loop Active</span>' 
				: '<span class="flex items-center gap-1">🔁 Loop</span>';
		});
	}

	// Update loop button styling when loopingChunkIndex changes
	$effect(() => {
		if (!chunksContainer || lastRenderedLoopIndex === loopingChunkIndex) return;
		
		updateLoopButtonStyling();
		lastRenderedLoopIndex = loopingChunkIndex;
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

	// Track previous values to prevent unnecessary re-renders
	let prevBpm = bpm;
	let prevBeatGrouping = beatGrouping;
	let prevBeatOffset = beatOffset;

	$effect(() => {
		// Re-render chunks ONLY when BPM, beats per line, or beat offset changes
		const shouldRerender = bpm !== prevBpm || beatGrouping !== prevBeatGrouping || beatOffset !== prevBeatOffset;
		
		if (shouldRerender && isInitialized && peaksData) {
			prevBpm = bpm;
			prevBeatGrouping = beatGrouping;
			prevBeatOffset = beatOffset;
			renderChunkedCanvases();
		}
	});


	function getChunkStartTime(chunkIndex: number): number {
		return chunkIndex * chunkDuration;
	}

	function renderChunkedCanvases() {
		if (!peaksData || !chunksContainer || totalChunks === 0) return;

		// Store current scroll position
		const currentScrollTop = chunksContainer.scrollTop;

		// Clear existing canvases
		chunksContainer.innerHTML = '';

		// Determine chunk range based on offset
		let startChunkIndex: number;
		let endChunkIndex: number;
		
		if (beatOffset > 0) {
			// Positive offset: add chunk -1 at beginning
			startChunkIndex = -1;
			endChunkIndex = totalChunks - 1;
		} else if (beatOffset < 0) {
			// Negative offset: also add chunk -1 at beginning
			startChunkIndex = -1;
			endChunkIndex = totalChunks - 1;
		} else {
			// No offset: normal range
			startChunkIndex = 0;
			endChunkIndex = totalChunks;
		}

		// Render each chunk
		for (let chunkIndex = startChunkIndex; chunkIndex < endChunkIndex; chunkIndex++) {
			renderChunk(chunkIndex);
		}

		// Update loop button styling after rendering
		requestAnimationFrame(() => {
			updateLoopButtonStyling();
		});

		// Restore scroll position
		requestAnimationFrame(() => {
			if (chunksContainer) {
				chunksContainer.scrollTop = currentScrollTop;
			}
		});
	}

	function renderPreSongChunk() {
		if (!peaksData || !chunksContainer) return;

		const offsetInSeconds = beatOffset / 1000;
		const canvasWidth = chunksContainer.offsetWidth || 800;
		const canvasHeight = 120;

		// Calculate the visual offset in pixels (how much to shift the waveform)
		const offsetInPixels = (offsetInSeconds / chunkDuration) * canvasWidth;
		const songStartX = offsetInPixels;

		// Extract audio data for the song portion - full chunkDuration worth
		const songSamples = Math.floor(chunkDuration * audioSampleRate);
		const songPeaks = peaksData.slice(0, songSamples);

		// Create canvas
		const canvas = document.createElement('canvas');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas.className = 'chunk-canvas border border-gray-600 mb-2 rounded';
		canvas.style.display = 'block';
		canvas.style.backgroundColor = '#1f2937';

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Draw pre-song empty space
		drawPreSongSpace(ctx, 0, songStartX, canvasHeight);

		// Draw song start marker
		drawSongStartMarker(ctx, songStartX, canvasHeight);

		// Draw waveform for song portion - at full scale, shifted by offset
		if (songPeaks.length > 0) {
			drawWaveformSection(ctx, songPeaks, songStartX, canvasWidth, canvasHeight);
		}

		// Draw beat markers
		drawChunkBeatMarkers(ctx, -1, canvasWidth, canvasHeight);

		// Add click listener
		canvas.addEventListener('click', (e) => {
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			
			if (x < songStartX) {
				// Click in pre-song space - seek to beginning
				seekToTime(0);
			} else {
				// Click in song portion - calculate time based on position relative to start
				const timeInSongPortion = ((x - songStartX) / canvasWidth) * chunkDuration;
				seekToTime(timeInSongPortion);
			}
		});

		// Create container with label
		const chunkContainer = document.createElement('div');
		chunkContainer.className = 'chunk-container mb-3';
		
		const headerContainer = document.createElement('div');
		headerContainer.className = 'flex items-center justify-between mb-1';
		
		const chunkLabel = document.createElement('div');
		chunkLabel.className = 'text-xs text-gray-400';
		chunkLabel.textContent = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;
		
		headerContainer.appendChild(chunkLabel);
		chunkContainer.appendChild(headerContainer);
		chunkContainer.appendChild(canvas);
		chunksContainer.appendChild(chunkContainer);
	}

	function renderPostSongChunk() {
		if (!peaksData || !chunksContainer) return;

		const offsetInSeconds = Math.abs(beatOffset) / 1000; // Convert to positive
		const canvasWidth = chunksContainer.offsetWidth || 800;
		const canvasHeight = 120;

		// For negative offset, chunk -1 should show mostly empty space on left, small bit of song on right
		const emptySpaceWidth = canvasWidth - (offsetInSeconds / chunkDuration) * canvasWidth;
		const songStartX = emptySpaceWidth;

		// Extract first bit of song data (the amount pushed into the negative space)
		const songPortionDuration = offsetInSeconds;
		const songSamples = Math.floor(songPortionDuration * audioSampleRate);
		const songPeaks = peaksData.slice(0, songSamples);

		// Create canvas
		const canvas = document.createElement('canvas');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
		canvas.className = 'chunk-canvas border border-gray-600 mb-2 rounded';
		canvas.style.display = 'block';
		canvas.style.backgroundColor = '#1f2937';

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Draw pre-song empty space (most of the chunk)
		drawPreSongSpace(ctx, 0, songStartX, canvasHeight);

		// Draw song start marker
		drawSongStartMarker(ctx, songStartX, canvasHeight);

		// Draw small waveform portion (pushed into the negative space)
		if (songPeaks.length > 0) {
			const songPortionWidth = canvasWidth - songStartX;
			drawWaveformSection(ctx, songPeaks, songStartX, songPortionWidth, canvasHeight);
		}

		// Draw beat markers
		drawChunkBeatMarkers(ctx, -1, canvasWidth, canvasHeight);

		// Add click listener
		canvas.addEventListener('click', (e) => {
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			
			if (x < songStartX) {
				// Click in pre-song space - seek to beginning
				seekToTime(0);
			} else {
				// Click in song portion - calculate time within the small song portion
				const timeInSongPortion = ((x - songStartX) / (canvasWidth - songStartX)) * songPortionDuration;
				seekToTime(timeInSongPortion);
			}
		});

		// Create container with label
		const chunkContainer = document.createElement('div');
		chunkContainer.className = 'chunk-container mb-3';
		
		const headerContainer = document.createElement('div');
		headerContainer.className = 'flex items-center justify-between mb-1';
		
		const chunkLabel = document.createElement('div');
		chunkLabel.className = 'text-xs text-gray-400';
		chunkLabel.textContent = `Pre-song negative (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${(songStartX / canvasWidth * chunkDuration).toFixed(1)}s in display)`;
		
		headerContainer.appendChild(chunkLabel);
		chunkContainer.appendChild(headerContainer);
		chunkContainer.appendChild(canvas);
		chunksContainer.appendChild(chunkContainer);
	}


	function renderChunk(chunkIndex: number) {
		if (!peaksData || !chunksContainer) return;

		// Special handling for chunk -1
		if (chunkIndex === -1) {
			if (beatOffset > 0) {
				renderPreSongChunk();
			} else if (beatOffset < 0) {
				renderPostSongChunk();
			}
			return;
		}

		// Calculate chunk boundaries
		let chunkStartTime: number;
		let chunkEndTime: number;
		
		if (beatOffset > 0) {
			// When chunk -1 exists, regular chunks are shifted by the offset
			const offsetInSeconds = beatOffset / 1000;
			// Chunk 0 should show what would normally be at (chunkDuration - offsetInSeconds)
			// So it covers (chunkDuration - offsetInSeconds) to (2*chunkDuration - offsetInSeconds)
			chunkStartTime = chunkDuration - offsetInSeconds + chunkIndex * chunkDuration;
			chunkEndTime = chunkDuration - offsetInSeconds + (chunkIndex + 1) * chunkDuration;
		} else if (beatOffset < 0) {
			// When negative offset, regular chunks are shifted forward by the offset amount
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			// Chunks show content shifted forward in time
			chunkStartTime = chunkIndex * chunkDuration + offsetInSeconds;
			chunkEndTime = (chunkIndex + 1) * chunkDuration + offsetInSeconds;
		} else {
			// Normal chunk boundaries when no offset
			chunkStartTime = chunkIndex * chunkDuration;
			chunkEndTime = (chunkIndex + 1) * chunkDuration;
		}
		
		// Ensure we don't go beyond audio bounds
		const clampedStartTime = Math.max(0, chunkStartTime);
		const clampedEndTime = Math.min(chunkEndTime, audioDuration);
		
		const startSample = Math.floor(clampedStartTime * audioSampleRate);
		const endSample = Math.floor(clampedEndTime * audioSampleRate);
		
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
			
			// Calculate click time based on actual chunk boundaries
			const clickTime = clampedStartTime + (x / canvasWidth) * (clampedEndTime - clampedStartTime);
			seekToTime(clickTime);
		});

		// Create container for chunk with label and loop button
		const chunkContainer = document.createElement('div');
		chunkContainer.className = 'chunk-container mb-3 relative';
		
		const headerContainer = document.createElement('div');
		headerContainer.className = 'flex items-center justify-between mb-1';
		
		const chunkLabel = document.createElement('div');
		chunkLabel.className = 'text-xs text-gray-400';
		chunkLabel.textContent = `Chunk ${chunkIndex + 1} (${chunkStartTime.toFixed(1)}s - ${chunkEndTime.toFixed(1)}s)`;
		
		headerContainer.appendChild(chunkLabel);
		chunkContainer.appendChild(headerContainer);
		
		// Create canvas wrapper for positioning the loop tab
		const canvasWrapper = document.createElement('div');
		canvasWrapper.className = 'relative';
		
		// Create loop tab button attached to top of canvas
		const loopTab = document.createElement('button');
		// Don't use loopingChunkIndex here - we'll update the styling separately
		loopTab.className = 'absolute right-4 px-3 py-1 text-xs font-medium rounded-t-md transition-all transform bg-gray-700 hover:bg-gray-600 text-gray-300';
		loopTab.style.bottom = '100%';
		loopTab.style.marginBottom = '-1px'; // Connect seamlessly to canvas border
		loopTab.style.borderBottomLeftRadius = '0';
		loopTab.style.borderBottomRightRadius = '0';
		loopTab.dataset.chunkIndex = chunkIndex.toString(); // Add data attribute for easier finding
		loopTab.innerHTML = '<span class="flex items-center gap-1">🔁 Loop</span>';
		loopTab.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			handleLoopToggle(chunkIndex, chunkStartTime, chunkEndTime);
		};
		
		canvasWrapper.appendChild(loopTab);
		canvasWrapper.appendChild(canvas);
		chunkContainer.appendChild(canvasWrapper);
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

	function drawPreSongSpace(ctx: CanvasRenderingContext2D, startX: number, endX: number, height: number) {
		// Draw a darker, hatched pattern to indicate pre-song void
		ctx.fillStyle = '#111827'; // Darker gray
		ctx.fillRect(startX, 0, endX - startX, height);
		
		// Add diagonal hatching pattern
		ctx.strokeStyle = 'rgba(75, 85, 99, 0.3)';
		ctx.lineWidth = 1;
		const spacing = 10;
		
		for (let x = startX; x < endX; x += spacing) {
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x + spacing, height);
			ctx.stroke();
		}
	}

	function drawSongStartMarker(ctx: CanvasRenderingContext2D, x: number, height: number) {
		// Draw a prominent vertical line to mark song start
		ctx.strokeStyle = '#10b981'; // Green color to distinguish from beat markers
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(x, 0);
		ctx.lineTo(x, height);
		ctx.stroke();
		
		// Add a small label
		ctx.fillStyle = '#10b981';
		ctx.font = '10px sans-serif';
		ctx.fillText('START', x + 5, 15);
	}

	function drawWaveformSection(ctx: CanvasRenderingContext2D, peaks: Float32Array, startX: number, width: number, height: number) {
		if (peaks.length === 0 || width <= 0) return;
		
		const barWidth = width / peaks.length;
		const halfHeight = height / 2;
		
		ctx.fillStyle = '#3b82f6';
		
		for (let i = 0; i < peaks.length; i += Math.ceil(peaks.length / width)) {
			const x = startX + (i / peaks.length) * width;
			const barHeight = Math.abs(peaks[i]) * halfHeight;
			
			// Draw bar from center
			ctx.fillRect(x, halfHeight - barHeight, Math.max(1, barWidth), barHeight * 2);
		}
	}


	function drawChunkBeatMarkers(ctx: CanvasRenderingContext2D, _chunkIndex: number, width: number, height: number) {
		// Draw N+1 evenly spaced vertical lines for N beats per chunk
		const numLines = beatGrouping + 1;
		
		for (let i = 0; i < numLines; i++) {
			const x = (i / beatGrouping) * width;
			
			// Different line styles based on position
			if (i === 0 || i === beatGrouping) {
				// Start and end lines
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
				ctx.lineWidth = 3;
			} else if (i % 4 === 0) {
				// Quarter note lines
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
				ctx.lineWidth = 1.5;
			} else {
				// Regular beat lines
				ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
				ctx.lineWidth = 1;
			}
			
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
		}
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

		// Determine which chunk to show playhead in
		let currentChunkIndex: number;
		let canvasIndex: number;
		
		if (beatOffset > 0) {
			if (currentTime < chunkDuration) {
				// Current time is in the pre-song chunk (-1) 
				// Chunk -1 covers currentTime 0 to chunkDuration
				currentChunkIndex = -1;
				canvasIndex = 0; // Chunk -1 is rendered as the first canvas
			} else {
				// Current time is in a regular chunk
				// Calculate which regular chunk based on time after the first chunk
				const timeAfterFirstChunk = currentTime - chunkDuration;
				currentChunkIndex = Math.floor(timeAfterFirstChunk / chunkDuration);
				canvasIndex = currentChunkIndex + 1; // Canvas array: [chunk-1, chunk0, chunk1, ...]
			}
		} else if (beatOffset < 0) {
			// Negative offset: check if we're in the special chunk -1
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			
			if (currentTime < offsetInSeconds) {
				// Current time is in the special negative chunk (-1)
				currentChunkIndex = -1;
				canvasIndex = 0; // Chunk -1 is rendered as the first canvas
			} else {
				// Current time is in a regular chunk, but shifted due to negative offset
				const adjustedTime = currentTime - offsetInSeconds;
				currentChunkIndex = Math.floor(adjustedTime / chunkDuration);
				canvasIndex = currentChunkIndex + 1; // Canvas array: [chunk-1, chunk0, chunk1, ...]
			}
		} else {
			// No offset, normal calculation
			currentChunkIndex = Math.floor(currentTime / chunkDuration);
			canvasIndex = currentChunkIndex;
		}

		// Find the canvas for the current chunk
		const chunkCanvases = chunksContainer.querySelectorAll('.chunk-canvas');
		const currentCanvas = chunkCanvases[canvasIndex] as HTMLCanvasElement;
		if (!currentCanvas) return;

		let x: number = 0;
		
		if (currentChunkIndex === -1) {
			if (beatOffset > 0) {
				// Special playhead positioning for positive offset pre-song chunk
				const offsetInSeconds = beatOffset / 1000;
				const totalChunkDuration = offsetInSeconds + chunkDuration;
				const songStartX = (offsetInSeconds / totalChunkDuration) * currentCanvas.offsetWidth;
				
				if (currentTime === 0) {
					// At song start - position at the green marker
					x = songStartX;
				} else if (currentTime < offsetInSeconds) {
					// This shouldn't happen with proper playback, but handle it
					x = (currentTime / totalChunkDuration) * currentCanvas.offsetWidth;
				} else {
					// After song start - position in the song portion
					const timeInSongPortion = currentTime;
					const songPortionWidth = currentCanvas.offsetWidth - songStartX;
					x = songStartX + (timeInSongPortion / chunkDuration) * songPortionWidth;
				}
			} else if (beatOffset < 0) {
				// Special playhead positioning for negative offset chunk
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const emptySpaceWidth = currentCanvas.offsetWidth - (offsetInSeconds / chunkDuration) * currentCanvas.offsetWidth;
				const songStartX = emptySpaceWidth;
				
				if (currentTime === 0) {
					// At song start - position at the green marker
					x = songStartX;
				} else {
					// Position in the small song portion on the right
					const timeInSongPortion = currentTime;
					const songPortionWidth = currentCanvas.offsetWidth - songStartX;
					x = songStartX + (timeInSongPortion / offsetInSeconds) * songPortionWidth;
				}
			}
		} else {
			// Normal playhead positioning for regular chunks
			if (beatOffset > 0) {
				// For regular chunks when positive offset exists
				const chunkStartTime = chunkDuration + currentChunkIndex * chunkDuration;
				const timeInChunk = currentTime - chunkStartTime;
				x = (timeInChunk / chunkDuration) * currentCanvas.offsetWidth;
			} else if (beatOffset < 0) {
				// For regular chunks when negative offset exists
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const chunkStartTime = offsetInSeconds + currentChunkIndex * chunkDuration;
				const timeInChunk = currentTime - chunkStartTime;
				x = (timeInChunk / chunkDuration) * currentCanvas.offsetWidth;
			} else {
				const chunkStartTime = currentChunkIndex * chunkDuration;
				const timeInChunk = currentTime - chunkStartTime;
				x = (timeInChunk / chunkDuration) * currentCanvas.offsetWidth;
			}
		}

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
			<div class="flex items-center space-x-4">
				<label class="text-sm text-gray-300 flex items-center space-x-2">
					<span>Beats per line:</span>
					<input 
						type="number" 
						value={beatGrouping}
						onchange={(e) => {
							const val = Number(e.currentTarget.value);
							beatGrouping = val;
							onBeatsPerLineChange?.(val);
						}}
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