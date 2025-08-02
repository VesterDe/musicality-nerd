<script lang="ts">
	import WaveSurfer from 'wavesurfer.js';
	import AnnotationPopup from './AnnotationPopup.svelte';
	import HtmlAnnotation from './HtmlAnnotation.svelte';
	import type { Annotation } from '../types';
	import {
		calculateChunkBounds,
		generateWaveformBars,
		generateBeatGrid,
		pixelToTime,
		type WaveformConfig,
		type ChunkBounds
	} from '../utils/svgWaveform';

	interface Props {
		beats: Beat[];
		currentBeatIndex: number;
		currentTime: number;
		bpm: number;
		audioBuffer: ArrayBuffer | null;
		beatOffset: number;
		beatsPerLine: number;
		onChunkLoop?: (chunkIndex: number, startTime: number, endTime: number) => void;
		onClearLoop?: () => void;
		loopingChunkIndices?: Set<number>;
		onSeek?: (time: number) => void;
		onBeatsPerLineChange?: (value: number) => void;
		annotations?: Annotation[];
		onAnnotationCreated?: (startTimeMs: number, endTimeMs: number, label?: string, color?: string, isPoint?: boolean) => void;
		onAnnotationUpdated?: (id: string, updates: Partial<Annotation>) => void;
		onAnnotationDeleted?: (id: string) => void;
	}

	let { 
		beats = [], 
 
		currentBeatIndex = -1, 
		currentTime = 0, 
		bpm = 120,
		audioBuffer = null,
		beatOffset = 0,
		beatsPerLine = 4,
		onChunkLoop,
		onClearLoop,
		loopingChunkIndices = new Set<number>(),
		onSeek,
		onBeatsPerLineChange,
		annotations = [],
		onAnnotationCreated,
		onAnnotationUpdated,
		onAnnotationDeleted,
	}: Props = $props();

	// Component state
	let waveformContainer: HTMLDivElement | undefined = $state();
	let chunksContainer: HTMLDivElement | undefined = $state();
	let wavesurfer: WaveSurfer | null = null;
	let beatGrouping = $state(beatsPerLine);
	let isInitialized = $state(false);
	let peaksData: Float32Array | null = $state(null);
	let audioSampleRate = $state(44100);
	let audioDuration = $state(0);

	// Annotation creation state
	let showAnnotationPopup = $state(false);
	let popupX = $state(0);
	let popupY = $state(0);
	let annotationStartTimeMs = $state(0);
	let annotationEndTimeMs = $state(0);
	let editingAnnotation: Annotation | null = $state(null);

	// Drag and interaction state
	let isDragging = $state(false);
	let dragStartTimeMs = $state(0);
	let dragEndTimeMs = $state(0);
	let dragStartChunk = $state(-1);
	let dragCurrentChunk = $state(-1);

	// Playhead state
	let playheadElement: HTMLElement | null = $state(null);

	// Derived values
	const chunkDuration = $derived(beatGrouping * (60 / bpm));
	const totalChunks = $derived.by(() => {
		if (audioDuration <= 0) return 0;
		const baseChunks = Math.ceil(audioDuration / chunkDuration);
		if (beatOffset > 0) return baseChunks + 1;
		if (beatOffset < 0) return baseChunks + 1;
		return baseChunks;
	});

	// Get responsive container width
	const containerWidth = $derived(chunksContainer?.offsetWidth || 800);
	
	const waveformConfig = $derived.by((): WaveformConfig => ({
		width: containerWidth,
		height: 120,
		sampleRate: audioSampleRate,
		audioDuration,
		beatOffset,
		chunkDuration
	}));

	// Initialize WaveSurfer when audio buffer changes
	$effect(() => {
		if (audioBuffer) {
			initializeWaveSurfer();
		}
	});

	// Update beat grouping when beatsPerLine changes
	$effect(() => {
		beatGrouping = beatsPerLine;
	});

	// Re-render when critical data changes
	$effect(() => {
		if (isInitialized && peaksData) {
			renderWaveforms();
		}
	});

	// Update playhead position when currentTime changes
	$effect(() => {
		if (isInitialized && currentTime >= 0) {
			updatePlayheadPosition();
		}
	});

	async function initializeWaveSurfer() {
		try {
			if (wavesurfer) {
				wavesurfer.destroy();
			}

			// Create hidden WaveSurfer instance for peak extraction
			const hiddenContainer = document.createElement('div');
			hiddenContainer.style.display = 'none';
			document.body.appendChild(hiddenContainer);

			wavesurfer = WaveSurfer.create({
				container: hiddenContainer,
				waveColor: 'transparent',
				progressColor: 'transparent',
				height: 0
			});

			wavesurfer.on('decode', () => {
				extractPeaksData();
			});

			const blob = new Blob([audioBuffer!], { type: 'audio/mp3' });
			const url = URL.createObjectURL(blob);
			await wavesurfer.load(url);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error('Failed to initialize WaveSurfer:', error);
		}
	}

	function extractPeaksData() {
		if (!wavesurfer) return;
		try {
			const audioBuffer = wavesurfer.getDecodedData();
			if (!audioBuffer) return;

			audioSampleRate = audioBuffer.sampleRate;
			audioDuration = audioBuffer.duration;
			peaksData = audioBuffer.getChannelData(0);
			
			isInitialized = true;
		} catch (error) {
			console.error('Failed to extract peaks data:', error);
		}
	}

	function renderWaveforms() {
		if (!chunksContainer || !peaksData) return;

		// Clear existing content
		chunksContainer.innerHTML = '';

		// Render chunks
		for (let chunkIndex = beatOffset !== 0 ? -1 : 0; chunkIndex < totalChunks; chunkIndex++) {
			if (chunkIndex === -1 && beatOffset === 0) continue;
			renderChunk(chunkIndex);
		}
	}

	function renderChunk(chunkIndex: number) {
		if (!chunksContainer || !peaksData) return;

		const chunkContainer = document.createElement('div');
		chunkContainer.className = 'relative mb-0 bg-gray-900 rounded-lg overflow-hidden';
		chunkContainer.dataset.chunkIndex = chunkIndex.toString();

		// Calculate chunk bounds
		const bounds = calculateChunkBounds(chunkIndex, waveformConfig);
		
		// Create SVG container
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', waveformConfig.width.toString());
		svg.setAttribute('height', waveformConfig.height.toString());
		svg.setAttribute('viewBox', `0 0 ${waveformConfig.width} ${waveformConfig.height}`);
		svg.setAttribute('class', 'block cursor-pointer');

		// Add pattern definition for diagonal hatching (used in chunk -1)
		if (chunkIndex === -1) {
			const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
			const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
			pattern.setAttribute('id', 'diagonalHatch');
			pattern.setAttribute('patternUnits', 'userSpaceOnUse');
			pattern.setAttribute('width', '10');
			pattern.setAttribute('height', '10');
			
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', 'M0,10 L10,0');
			path.setAttribute('stroke', 'rgba(75, 85, 99, 0.3)');
			path.setAttribute('stroke-width', '1');
			
			pattern.appendChild(path);
			defs.appendChild(pattern);
			svg.appendChild(defs);
		}

		// Special handling for chunk -1
		if (chunkIndex === -1 && beatOffset !== 0) {
			renderPreSongChunk(svg, bounds);
		} else {
			// Generate beat grid first (render behind waveform)
			const beatLines = generateBeatGrid(beatGrouping, waveformConfig.width, waveformConfig.height);
			beatLines.forEach(line => {
				const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'line');
				lineElement.setAttribute('x1', line.x.toString());
				lineElement.setAttribute('y1', '0');
				lineElement.setAttribute('x2', line.x.toString());
				lineElement.setAttribute('y2', waveformConfig.height.toString());
				
				// Different styles based on line type
				switch (line.type) {
					case 'start':
					case 'end':
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.9)');
						lineElement.setAttribute('stroke-width', '3');
						break;
					case 'quarter':
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.5)');
						lineElement.setAttribute('stroke-width', '1.5');
						break;
					default:
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
						lineElement.setAttribute('stroke-width', '1');
				}
				
				svg.appendChild(lineElement);
			});

			// Generate waveform bars (300 bars for narrower columns) - render on top
			const bars = generateWaveformBars(
				peaksData, 
				bounds, 
				waveformConfig.width, 
				waveformConfig.height, 
				300, 
				chunkIndex, 
				beatOffset, 
				chunkDuration
			);
			
			// Render waveform bars
			bars.forEach(bar => {
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', bar.x.toString());
				rect.setAttribute('y', bar.y.toString());
				rect.setAttribute('width', bar.width.toString());
				rect.setAttribute('height', bar.height.toString());
				rect.setAttribute('fill', '#3b82f6'); // Blue waveform
				rect.setAttribute('opacity', '0.8');
				svg.appendChild(rect);
			});
		}

		// Add click handler for seeking and annotation creation
		svg.addEventListener('click', (event) => handleWaveformClick(event, chunkIndex, bounds));
		svg.addEventListener('mousedown', (event) => handleWaveformMouseDown(event, chunkIndex, bounds));

		// Create header with chunk info
		const header = document.createElement('div');
		header.className = 'px-3 py-2 bg-gray-800 text-sm text-gray-300 flex items-center justify-between';
		
		const chunkInfo = document.createElement('div');
		const startTime = bounds.startTimeMs / 1000;
		const endTime = bounds.endTimeMs / 1000;
		
		if (chunkIndex === -1) {
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			chunkInfo.textContent = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;
		} else {
			chunkInfo.textContent = `Chunk ${chunkIndex} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`;
		}
		
		const loopButton = document.createElement('button');
		loopButton.className = `px-2 py-1 rounded text-xs transition-colors ${
			loopingChunkIndices.has(chunkIndex) 
				? 'bg-blue-600 text-white' 
				: 'bg-gray-700 hover:bg-gray-600 text-gray-300'
		}`;
		loopButton.textContent = loopingChunkIndices.has(chunkIndex) ? 'Stop Loop' : 'Loop';
		// Pass the chunk index and let the parent handle the time calculations
		loopButton.addEventListener('click', () => toggleChunkLoop(chunkIndex, startTime, endTime));

		header.appendChild(chunkInfo);
		header.appendChild(loopButton);

		// Assemble chunk
		chunkContainer.appendChild(header);
		chunkContainer.appendChild(svg);
		
		chunksContainer.appendChild(chunkContainer);
	}

	function renderPreSongChunk(svg: SVGSVGElement, bounds: ChunkBounds) {
		const offsetInSeconds = Math.abs(beatOffset) / 1000;
		const width = waveformConfig.width;
		const height = waveformConfig.height;
		
		if (beatOffset > 0) {
			// Positive offset: empty space at start, song data at end
			const songStartX = (offsetInSeconds / chunkDuration) * width;
			
			// Draw empty space with diagonal hatching
			const emptyRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			emptyRect.setAttribute('x', '0');
			emptyRect.setAttribute('y', '0');
			emptyRect.setAttribute('width', songStartX.toString());
			emptyRect.setAttribute('height', height.toString());
			emptyRect.setAttribute('fill', '#111827'); // Darker gray
			svg.appendChild(emptyRect);
			
			// Add diagonal hatching overlay
			const hatchRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			hatchRect.setAttribute('x', '0');
			hatchRect.setAttribute('y', '0');
			hatchRect.setAttribute('width', songStartX.toString());
			hatchRect.setAttribute('height', height.toString());
			hatchRect.setAttribute('fill', 'url(#diagonalHatch)');
			svg.appendChild(hatchRect);
			
			// Draw song start marker
			const startLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			startLine.setAttribute('x1', songStartX.toString());
			startLine.setAttribute('y1', '0');
			startLine.setAttribute('x2', songStartX.toString());
			startLine.setAttribute('y2', height.toString());
			startLine.setAttribute('stroke', '#10b981'); // Green color
			startLine.setAttribute('stroke-width', '4');
			svg.appendChild(startLine);
			
			// Add START label
			const startText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			startText.setAttribute('x', (songStartX + 5).toString());
			startText.setAttribute('y', '15');
			startText.setAttribute('fill', '#10b981');
			startText.setAttribute('font-size', '10');
			startText.setAttribute('font-family', 'sans-serif');
			startText.textContent = 'START';
			svg.appendChild(startText);
			
			// Draw beat grid
			const beatLines = generateBeatGrid(beatGrouping, width, height);
			beatLines.forEach(line => {
				const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'line');
				lineElement.setAttribute('x1', line.x.toString());
				lineElement.setAttribute('y1', '0');
				lineElement.setAttribute('x2', line.x.toString());
				lineElement.setAttribute('y2', height.toString());
				
				// Different styles based on line type
				switch (line.type) {
					case 'start':
					case 'end':
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.9)');
						lineElement.setAttribute('stroke-width', '3');
						break;
					case 'quarter':
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.5)');
						lineElement.setAttribute('stroke-width', '1.5');
						break;
					default:
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
						lineElement.setAttribute('stroke-width', '1');
				}
				
				svg.appendChild(lineElement);
			});
			
			// Draw waveform for song portion
			const bars = generateWaveformBars(
				peaksData!, 
				bounds, 
				width, 
				height, 
				300, 
				-1, 
				beatOffset, 
				chunkDuration
			);
			
			// Only render bars that are after the song start position
			bars.forEach(bar => {
				if (bar.x >= songStartX) {
					const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
					rect.setAttribute('x', bar.x.toString());
					rect.setAttribute('y', bar.y.toString());
					rect.setAttribute('width', bar.width.toString());
					rect.setAttribute('height', bar.height.toString());
					rect.setAttribute('fill', '#3b82f6'); // Blue waveform
					rect.setAttribute('opacity', '0.8');
					svg.appendChild(rect);
				}
			});
			
		} else if (beatOffset < 0) {
			// Negative offset: empty space at start (left), song data at end (right)
			const songStartX = ((chunkDuration - offsetInSeconds) / chunkDuration) * width;
			const emptySpaceWidth = songStartX;
			
			// Draw empty space with diagonal hatching on the LEFT
			const emptyRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			emptyRect.setAttribute('x', '0');
			emptyRect.setAttribute('y', '0');
			emptyRect.setAttribute('width', emptySpaceWidth.toString());
			emptyRect.setAttribute('height', height.toString());
			emptyRect.setAttribute('fill', '#111827'); // Darker gray
			svg.appendChild(emptyRect);
			
			// Add diagonal hatching overlay
			const hatchRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
			hatchRect.setAttribute('x', '0');
			hatchRect.setAttribute('y', '0');
			hatchRect.setAttribute('width', emptySpaceWidth.toString());
			hatchRect.setAttribute('height', height.toString());
			hatchRect.setAttribute('fill', 'url(#diagonalHatch)');
			svg.appendChild(hatchRect);
			
			// Draw song start marker where the song begins
			const startLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			startLine.setAttribute('x1', songStartX.toString());
			startLine.setAttribute('y1', '0');
			startLine.setAttribute('x2', songStartX.toString());
			startLine.setAttribute('y2', height.toString());
			startLine.setAttribute('stroke', '#10b981'); // Green color
			startLine.setAttribute('stroke-width', '4');
			svg.appendChild(startLine);
			
			// Add START label
			const startText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
			startText.setAttribute('x', (songStartX + 5).toString());
			startText.setAttribute('y', '15');
			startText.setAttribute('fill', '#10b981');
			startText.setAttribute('font-size', '10');
			startText.setAttribute('font-family', 'sans-serif');
			startText.textContent = 'START';
			svg.appendChild(startText);
			
			// Draw beat grid
			const beatLines = generateBeatGrid(beatGrouping, width, height);
			beatLines.forEach(line => {
				const lineElement = document.createElementNS('http://www.w3.org/2000/svg', 'line');
				lineElement.setAttribute('x1', line.x.toString());
				lineElement.setAttribute('y1', '0');
				lineElement.setAttribute('x2', line.x.toString());
				lineElement.setAttribute('y2', height.toString());
				
				// Different styles based on line type
				switch (line.type) {
					case 'start':
					case 'end':
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.9)');
						lineElement.setAttribute('stroke-width', '3');
						break;
					case 'quarter':
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.5)');
						lineElement.setAttribute('stroke-width', '1.5');
						break;
					default:
						lineElement.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
						lineElement.setAttribute('stroke-width', '1');
				}
				
				svg.appendChild(lineElement);
			});
			
			// Draw waveform for song portion
			const bars = generateWaveformBars(
				peaksData!, 
				bounds, 
				width, 
				height, 
				300, 
				-1, 
				beatOffset, 
				chunkDuration
			);
			
			// Render bars (they should already be positioned correctly after songStartX)
			bars.forEach(bar => {
				const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				rect.setAttribute('x', bar.x.toString());
				rect.setAttribute('y', bar.y.toString());
				rect.setAttribute('width', bar.width.toString());
				rect.setAttribute('height', bar.height.toString());
				rect.setAttribute('fill', '#3b82f6'); // Blue waveform
				rect.setAttribute('opacity', '0.8');
				svg.appendChild(rect);
			});
		}
	}

	function handleWaveformClick(event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) {
		const svg = event.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
		const x = event.clientX - rect.left;
		
		// Special handling for chunk -1
		if (chunkIndex === -1 && beatOffset !== 0) {
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			
			if (beatOffset > 0) {
				// Positive offset: check if click is in empty space or song portion
				const songStartX = (offsetInSeconds / chunkDuration) * waveformConfig.width;
				
				if (x < songStartX) {
					// Click in pre-song space - seek to beginning (time 0)
					if (onSeek) onSeek(0);
				} else {
					// Click in song portion - calculate time based on position within song area
					const relativeX = x - songStartX;
					const songPortionWidth = waveformConfig.width - songStartX;
					const normalizedPosition = relativeX / songPortionWidth;
					const clickTime = normalizedPosition * (chunkDuration - offsetInSeconds);
					if (onSeek) onSeek(clickTime);
				}
			} else if (beatOffset < 0) {
				// Negative offset: empty space on left, song on right
				const songStartX = ((chunkDuration - offsetInSeconds) / chunkDuration) * waveformConfig.width;
				
				if (x < songStartX) {
					// Click in empty space - seek to beginning (time 0)
					if (onSeek) onSeek(0);
				} else {
					// Click in song portion
					const relativeX = x - songStartX;
					const songPortionWidth = waveformConfig.width - songStartX;
					const normalizedPosition = relativeX / songPortionWidth;
					const clickTime = normalizedPosition * offsetInSeconds;
					if (onSeek) onSeek(clickTime);
				}
			}
		} else {
			// Normal chunk handling
			const clickTime = pixelToTime(x, bounds, waveformConfig.width);
			if (onSeek) onSeek(clickTime / 1000);
		}
	}

	function handleWaveformMouseDown(event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) {
		// Start drag for annotation creation
		const svg = event.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
		const x = event.clientX - rect.left;
		
		dragStartTimeMs = pixelToTime(x, bounds, waveformConfig.width);
		dragEndTimeMs = dragStartTimeMs;
		dragStartChunk = chunkIndex;
		dragCurrentChunk = chunkIndex;
		isDragging = true;

		// Add global mouse handlers
		document.addEventListener('mousemove', handleGlobalMouseMove);
		document.addEventListener('mouseup', handleGlobalMouseUp);
		
		event.preventDefault();
	}

	function handleGlobalMouseMove(event: MouseEvent) {
		if (!isDragging) return;

		// Find which chunk we're over
		const chunkElement = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-chunk-index]');
		if (chunkElement) {
			const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index') || '0');
			const svg = chunkElement.querySelector('svg');
			if (svg) {
				const rect = svg.getBoundingClientRect();
				const x = event.clientX - rect.left;
				const bounds = calculateChunkBounds(chunkIndex, waveformConfig);
				
				dragEndTimeMs = pixelToTime(x, bounds, waveformConfig.width);
				dragCurrentChunk = chunkIndex;
			}
		}
	}

	function handleGlobalMouseUp(event: MouseEvent) {
		if (!isDragging) return;

		isDragging = false;
		document.removeEventListener('mousemove', handleGlobalMouseMove);
		document.removeEventListener('mouseup', handleGlobalMouseUp);

		// Determine if this was a click or drag
		const timeDiff = Math.abs(dragEndTimeMs - dragStartTimeMs);
		const isPoint = timeDiff < 50; // Less than 50ms = point annotation

		// Show annotation creation popup
		showAnnotationPopup = true;
		popupX = event.clientX;
		popupY = event.clientY;
		annotationStartTimeMs = Math.min(dragStartTimeMs, dragEndTimeMs);
		annotationEndTimeMs = isPoint ? annotationStartTimeMs : Math.max(dragStartTimeMs, dragEndTimeMs);
		editingAnnotation = null;
	}

	function toggleChunkLoop(chunkIndex: number, startTime: number, endTime: number) {
		console.log('Toggle chunk loop:', { chunkIndex, startTime, endTime, chunkDuration });
		if (loopingChunkIndices.has(chunkIndex)) {
			onClearLoop?.();
		} else {
			onChunkLoop?.(chunkIndex, startTime, endTime);
		}
	}

	function updatePlayheadPosition() {
		if (!chunksContainer || !isInitialized || audioDuration <= 0) return;

		// Remove existing playhead
		const existingPlayhead = chunksContainer.querySelector('.playhead-bar');
		if (existingPlayhead) {
			existingPlayhead.remove();
		}

		// Determine which chunk to show playhead in
		let currentChunkIndex: number;
		let chunkContainerIndex: number;

		if (beatOffset > 0) {
			if (currentTime < chunkDuration) {
				currentChunkIndex = -1;
				chunkContainerIndex = 0;
			} else {
				const timeAfterFirstChunk = currentTime - chunkDuration;
				currentChunkIndex = Math.floor(timeAfterFirstChunk / chunkDuration);
				chunkContainerIndex = currentChunkIndex + 1;
			}
		} else if (beatOffset < 0) {
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			if (currentTime < offsetInSeconds) {
				currentChunkIndex = -1;
				chunkContainerIndex = 0;
			} else {
				const adjustedTime = currentTime - offsetInSeconds;
				currentChunkIndex = Math.floor(adjustedTime / chunkDuration);
				chunkContainerIndex = currentChunkIndex + 1;
			}
		} else {
			currentChunkIndex = Math.floor(currentTime / chunkDuration);
			chunkContainerIndex = currentChunkIndex;
		}

		// Get the chunk container
		const chunkContainer = chunksContainer.children[chunkContainerIndex] as HTMLElement;
		if (!chunkContainer) return;

		const svg = chunkContainer.querySelector('svg');
		if (!svg) return;

		// Calculate playhead X position
		let x = 0;
		
		if (currentChunkIndex === -1) {
			// Special chunk -1 handling
			if (beatOffset > 0) {
				const offsetInSeconds = beatOffset / 1000;
				const songStartX = (offsetInSeconds / chunkDuration) * containerWidth;
				
				if (currentTime === 0) {
					// At song start - position at the green START marker
					x = songStartX;
				} else if (currentTime <= chunkDuration) {
					// Calculate position, but offset by the song start position
					const timeProgress = currentTime / chunkDuration;
					// The playhead moves through the chunk, but the song starts at songStartX
					x = songStartX + (timeProgress * containerWidth - songStartX) * (currentTime / (chunkDuration - offsetInSeconds));
				}
			} else if (beatOffset < 0) {
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const songStartX = ((chunkDuration - offsetInSeconds) / chunkDuration) * containerWidth;
				
				if (currentTime === 0) {
					// At song start - position at the green START marker
					x = songStartX;
				} else if (currentTime <= offsetInSeconds) {
					// Position within the song portion that's in chunk -1
					const songPortionWidth = containerWidth - songStartX;
					x = songStartX + (currentTime / offsetInSeconds) * songPortionWidth;
				}
			}
		} else {
			// Normal playhead positioning for regular chunks
			if (beatOffset > 0) {
				const chunkStartTime = chunkDuration + currentChunkIndex * chunkDuration;
				const timeInChunk = currentTime - chunkStartTime;
				x = (timeInChunk / chunkDuration) * containerWidth;
			} else if (beatOffset < 0) {
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const chunkStartTime = offsetInSeconds + currentChunkIndex * chunkDuration;
				const timeInChunk = currentTime - chunkStartTime;
				x = (timeInChunk / chunkDuration) * containerWidth;
			} else {
				const chunkStartTime = currentChunkIndex * chunkDuration;
				const timeInChunk = currentTime - chunkStartTime;
				x = (timeInChunk / chunkDuration) * containerWidth;
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

		// Position relative to the chunk container
		const chunkRect = chunkContainer.getBoundingClientRect();
		const containerRect = chunksContainer.getBoundingClientRect();
		
		// Calculate actual header height dynamically
		const header = chunkContainer.querySelector('div') as HTMLElement;
		const headerHeight = header?.offsetHeight || 32;
		
		playhead.style.top = `${chunkRect.top - containerRect.top + headerHeight}px`;
		playhead.style.height = `${waveformConfig.height}px`;

		chunksContainer.appendChild(playhead);
		playheadElement = playhead;
	}

	function handleAnnotationSave(event: CustomEvent) {
		const { label, color, startTimeMs, endTimeMs, isPoint } = event.detail;
		
		if (editingAnnotation) {
			// Update existing annotation
			onAnnotationUpdated?.(editingAnnotation.id, { label, color, startTimeMs, endTimeMs });
		} else {
			// Create new annotation
			onAnnotationCreated?.(startTimeMs, endTimeMs, label, color, isPoint);
		}
		
		showAnnotationPopup = false;
		editingAnnotation = null;
	}

	function handleAnnotationCancel() {
		showAnnotationPopup = false;
		editingAnnotation = null;
	}

	function handleBeatsPerLineChange(event: Event) {
		const target = event.target as HTMLInputElement;
		const newValue = parseInt(target.value);
		onBeatsPerLineChange?.(newValue);
	}

	function handleEditAnnotation(annotation: Annotation) {
		editingAnnotation = annotation;
		annotationStartTimeMs = annotation.startTimeMs;
		annotationEndTimeMs = annotation.endTimeMs;
		showAnnotationPopup = true;
		popupX = 400; // Center-ish position
		popupY = 300;
	}

	function handleDeleteAnnotation(annotationId: string) {
		console.log('Delete annotation called:', annotationId);
		onAnnotationDeleted?.(annotationId);
	}

	function handleMoveAnnotation(annotationId: string, newStartTimeMs: number, newEndTimeMs: number) {
		onAnnotationUpdated?.(annotationId, { 
			startTimeMs: newStartTimeMs, 
			endTimeMs: newEndTimeMs 
		});
	}
</script>

<div class="flex flex-col space-y-4">
	<!-- Controls -->
	<div class="bg-gray-800 rounded-lg p-4">
		<div class="flex items-center justify-between">
			<div class="flex items-center space-x-4">
				<label class="flex items-center space-x-2">
					<span class="text-sm text-gray-300">Beats per line:</span>
					<input
						type="number"
						value={beatGrouping}
						min="1"
						max="16"
						class="w-16 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
						on:change={handleBeatsPerLineChange}
					/>
				</label>
				<div class="text-sm text-gray-400">
					Current: {Math.floor(currentTime / chunkDuration) + 1} / {totalChunks}
				</div>
			</div>
		</div>
		
		<div class="mt-2 flex items-center space-x-4 text-xs text-gray-500">
			<div class="flex items-center space-x-4">
				<div class="text-sm text-gray-400">
					<span>Duration: {audioDuration.toFixed(1)}s</span>
					<span class="mx-2">•</span>
					<span>Chunk Duration: {chunkDuration.toFixed(2)}s</span>
					<span class="mx-2">•</span>
					<span>Total Chunks: {totalChunks}</span>
					<span class="mx-2">•</span>
					<span>BPM: {bpm}</span>
					<span class="mx-2">•</span>
					<span>Offset: {beatOffset}ms</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Waveform Container -->
	<div bind:this={waveformContainer} class="relative">
		<div bind:this={chunksContainer} class="space-y-2">
			<!-- Chunks will be rendered here -->
		</div>
		
		<!-- Annotation Layer -->
		<div class="absolute inset-0 pointer-events-none">
			{#each annotations as annotation (annotation.id)}
				{#each Array.from({ length: totalChunks }) as _, chunkIndex}
					{@const actualChunkIndex = beatOffset !== 0 ? chunkIndex - 1 : chunkIndex}
					{@const bounds = calculateChunkBounds(actualChunkIndex, waveformConfig)}
					{@const chunkElement = chunksContainer?.children[chunkIndex]}
					{#if chunkElement}
						{@const rect = chunkElement.getBoundingClientRect()}
						{@const containerRect = chunksContainer?.getBoundingClientRect()}
						{@const relativeTop = containerRect ? rect.top - containerRect.top : 0}
						<div 
							class="absolute pointer-events-auto"
							style:top="{relativeTop + 32}px"
							style:left="0px"
							style:width="{waveformConfig.width}px"
							style:height="{waveformConfig.height}px"
						>
							<HtmlAnnotation
								{annotation}
								chunkBounds={bounds}
								chunkWidth={waveformConfig.width}
								chunkHeight={waveformConfig.height}
								chunkIndex={actualChunkIndex}
								onEdit={handleEditAnnotation}
								onDelete={handleDeleteAnnotation}
								onMove={handleMoveAnnotation}
							/>
						</div>
					{/if}
				{/each}
			{/each}
		</div>
	</div>
</div>

<!-- Annotation Popup -->
<AnnotationPopup
	visible={showAnnotationPopup}
	x={popupX}
	y={popupY}
	startTimeMs={annotationStartTimeMs}
	endTimeMs={annotationEndTimeMs}
	editingAnnotation={editingAnnotation}
	on:save={handleAnnotationSave}
	on:cancel={handleAnnotationCancel}
/>

<style>
	/* Custom styles for the SVG waveform */
	:global(svg) {
		user-select: none;
	}
</style>