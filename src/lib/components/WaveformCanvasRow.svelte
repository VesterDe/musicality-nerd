<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import HtmlAnnotation from './HtmlAnnotation.svelte';
	import type { Annotation } from '../types';
	import type { ChunkBounds, WaveformConfig } from '../utils/svgWaveform';
	import {
		drawDiagonalHatch,
		drawBeatGrid,
		drawWaveformBars,
		drawActiveBarFlash,
		drawSongStartMarker,
		drawAnnotationPlaceholder,
		setupHighDPICanvas
	} from '../utils/canvasWaveform';
	import { timeToPixel } from '../utils/svgWaveform';

	interface Props {
		chunkIndex: number;
		bounds: ChunkBounds;
		isSpecialChunk: boolean;
		waveformBars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean; annotationColors?: Array<{ color: string; startY: number; endY: number }> }>;
		waveformBarsPerStem?: Array<Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }>>;
		stemColors?: string[];
		stemEnabled?: boolean[];
		beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>;
		headerInfo: string;
		startTime: number;
		endTime: number;
		annotations: Array<Annotation & { stackPosition: number }>;
		placeholderAnnotation: (Annotation & { stackPosition: number }) | null;
		isLooping: boolean;
		isActiveChunk: boolean;
		activeBeatLineIndices?: Set<number>;
		activeBarIndex: number;
		waveformConfig: WaveformConfig;
		chunkDuration: number;
		beatOffset: number;
		exportingChunk: boolean;
		onWaveformMouseDown: (event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) => void;
		onWaveformTouchStart: (event: TouchEvent, chunkIndex: number, bounds: ChunkBounds) => void;
		onChunkExport: (chunkIndex: number, startTime: number, endTime: number) => void;
		onToggleChunkLoop: (chunkIndex: number, startTime: number, endTime: number) => void;
		onEditAnnotation: (annotation: Annotation) => void;
		onDeleteAnnotation: (annotationId: string) => void;
		onMoveAnnotation: (annotationId: string, newStartTimeMs: number, newEndTimeMs: number) => void;
		onDuplicateAnnotation: (annotation: Annotation) => void;
		onGroupExport?: () => void;
		showGroupExportButton?: boolean;
		loopingChunkCount?: number;
		registerPlayheadLayer?: (canvas: HTMLCanvasElement | null) => void;
		unregisterPlayheadLayer?: () => void;
		isAnnotationMode?: boolean;
	}

	let {
		chunkIndex,
		bounds,
		isSpecialChunk,
		waveformBars,
		waveformBarsPerStem,
		stemColors,
		stemEnabled,
		beatLines,
		headerInfo,
		startTime,
		endTime,
		annotations,
		placeholderAnnotation,
		isLooping,
		isActiveChunk,
		activeBeatLineIndices,
		activeBarIndex,
		waveformConfig,
		chunkDuration,
		beatOffset,
		exportingChunk,
		onWaveformMouseDown,
		onWaveformTouchStart,
		onChunkExport,
		onToggleChunkLoop,
		onEditAnnotation,
		onDeleteAnnotation,
		onMoveAnnotation,
		onDuplicateAnnotation,
		onGroupExport,
		showGroupExportButton = false,
		loopingChunkCount = 0,
		registerPlayheadLayer,
		unregisterPlayheadLayer,
		isAnnotationMode = false
	}: Props = $props();

	// Canvas reference
	let canvasElement: HTMLCanvasElement | undefined = $state();
	let ctx: CanvasRenderingContext2D | null = $state(null);
	
	// Playhead overlay canvas (for smooth rAF updates)
	let playheadCanvas: HTMLCanvasElement | undefined = $state();

	// Initialize canvas context
	onMount(() => {
		if (canvasElement) {
			setupHighDPICanvas(canvasElement, waveformConfig.width, waveformConfig.height);
			ctx = canvasElement.getContext('2d');
			redraw();
		}
		
		if (playheadCanvas) {
			setupHighDPICanvas(playheadCanvas, waveformConfig.width, waveformConfig.height);
		}
		
		// Register playhead layer
		if (registerPlayheadLayer) {
			untrack(() => {
				registerPlayheadLayer(playheadCanvas || null);
			});
		}
	});

	// Resize canvas when waveformConfig dimensions change (e.g., on window resize)
	$effect(() => {
		const width = waveformConfig.width;
		const height = waveformConfig.height;
		
		if (canvasElement) {
			setupHighDPICanvas(canvasElement, width, height);
			// Re-get context after resize (context is scaled by setupHighDPICanvas)
			ctx = canvasElement.getContext('2d');
		}
		
		if (playheadCanvas) {
			setupHighDPICanvas(playheadCanvas, width, height);
		}
	});

	onDestroy(() => {
		if (unregisterPlayheadLayer) {
			untrack(() => {
				unregisterPlayheadLayer();
			});
		}
	});

	// Redraw function
	function redraw() {
		if (!ctx || !canvasElement) return;
		
		const width = waveformConfig.width;
		const height = waveformConfig.height;
		
		// Clear canvas
		ctx.clearRect(0, 0, width, height);
		
		// Draw background
		ctx.fillStyle = '#111827'; // gray-900
		ctx.fillRect(0, 0, width, height);
		
		if (isSpecialChunk) {
			// Draw diagonal hatching for empty area
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			const emptyAreaWidth = beatOffset > 0
				? (offsetInSeconds / chunkDuration) * width
				: ((chunkDuration - offsetInSeconds) / chunkDuration) * width;
			
			if (emptyAreaWidth > 0) {
				drawDiagonalHatch(ctx, 0, 0, emptyAreaWidth, height);
			}
			
			// Draw waveform bars
			if (waveformBarsPerStem && waveformBarsPerStem.length > 0 && stemColors && stemEnabled) {
				drawWaveformBars(ctx, waveformBars, waveformBarsPerStem, stemColors, stemEnabled);
			} else {
				drawWaveformBars(ctx, waveformBars);
			}
			
			// Draw song start marker
			const songStartX = beatOffset > 0
				? (offsetInSeconds / chunkDuration) * width
				: ((chunkDuration - offsetInSeconds) / chunkDuration) * width;
			drawSongStartMarker(ctx, songStartX, height);
		} else {
			// Draw beat grid
			drawBeatGrid(ctx, beatLines, height, activeBeatLineIndices);
			
			// Draw waveform bars
			if (waveformBarsPerStem && waveformBarsPerStem.length > 0 && stemColors && stemEnabled) {
				drawWaveformBars(ctx, waveformBars, waveformBarsPerStem, stemColors, stemEnabled);
			} else {
				drawWaveformBars(ctx, waveformBars);
			}
			
			// Draw active bar flash overlay
			if (isActiveChunk && activeBarIndex >= 0 && activeBarIndex < waveformBars.length) {
				const activeBar = waveformBars[activeBarIndex];
				if (activeBar && activeBar.annotationColors && activeBar.annotationColors.length > 0) {
					drawActiveBarFlash(ctx, activeBar);
				}
			}
		}
		
		// Draw placeholder annotation preview if visible in this chunk
		if (placeholderAnnotation) {
			const startX = timeToPixel(placeholderAnnotation.startTimeMs, bounds, width);
			const endX = timeToPixel(placeholderAnnotation.endTimeMs, bounds, width);
			drawAnnotationPlaceholder(
				ctx,
				startX,
				endX,
				height,
				placeholderAnnotation.color,
				placeholderAnnotation.isPoint || placeholderAnnotation.startTimeMs === placeholderAnnotation.endTimeMs
			);
		}
	}

	// Redraw when relevant props change
	$effect(() => {
		// Track all dependencies that affect rendering
		waveformBars;
		waveformBarsPerStem;
		stemColors;
		stemEnabled;
		beatLines;
		isSpecialChunk;
		beatOffset;
		chunkDuration;
		activeBeatLineIndices;
		isActiveChunk;
		activeBarIndex;
		waveformConfig.width;
		waveformConfig.height;
		placeholderAnnotation; // Track placeholder changes for preview
		bounds; // Track bounds changes
		
		redraw();
	});

	// Handle canvas mouse events
	function handleCanvasMouseDown(event: MouseEvent) {
		if (!canvasElement) return;
		
		// Calculate coordinate relative to canvas (accounting for DPR scaling)
		const rect = canvasElement.getBoundingClientRect();
		const x = event.clientX - rect.left;
		
		// Create a synthetic event that the handler expects
		// The handler calls event.currentTarget.getBoundingClientRect(), so we need to provide that
		const syntheticEvent = {
			...event,
			currentTarget: canvasElement,
			clientX: event.clientX,
			clientY: event.clientY,
			preventDefault: () => event.preventDefault(),
			stopPropagation: () => event.stopPropagation()
		} as MouseEvent;
		
		onWaveformMouseDown(syntheticEvent, chunkIndex, bounds);
		event.preventDefault();
	}

	function handleCanvasTouchStart(event: TouchEvent) {
		if (!canvasElement || event.touches.length === 0) return;
		
		// Create a synthetic event
		const syntheticEvent = {
			...event,
			currentTarget: canvasElement,
			touches: event.touches,
			preventDefault: () => event.preventDefault(),
			stopPropagation: () => event.stopPropagation()
		} as TouchEvent;
		
		onWaveformTouchStart(syntheticEvent, chunkIndex, bounds);
		event.preventDefault();
	}
</script>

<div class="relative mb-0 bg-gray-900 overflow-hidden {isActiveChunk ? 'current-chunk' : ''}" data-chunk-index={chunkIndex}>
	<!-- Chunk Header -->
	<div class="px-3 py-2 bg-gray-800 text-sm text-gray-300 flex items-center justify-between" style="touch-action: pan-y;">
		<div>{headerInfo}</div>
		<div class="flex items-center space-x-2">
			<!-- Show group download button only on the first looping chunk -->
			{#if showGroupExportButton && loopingChunkCount > 1}
				<button
					class="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs transition-colors"
					onclick={onGroupExport}
				>
					📦 ({loopingChunkCount})
				</button>
			{/if}
			<button
				class="px-2 py-1 rounded text-xs transition-colors {exportingChunk ? 'bg-gray-600 text-gray-400' : 'bg-green-600 hover:bg-green-700 text-white'}"
				onclick={() => onChunkExport(chunkIndex, startTime, endTime)}
				disabled={exportingChunk}
			>
				{exportingChunk ? '⏳' : '📥'}
			</button>
			<button
				class="px-2 py-1 rounded text-xs transition-colors {isLooping ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}"
				onclick={() => onToggleChunkLoop(chunkIndex, startTime, endTime)}
			>
				{isLooping ? '⏹️' : '🔁'}
			</button>
		</div>
	</div>

	<!-- Canvas Waveform Container -->
	<div class="relative" style="width: {waveformConfig.width}px; height: {waveformConfig.height}px;">
		<!-- Main waveform canvas -->
		<canvas
			bind:this={canvasElement}
			class="block cursor-crosshair"
			style:touch-action={isAnnotationMode ? "none" : "pan-y"}
			onmousedown={handleCanvasMouseDown}
			ontouchstart={handleCanvasTouchStart}
		></canvas>
		
		<!-- Playhead overlay canvas (drawn by PlayheadAnimator via rAF) -->
		<canvas
			bind:this={playheadCanvas}
			class="absolute top-0 left-0 pointer-events-none"
			style="width: {waveformConfig.width}px; height: {waveformConfig.height}px;"
		></canvas>
	</div>

	<!-- Annotations for this chunk -->
	<div class="absolute pointer-events-none" style:top="40px" style:left="0px" style:width="{waveformConfig.width}px" style:height="{waveformConfig.height}px">
		{#each annotations as annotation (annotation.id)}
			<div class="pointer-events-auto">
				<HtmlAnnotation
					{annotation}
					chunkBounds={bounds}
					chunkWidth={waveformConfig.width}
					chunkHeight={waveformConfig.height}
					{chunkIndex}
					stackPosition={annotation.stackPosition || 0}
					onEdit={onEditAnnotation}
					onDelete={onDeleteAnnotation}
					onMove={onMoveAnnotation}
					onDuplicate={onDuplicateAnnotation}
				/>
			</div>
		{/each}

		<!-- Placeholder annotation if visible in this chunk -->
		{#if placeholderAnnotation}
			<div class="pointer-events-none opacity-60">
				<HtmlAnnotation
					annotation={placeholderAnnotation}
					chunkBounds={bounds}
					chunkWidth={waveformConfig.width}
					chunkHeight={waveformConfig.height}
					{chunkIndex}
					stackPosition={placeholderAnnotation.stackPosition || 0}
					isPlaceholder={true}
				/>
			</div>
		{/if}
	</div>

</div>

