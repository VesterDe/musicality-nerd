<script lang="ts">
	import AnnotationPopup from './AnnotationPopup.svelte';
	import HtmlAnnotation from './HtmlAnnotation.svelte';
	import type { Annotation, Beat } from '../types';
	import type { AudioEngine } from '../audio/AudioEngine';
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
		audioEngine: AudioEngine;
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
		onAnnotationModalStateChange?: (isOpen: boolean) => void;
	}

	let { 
		beats = [], 
 
		currentBeatIndex = -1, 
		currentTime = 0, 
		bpm = 120,
		audioEngine,
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
		onAnnotationModalStateChange,
	}: Props = $props();

	// Component state
	let waveformContainer: HTMLDivElement | undefined = $state();
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

	// Placeholder annotation state
	let showPlaceholder = $state(false);
	let placeholderStartTimeMs = $state(0);
	let placeholderEndTimeMs = $state(0);


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
	const containerWidth = $derived(waveformContainer?.offsetWidth || 800);
	
	const waveformConfig = $derived.by((): WaveformConfig => ({
		width: containerWidth,
		height: 120,
		sampleRate: audioSampleRate,
		audioDuration,
		beatOffset,
		chunkDuration
	}));

	// Pre-calculate all chunk data declaratively
	const chunkData = $derived.by(() => {
		if (!isInitialized || !peaksData || totalChunks === 0) return [];
		
		const chunks = [];
		for (let chunkIndex = beatOffset !== 0 ? -1 : 0; chunkIndex < totalChunks; chunkIndex++) {
			if (chunkIndex === -1 && beatOffset === 0) continue;
			
			const bounds = calculateChunkBounds(chunkIndex, waveformConfig);
			const isSpecialChunk = chunkIndex === -1 && beatOffset !== 0;
			
			// Calculate chunk annotations
			const chunkAnnotations = annotations.filter(annotation => 
				annotation.startTimeMs < bounds.endTimeMs && annotation.endTimeMs > bounds.startTimeMs
			);
			
			// Calculate placeholder visibility for this chunk
			const placeholderVisible = showPlaceholder && 
				placeholderStartTimeMs < bounds.endTimeMs && placeholderEndTimeMs > bounds.startTimeMs;
			
			let placeholderAnnotation = null;
			if (placeholderVisible) {
				placeholderAnnotation = {
					id: 'placeholder',
					startTimeMs: placeholderStartTimeMs,
					endTimeMs: placeholderEndTimeMs,
					label: placeholderStartTimeMs === placeholderEndTimeMs ? 'Point annotation' : 'New annotation',
					color: '#ff5500',
					isPoint: placeholderStartTimeMs === placeholderEndTimeMs
				};
			}

			// Generate waveform data
			let waveformBars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> = [];
			let beatLines: Array<{ x: number; type: 'start' | 'end' | 'quarter' | 'beat' }> = [];
			let headerInfo = '';
			
			if (isSpecialChunk) {
				// Special chunk -1 handling
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;
				
				// Generate waveform bars for special chunk (includes empty and song bars)
				waveformBars = generateWaveformBars(
					peaksData, 
					bounds, 
					waveformConfig.width, 
					waveformConfig.height, 
					300, 
					chunkIndex, 
					beatOffset, 
					chunkDuration
				);
			} else {
				// Generate beat grid
				beatLines = generateBeatGrid(beatGrouping, waveformConfig.width, waveformConfig.height);
				
				// Generate waveform bars
				waveformBars = generateWaveformBars(
					peaksData, 
					bounds, 
					waveformConfig.width, 
					waveformConfig.height, 
					300, 
					chunkIndex, 
					beatOffset, 
					chunkDuration
				);
				
				const startTime = bounds.startTimeMs / 1000;
				const endTime = bounds.endTimeMs / 1000;
				headerInfo = `Chunk ${chunkIndex} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`;
			}

			chunks.push({
				index: chunkIndex,
				bounds,
				isSpecialChunk,
				annotations: chunkAnnotations,
				placeholderAnnotation,
				waveformBars,
				beatLines,
				headerInfo,
				startTime: bounds.startTimeMs / 1000,
				endTime: bounds.endTimeMs / 1000,
				isLooping: loopingChunkIndices.has(chunkIndex)
			});
		}
		
		return chunks;
	});

	// Initialize audio data when AudioEngine changes
	$effect(() => {
		if (audioEngine) {
			initializeFromAudioEngine();
		}
	});

	// Update beat grouping when beatsPerLine changes
	$effect(() => {
		beatGrouping = beatsPerLine;
	});



	// Calculate playhead position declaratively
	const playheadInfo = $derived.by(() => {
		if (!isInitialized || audioDuration <= 0) return null;

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

		// Calculate playhead X position
		let x = 0;
		
		if (currentChunkIndex === -1) {
			// Special chunk -1 handling
			if (beatOffset > 0) {
				const offsetInSeconds = beatOffset / 1000;
				const songStartX = (offsetInSeconds / chunkDuration) * containerWidth;
				
				if (currentTime === 0) {
					x = songStartX;
				} else if (currentTime <= chunkDuration) {
					const timeProgress = currentTime / chunkDuration;
					x = songStartX + (timeProgress * containerWidth - songStartX) * (currentTime / (chunkDuration - offsetInSeconds));
				}
			} else if (beatOffset < 0) {
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const songStartX = ((chunkDuration - offsetInSeconds) / chunkDuration) * containerWidth;
				
				if (currentTime === 0) {
					x = songStartX;
				} else if (currentTime <= offsetInSeconds) {
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

		return {
			chunkIndex: currentChunkIndex,
			chunkContainerIndex,
			x
		};
	});


	// Notify parent when annotation modal state changes
	$effect(() => {
		if (onAnnotationModalStateChange) {
			onAnnotationModalStateChange(showAnnotationPopup);
		}
	});

	function initializeFromAudioEngine() {
		try {
			const audioBuffer = audioEngine.getAudioBuffer();
			if (!audioBuffer) {
				console.error('No audio buffer available from AudioEngine');
				return;
			}

			// Extract peaks data directly from AudioBuffer
			audioSampleRate = audioBuffer.sampleRate;
			audioDuration = audioBuffer.duration;
			peaksData = audioBuffer.getChannelData(0);
			
			isInitialized = true;
		} catch (error) {
			console.error('Failed to initialize from AudioEngine:', error);
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

		// Show initial placeholder for point annotation
		showPlaceholder = true;
		placeholderStartTimeMs = dragStartTimeMs;
		placeholderEndTimeMs = dragStartTimeMs;

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

				// Update placeholder annotation
				showPlaceholder = true;
				placeholderStartTimeMs = Math.min(dragStartTimeMs, dragEndTimeMs);
				placeholderEndTimeMs = Math.max(dragStartTimeMs, dragEndTimeMs);
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

		// Hide placeholder immediately - dragging is complete
		showPlaceholder = false;

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
		showPlaceholder = false;
		editingAnnotation = null;
	}

	function handleAnnotationCancel() {
		showAnnotationPopup = false;
		showPlaceholder = false;
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
						onchange={handleBeatsPerLineChange}
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
		<div class="space-y-2">
			{#each chunkData as chunk (chunk.index)}
				<div class="relative mb-0 bg-gray-900 rounded-lg overflow-hidden" data-chunk-index={chunk.index}>
					<!-- Chunk Header -->
					<div class="px-3 py-2 bg-gray-800 text-sm text-gray-300 flex items-center justify-between">
						<div>{chunk.headerInfo}</div>
						<button
							class="px-2 py-1 rounded text-xs transition-colors {chunk.isLooping ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}"
							onclick={() => toggleChunkLoop(chunk.index, chunk.startTime, chunk.endTime)}
						>
							{chunk.isLooping ? 'Stop Loop' : 'Loop'}
						</button>
					</div>

					<!-- SVG Waveform -->
					<svg
						width={waveformConfig.width}
						height={waveformConfig.height}
						viewBox="0 0 {waveformConfig.width} {waveformConfig.height}"
						class="block cursor-pointer"
						onclick={(event) => handleWaveformClick(event, chunk.index, chunk.bounds)}
						onmousedown={(event) => handleWaveformMouseDown(event, chunk.index, chunk.bounds)}
					>
						{#if chunk.isSpecialChunk}
							<!-- Special chunk -1 with diagonal hatching pattern -->
							<defs>
								<pattern id="diagonalHatch-{chunk.index}" patternUnits="userSpaceOnUse" width="12" height="12">
									<rect width="12" height="12" fill="transparent"/>
									<path d="M0,12 L12,0" stroke="rgba(156, 163, 175, 0.4)" stroke-width="1"/>
									<path d="M-3,3 L3,-3" stroke="rgba(156, 163, 175, 0.4)" stroke-width="1"/>
									<path d="M9,15 L15,9" stroke="rgba(156, 163, 175, 0.4)" stroke-width="1"/>
								</pattern>
							</defs>
							
							<!-- Empty space area with diagonal pattern -->
							{@const offsetInSeconds = Math.abs(beatOffset) / 1000}
							{@const emptyAreaWidth = beatOffset > 0 
								? (offsetInSeconds / chunkDuration) * waveformConfig.width
								: ((chunkDuration - offsetInSeconds) / chunkDuration) * waveformConfig.width}
							{#if emptyAreaWidth > 0}
								<rect
									x="0"
									y="0"
									width={emptyAreaWidth}
									height={waveformConfig.height}
									fill="url(#diagonalHatch-{chunk.index})"
									pointer-events="none"
								/>
							{/if}
							
							<!-- Render song waveform bars only -->
							{#each chunk.waveformBars as bar}
								{#if !bar.isEmpty}
									<rect
										x={bar.x}
										y={bar.y}
										width={bar.width}
										height={bar.height}
										fill="#3b82f6"
										opacity="0.8"
									/>
								{/if}
							{/each}
							
							<!-- Song start marker line -->
							{@const songStartX = beatOffset > 0 
								? (offsetInSeconds / chunkDuration) * waveformConfig.width
								: ((chunkDuration - offsetInSeconds) / chunkDuration) * waveformConfig.width}
							<line
								x1={songStartX}
								y1="0"
								x2={songStartX}
								y2={waveformConfig.height}
								stroke="#fbbf24"
								stroke-width="2"
								opacity="0.8"
							/>
							<text
								x={songStartX + 2}
								y="15"
								fill="#fbbf24"
								font-size="10"
								font-family="monospace"
								opacity="0.8"
							>Song Start</text>
						{:else}
							<!-- Beat Grid Lines -->
							{#each chunk.beatLines as line}
								<line
									x1={line.x}
									y1="0"
									x2={line.x}
									y2={waveformConfig.height}
									stroke={line.type === 'start' || line.type === 'end' ? 'rgba(255, 255, 255, 0.9)' : 
										   line.type === 'quarter' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.3)'}
									stroke-width={line.type === 'start' || line.type === 'end' ? '3' : 
												 line.type === 'quarter' ? '1.5' : '1'}
								/>
							{/each}

							<!-- Waveform Bars -->
							{#each chunk.waveformBars as bar}
								<rect
									x={bar.x}
									y={bar.y}
									width={bar.width}
									height={bar.height}
									fill="#3b82f6"
									opacity="0.8"
								/>
							{/each}
						{/if}
					</svg>

					<!-- Annotations for this chunk -->
					<div class="absolute pointer-events-none" style:top="40px" style:left="0px" style:width="{waveformConfig.width}px" style:height="{waveformConfig.height}px">
						{#each chunk.annotations as annotation (annotation.id)}
							<div class="pointer-events-auto">
								<HtmlAnnotation
									{annotation}
									chunkBounds={chunk.bounds}
									chunkWidth={waveformConfig.width}
									chunkHeight={waveformConfig.height}
									chunkIndex={chunk.index}
									onEdit={handleEditAnnotation}
									onDelete={handleDeleteAnnotation}
									onMove={handleMoveAnnotation}
								/>
							</div>
						{/each}

						<!-- Placeholder annotation if visible in this chunk -->
						{#if chunk.placeholderAnnotation}
							<div class="pointer-events-none opacity-60">
								<HtmlAnnotation
									annotation={chunk.placeholderAnnotation}
									chunkBounds={chunk.bounds}
									chunkWidth={waveformConfig.width}
									chunkHeight={waveformConfig.height}
									chunkIndex={chunk.index}
									isPlaceholder={true}
								/>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<!-- Playhead (positioned over the appropriate chunk) -->
		{#if playheadInfo && chunkData.length > 0}
			{@const targetChunk = chunkData.find(c => c.index === playheadInfo.chunkIndex)}
			{@const chunkContainerIndex = playheadInfo.chunkContainerIndex}
			{#if targetChunk && chunkContainerIndex < chunkData.length}
				<div
					class="absolute pointer-events-none transition-all duration-100 ease-out"
					style:left="{playheadInfo.x}px"
					style:top="{chunkContainerIndex * (waveformConfig.height + 32 + 8) + 40}px"
					style:width="3px"
					style:height="{waveformConfig.height}px"
					style:background-color="#fbbf24"
					style:box-shadow="0 0 4px rgba(251, 191, 36, 0.8)"
					style:z-index="20"
				></div>
			{/if}
		{/if}
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