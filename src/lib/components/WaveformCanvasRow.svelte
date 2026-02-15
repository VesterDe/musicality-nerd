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
		drawBeatNumbers,
		setupHighDPICanvas
	} from '../utils/canvasWaveform';
	import { timeToPixel } from '../utils/svgWaveform';
	import { Download, Crosshair, Repeat, Square, LoaderCircle } from 'lucide-svelte';

	interface Props {
		chunkIndex: number;
		bounds: ChunkBounds;
		isSpecialChunk: boolean;
		waveformBars: Array<{
			x: number;
			y: number;
			width: number;
			height: number;
			isEmpty?: boolean;
			annotationColors?: Array<{ color: string; startY: number; endY: number }>;
		}>;
		waveformBarsPerStem?: Array<
			Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }>
		>;
		stemColors?: string[];
		stemEnabled?: boolean[];
		beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>;
		headerInfo: string;
		startTime: number;
		endTime: number;
		annotations: Array<Annotation & { stackPosition: number }>;
		placeholderAnnotation: (Annotation & { stackPosition: number }) | null;
		isLooping: boolean;
		hasActiveLoops?: boolean;
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
		registerPlayheadLayer?: (canvas: HTMLCanvasElement | null) => void;
		unregisterPlayheadLayer?: () => void;
		isAnnotationMode?: boolean;
		showBeatNumbers?: boolean;
		beatsPerLine?: number;
		onOpenTempoTrainer?: (chunkIndex: number, startTime: number, endTime: number) => void;
		// Cross-row annotation drag props
		onAnnotationDragStart?: (
			annotationId: string,
			annotation: Annotation,
			chunkIndex: number,
			clientX: number,
			clientY: number,
			isCopy?: boolean
		) => void;
		isDraggingAnnotation?: boolean;
		draggingAnnotationId?: string | null;
		isDragCopyOperation?: boolean;
		dragAnnotationPreviewStartTimeMs?: number | null;
		dragAnnotationPreviewEndTimeMs?: number | null;
		isDragTarget?: boolean;
		dragAnnotationColor?: string;
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
		hasActiveLoops = false,
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
		registerPlayheadLayer,
		unregisterPlayheadLayer,
		isAnnotationMode = false,
		showBeatNumbers = false,
		beatsPerLine = 8,
		onOpenTempoTrainer,
		onAnnotationDragStart,
		isDraggingAnnotation = false,
		draggingAnnotationId = null,
		isDragCopyOperation = false,
		dragAnnotationPreviewStartTimeMs = null,
		dragAnnotationPreviewEndTimeMs = null,
		isDragTarget = false,
		dragAnnotationColor = '#ff5500'
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

	// Resize canvas when waveformConfig dimensions change (e.g., on window resize or rowHeight change)
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
			// Re-register playhead layer so PlayheadAnimator gets the updated height
			if (registerPlayheadLayer) {
				untrack(() => {
					registerPlayheadLayer(playheadCanvas || null);
				});
			}
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
			const emptyAreaWidth =
				beatOffset > 0
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
			const songStartX =
				beatOffset > 0
					? (offsetInSeconds / chunkDuration) * width
					: ((chunkDuration - offsetInSeconds) / chunkDuration) * width;
			drawSongStartMarker(ctx, songStartX, height);
		} else {
			// Draw beat grid
			drawBeatGrid(ctx, beatLines, height, activeBeatLineIndices);

			// Draw beat numbers if enabled
			if (showBeatNumbers) {
				drawBeatNumbers(ctx, beatsPerLine, width, height);
			}

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
				placeholderAnnotation.isPoint ||
					placeholderAnnotation.startTimeMs === placeholderAnnotation.endTimeMs
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
		showBeatNumbers; // Track beat numbers toggle
		beatsPerLine; // Track beats per line for beat numbers

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

<div
	class="relative flex {hasActiveLoops && !isLooping ? 'opacity-50' : ''} {isActiveChunk ? 'current-chunk' : ''}"
	data-chunk-index={chunkIndex}
>
	<!-- Canvas Waveform Container -->
	<div class="relative flex-1 min-w-0 overflow-hidden bg-gray-900" style="width: {waveformConfig.width}px; height: {waveformConfig.height}px;">
		<!-- Main waveform canvas -->
		<canvas
			bind:this={canvasElement}
			class="block cursor-crosshair"
			style:touch-action={isAnnotationMode ? 'none' : 'pan-y'}
			onmousedown={handleCanvasMouseDown}
			ontouchstart={handleCanvasTouchStart}
		></canvas>

		<!-- Playhead overlay canvas (drawn by PlayheadAnimator via rAF) -->
		<canvas
			bind:this={playheadCanvas}
			class="pointer-events-none absolute top-0 left-0"
			style="width: {waveformConfig.width}px; height: {waveformConfig.height}px;"
		></canvas>

		<!-- Annotations for this chunk (inside canvas container for proper alignment) -->
		<div
			class="pointer-events-none absolute top-0 left-0"
			style:width="{waveformConfig.width}px"
			style:height="{waveformConfig.height}px"
		>
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
						{onAnnotationDragStart}
						isBeingDraggedCrossRow={isDraggingAnnotation && draggingAnnotationId === annotation.id && !isDragCopyOperation}
					/>
				</div>
			{/each}

			<!-- Cross-row drag ghost preview when this chunk is the drag target -->
			{#if isDragTarget && dragAnnotationPreviewStartTimeMs !== null && dragAnnotationPreviewEndTimeMs !== null}
				{@const previewStartX = timeToPixel(dragAnnotationPreviewStartTimeMs, bounds, waveformConfig.width)}
				{@const previewEndX = timeToPixel(dragAnnotationPreviewEndTimeMs, bounds, waveformConfig.width)}
				{@const previewWidth = Math.max(12, previewEndX - previewStartX)}
				<div
					class="pointer-events-none absolute border-r-2 border-l-2 border-dashed"
					style:left="{previewStartX}px"
					style:top="0"
					style:width="{previewWidth}px"
					style:height="{waveformConfig.height}px"
					style:background-color={dragAnnotationColor}
					style:opacity="0.4"
					style:border-color={dragAnnotationColor}
				></div>
			{/if}

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

	<!-- Row Controls Column -->
	<div
		class="mx-1.5 flex w-7 flex-shrink-0 flex-col items-center justify-center gap-1"
		style="touch-action: pan-y;"
	>
		<button
			class="tooltip-left flex h-6 w-6 items-center justify-center rounded transition-colors {exportingChunk
				? 'bg-gray-700 text-gray-500'
				: 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
			onclick={() => onChunkExport(chunkIndex, startTime, endTime)}
			disabled={exportingChunk}
			data-tooltip={exportingChunk ? 'Exporting...' : 'Export chunk as WAV'}
		>
			{#if exportingChunk}
				<LoaderCircle size={14} strokeWidth={2} class="animate-spin" />
			{:else}
				<Download size={14} strokeWidth={2} />
			{/if}
		</button>
		<button
			class="tooltip-left flex h-6 w-6 items-center justify-center rounded transition-colors bg-amber-800/60 text-amber-300 hover:bg-amber-700/80"
			onclick={() => onOpenTempoTrainer?.(chunkIndex, startTime, endTime)}
			data-tooltip="Tempo Trainer"
		>
			<Crosshair size={14} strokeWidth={2} />
		</button>
		<button
			class="tooltip-left flex h-6 w-6 items-center justify-center rounded transition-colors {isLooping
				? 'bg-blue-600 text-white'
				: 'bg-blue-800/60 text-blue-300 hover:bg-blue-700/80'}"
			onclick={() => onToggleChunkLoop(chunkIndex, startTime, endTime)}
			data-tooltip={isLooping ? 'Remove from loop' : 'Add to loop'}
		>
			{#if isLooping}
				<Square size={12} strokeWidth={2.5} />
			{:else}
				<Repeat size={14} strokeWidth={2} />
			{/if}
		</button>
	</div>
</div>
