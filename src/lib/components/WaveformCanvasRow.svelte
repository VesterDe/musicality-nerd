<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import HtmlAnnotation from './HtmlAnnotation.svelte';
	import type { Annotation } from '../types';
	import type { ChunkBounds, WaveformConfig } from '../utils/svgWaveform';
	import {
		drawDiagonalHatch,
		drawBeatGrid,
		drawWaveformBars,
		drawSongStartMarker,
		drawAnnotationPlaceholder,
		drawBeatNumbers,
		setupHighDPICanvas,
	} from '../utils/canvasWaveform';
	import { timeToPixel } from '../utils/svgWaveform';
	import { getEffectiveRange, type LoopMarkerPair } from '../utils/loopMarkers';
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
		loopMarkerPosition?: LoopMarkerPair | null;
		onLoopMarkerDragStart?: (chunkIndex: number, which: 'a' | 'b', clientX: number) => void;
		hasActiveLoops?: boolean;
		isActiveChunk: boolean;
		activeBarIndex: number;
		waveformConfig: WaveformConfig;
		chunkDuration: number;
		beatOffset: number;
		exportingChunk: boolean;
		onWaveformMouseDown: (event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) => void;
		onWaveformTouchStart: (event: TouchEvent, chunkIndex: number, bounds: ChunkBounds) => void;
		onChunkExport: (chunkIndex: number, startTime: number, endTime: number) => void;
		onToggleChunkLoop: (chunkIndex: number, startTime: number, endTime: number, shiftKey: boolean) => void;
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
		loopMarkerPosition = null,
		onLoopMarkerDragStart,
		hasActiveLoops = false,
		isActiveChunk,
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
			setupHighDPICanvas(canvasElement, waveformConfig.width, waveformConfig.height, { alpha: false });
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
			setupHighDPICanvas(canvasElement, width, height, { alpha: false });
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
	// DEBUG: track main canvas redraw frequency
	let _redrawCount = 0;
	let _redrawLogTimer: ReturnType<typeof setInterval> | null = null;
	function _startRedrawLog() {
		if (!_redrawLogTimer) {
			_redrawLogTimer = setInterval(() => {
				if (_redrawCount > 0) {
					console.log(`[MainCanvas chunk=${chunkIndex}] redraws in last 2s: ${_redrawCount}`);
					_redrawCount = 0;
				}
			}, 2000);
		}
	}

	function redraw() {
		if (!ctx || !canvasElement) return;
		_redrawCount++;
		_startRedrawLog();

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
			// Draw beat grid (static style only — active beat flash is on the overlay canvas)
			drawBeatGrid(ctx, beatLines, height);

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

	// Redraw when relevant props change.
	// activeBarIndex, isActiveChunk, activeBeatLineIndices intentionally excluded —
	// they change rapidly during playback. Beat flash is rendered on the overlay canvas
	// by PlayheadAnimator via rAF, so the main canvas stays static during playback.
	let _prevDeps: Record<string, unknown> = {};
	$effect(() => {
		const deps: Record<string, unknown> = {
			waveformBars,
			waveformBarsPerStem,
			stemColors,
			stemEnabled,
			beatLines,
			isSpecialChunk,
			beatOffset,
			chunkDuration,
			'waveformConfig.width': waveformConfig.width,
			'waveformConfig.height': waveformConfig.height,
			placeholderAnnotation,
			bounds,
			showBeatNumbers,
			beatsPerLine,
		};

		// DEBUG: log which dependency changed (skip first run)
		if (_prevDeps.waveformBars !== undefined) {
			const changed = Object.keys(deps).filter(k => deps[k] !== _prevDeps[k]);
			if (changed.length > 0) {
				console.log(`[MainCanvas chunk=${chunkIndex}] redraw triggered by:`, changed);
			}
		}
		_prevDeps = { ...deps };

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

		<!-- Dimmed areas outside loop markers -->
		{#if isLooping && loopMarkerPosition}
			{@const range = getEffectiveRange(loopMarkerPosition.markerA, loopMarkerPosition.markerB)}
			{@const dimStartWidth = range.start * waveformConfig.width}
			{@const rangeEndX = range.end * waveformConfig.width}
			{#if dimStartWidth > 0}
				<div
					class="pointer-events-none absolute top-0 left-0"
					style="width: {dimStartWidth}px; height: {waveformConfig.height}px; background-color: rgba(0, 0, 0, 0.5);"
				></div>
			{/if}
			{#if rangeEndX < waveformConfig.width}
				<div
					class="pointer-events-none absolute top-0"
					style="left: {rangeEndX}px; right: 0; height: {waveformConfig.height}px; background-color: rgba(0, 0, 0, 0.5);"
				></div>
			{/if}
		{/if}

		<!-- Playhead overlay canvas (drawn by PlayheadAnimator via rAF) -->
		<!-- Hidden when not active to reduce compositor layer count -->
		<canvas
			bind:this={playheadCanvas}
			class="pointer-events-none absolute top-0 left-0"
			style="width: {waveformConfig.width}px; height: {waveformConfig.height}px;{isActiveChunk ? '' : ' display: none;'}"
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

	<!-- Loop Marker Area (below looping rows) -->
	{#if isLooping && loopMarkerPosition}
		{@const range = getEffectiveRange(loopMarkerPosition.markerA, loopMarkerPosition.markerB)}
		{@const markerAX = loopMarkerPosition.markerA * waveformConfig.width}
		{@const markerBX = loopMarkerPosition.markerB * waveformConfig.width}
		{@const rangeStartX = range.start * waveformConfig.width}
		{@const rangeEndX = range.end * waveformConfig.width}
		<div
			class="pointer-events-none absolute left-0"
			style="bottom: -14px; height: 14px; width: {waveformConfig.width}px;"
		>
			<!-- Range bar between markers -->
			<div
				class="absolute"
				style="left: {rangeStartX}px; width: {rangeEndX - rangeStartX}px; top: 6px; height: 2px; background-color: rgba(59, 130, 246, 0.3);"
			></div>

			<!-- Marker A triangle -->
			<div
				class="pointer-events-auto absolute"
				style="left: {markerAX - 5}px; top: 2px; cursor: ew-resize; filter: drop-shadow(0 0 2px rgba(37, 99, 235, 0.6));"
				role="slider"
				aria-label="Loop start marker"
				aria-valuenow={loopMarkerPosition.markerA}
				tabindex="-1"
				onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); onLoopMarkerDragStart?.(chunkIndex, 'a', e.clientX); }}
				ontouchstart={(e) => { e.stopPropagation(); e.preventDefault(); if (e.touches.length > 0) onLoopMarkerDragStart?.(chunkIndex, 'a', e.touches[0].clientX); }}
			>
				<svg width="10" height="8" viewBox="0 0 10 8">
					<polygon points="0,8 10,8 5,0" fill="#2563eb" />
				</svg>
			</div>

			<!-- Marker B triangle -->
			<div
				class="pointer-events-auto absolute"
				style="left: {markerBX - 5}px; top: 2px; cursor: ew-resize; filter: drop-shadow(0 0 2px rgba(37, 99, 235, 0.6));"
				role="slider"
				aria-label="Loop end marker"
				aria-valuenow={loopMarkerPosition.markerB}
				tabindex="-1"
				onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); onLoopMarkerDragStart?.(chunkIndex, 'b', e.clientX); }}
				ontouchstart={(e) => { e.stopPropagation(); e.preventDefault(); if (e.touches.length > 0) onLoopMarkerDragStart?.(chunkIndex, 'b', e.touches[0].clientX); }}
			>
				<svg width="10" height="8" viewBox="0 0 10 8">
					<polygon points="0,8 10,8 5,0" fill="#2563eb" />
				</svg>
			</div>
		</div>
	{/if}

	<!-- Row Controls Column -->
	<div
		class="mx-1.5 flex w-7 flex-shrink-0 flex-col items-center justify-center gap-1"
		style="touch-action: pan-y;"
	>
		<button
			class="tooltip-left flex h-6 w-6 items-center justify-center rounded transition-colors {exportingChunk
				? 'text-gray-500'
				: 'text-gray-300 hover:bg-gray-600'}"
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
			class="tooltip-left flex h-6 w-6 items-center justify-center rounded transition-colors text-amber-300 hover:bg-amber-700/80"
			onclick={() => onOpenTempoTrainer?.(chunkIndex, startTime, endTime)}
			data-tooltip="Tempo Trainer"
		>
			<Crosshair size={14} strokeWidth={2} />
		</button>
		<button
			class="tooltip-left flex h-6 w-6 items-center justify-center rounded transition-colors {isLooping
				? 'bg-blue-600 text-white'
				: 'text-blue-300 hover:bg-blue-700/80'}"
			onclick={(e) => onToggleChunkLoop(chunkIndex, startTime, endTime, e.shiftKey)}
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
