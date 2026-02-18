<script lang="ts">
	import { onMount } from 'svelte';
	import AnnotationPopup from './AnnotationPopup.svelte';
	import WaveformCanvasRow from './WaveformCanvasRow.svelte';
	import type { Annotation } from '../types';
	import type { AudioEngine } from '../audio/AudioEngine';
	import { AudioExportService } from '../audio/AudioExportService';
	import {
		calculateChunkBounds,
		generateWaveformBars,
		generateBeatGrid,
		pixelToTime,
		type WaveformConfig,
		type ChunkBounds
	} from '../utils/svgWaveform';
	import { drawActiveBeatFlash } from '../utils/canvasWaveform';
	import {
		getMarkerPosition,
		getEffectiveRange,
		fractionRangeToTimeRange,
		type LoopMarkerPair
	} from '../utils/loopMarkers';

	interface Props {
		currentTime: number;
		bpm: number;
		targetBPM: number;
		audioEngine: AudioEngine;
		beatOffset: number;
		beatsPerLine: number;
		rowHeight?: number;
		isPlaying?: boolean;
		rectsPerBeatMode?: 'auto' | number;
		onChunkLoop?: (
			chunkIndex: number,
			startTime: number,
			endTime: number,
			shiftKey: boolean
		) => void;
		onClearLoop?: () => void;
		loopingChunkIndices?: Set<number>;
		loopMarkerPositions?: Map<number, LoopMarkerPair>;
		onLoopMarkerUpdate?: (chunkIndex: number, which: 'a' | 'b', fraction: number) => void;
		onSeek?: (time: number) => void;
		onBeatsPerLineChange?: (value: number) => void;
		isAnnotationMode?: boolean;
		annotations?: Annotation[];
		onAnnotationCreated?: (
			startTimeMs: number,
			endTimeMs: number,
			label?: string,
			color?: string,
			isPoint?: boolean
		) => void;
		onAnnotationUpdated?: (id: string, updates: Partial<Annotation>) => void;
		onAnnotationDeleted?: (id: string) => void;
		onAnnotationModalStateChange?: (isOpen: boolean) => void;
		filename?: string;
		currentSession?: {
			mode?: 'single' | 'stem';
			stems?: Array<{ enabled: boolean; color?: string }>;
		} | null;
		showBeatNumbers?: boolean;
		onOpenTempoTrainer?: (chunkIndex: number, startTime: number, endTime: number) => void;
		registerScrollToChunk?: (fn: (chunkIndex: number) => void) => void;
	}

	let {
		currentTime = 0,
		bpm = 120,
		targetBPM = 120,
		audioEngine,
		beatOffset = 0,
		beatsPerLine = 16,
		rowHeight = 96,
		isPlaying = false,
		rectsPerBeatMode = 'auto',
		onChunkLoop,
		onClearLoop,
		loopingChunkIndices = new Set<number>(),
		loopMarkerPositions = new Map<number, LoopMarkerPair>(),
		onLoopMarkerUpdate,
		onSeek,
		isAnnotationMode = false,
		annotations = [],
		onAnnotationCreated,
		onAnnotationUpdated,
		onAnnotationDeleted,
		onAnnotationModalStateChange,
		filename = 'audio',
		currentSession = null,
		showBeatNumbers = false,
		onOpenTempoTrainer,
		registerScrollToChunk
	}: Props = $props();

	// Component state
	let waveformContainer: HTMLDivElement | undefined = $state();
	let beatGrouping = $state(beatsPerLine);
	let isInitialized = $state(false);
	let peaksData: Float32Array | null = $state(null);
	let audioSampleRate = $state(44100);
	let audioDuration = $state(0);

	// Container width state for resize handling
	let containerWidthState = $state(800); // Default width

	// Stem mode state
	let stemPeaksData: Float32Array[] = $state([]);
	let stemColors: string[] = $state([]);
	let stemEnabled: boolean[] = $state([]);
	let isStemMode = $state(false);

	// Virtualization state - scroll-based
	let scrollContainer: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let viewportHeight = $state(typeof window !== 'undefined' ? window.innerHeight : 800);
	const OVERSCAN_CHUNKS = 2; // Number of chunks to render outside viewport
	let rafId: number | null = null;

	// Export service
	let exportService = $state(new AudioExportService());
	let exportingChunks = $state(new Set<number>()); // Track which chunks are being exported

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
	let lastPointerClientX = $state(0);
	let lastPointerClientY = $state(0);

	// Touch interaction state for scroll detection
	let touchStartX = $state(0);
	let touchStartY = $state(0);
	let touchStartTime = $state(0);
	let isTouchDrag = $state(false);
	const TOUCH_MOVE_THRESHOLD = 10; // pixels - if touch moves more than this, consider it a scroll

	// Cross-row annotation drag state
	let isDraggingAnnotation = $state(false);
	let draggingAnnotationId = $state<string | null>(null);
	let dragAnnotationSourceChunk = $state<number | null>(null);
	let dragAnnotationOriginalTimes = $state<{ startTimeMs: number; endTimeMs: number } | null>(null);
	let dragAnnotationPreviewTimeMs = $state<number | null>(null);
	let dragAnnotationCurrentChunk = $state<number | null>(null);
	let dragAnnotationDuration = $state<number>(0);
	let isDragCopyOperation = $state(false);
	let dragAnnotationLabel = $state<string>('');
	let dragAnnotationColor = $state<string>('#ff5500');

	// Placeholder annotation state
	let showPlaceholder = $state(false);
	let placeholderStartTimeMs = $state(0);
	let placeholderEndTimeMs = $state(0);

	// Playhead animation state
	let playheadAnimator: PlayheadAnimator | null = $state(null);

	// Queue for registrations that happen before animator exists
	const pendingRegistrations = new Map<
		number,
		{
			canvas: HTMLCanvasElement | null;
		}
	>();

	// Stable callback functions for playhead layer registration
	function createRegisterCallback(chunkIndex: number) {
		return (canvas: HTMLCanvasElement | null) => {
			if (playheadAnimator) {
				playheadAnimator.registerChunkLayer(chunkIndex, canvas);
			} else {
				// Queue the registration for when animator is ready
				pendingRegistrations.set(chunkIndex, { canvas });
			}
		};
	}

	function createUnregisterCallback(chunkIndex: number) {
		return () => {
			if (playheadAnimator) {
				playheadAnimator.unregisterChunkLayer(chunkIndex);
			} else {
				// Remove from pending registrations if animator doesn't exist yet
				pendingRegistrations.delete(chunkIndex);
			}
		};
	}

	/**
	 * Pure helper function to compute playhead position from time
	 * Extracted from reactive playheadInfo for use in both reactive and rAF contexts
	 */
	function computePlayheadPosition(
		timeSeconds: number,
		chunkDuration: number,
		containerWidth: number,
		beatOffset: number,
		audioDuration: number
	): { chunkIndex: number; chunkContainerIndex: number; x: number } | null {
		if (audioDuration <= 0) return null;

		// Determine which chunk to show playhead in
		let currentChunkIndex: number;
		let chunkContainerIndex: number;

		if (beatOffset > 0) {
			if (timeSeconds < chunkDuration) {
				currentChunkIndex = -1;
				chunkContainerIndex = 0;
			} else {
				const timeAfterFirstChunk = timeSeconds - chunkDuration;
				currentChunkIndex = Math.floor(timeAfterFirstChunk / chunkDuration);
				chunkContainerIndex = currentChunkIndex + 1;
			}
		} else if (beatOffset < 0) {
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			if (timeSeconds < offsetInSeconds) {
				currentChunkIndex = -1;
				chunkContainerIndex = 0;
			} else {
				const adjustedTime = timeSeconds - offsetInSeconds;
				currentChunkIndex = Math.floor(adjustedTime / chunkDuration);
				chunkContainerIndex = currentChunkIndex + 1;
			}
		} else {
			currentChunkIndex = Math.floor(timeSeconds / chunkDuration);
			chunkContainerIndex = currentChunkIndex;
		}

		// Calculate playhead X position
		let x = 0;

		if (currentChunkIndex === -1) {
			// Special chunk -1 handling
			if (beatOffset > 0) {
				const offsetInSeconds = beatOffset / 1000;
				const songStartX = (offsetInSeconds / chunkDuration) * containerWidth;

				if (timeSeconds === 0) {
					x = songStartX;
				} else if (timeSeconds <= chunkDuration) {
					// Linear progression: map time within the song portion
					const songDuration = chunkDuration - offsetInSeconds;
					const progressRatio = timeSeconds / songDuration;
					const songPortionWidth = containerWidth - songStartX;
					x = songStartX + progressRatio * songPortionWidth;
				}
			} else if (beatOffset < 0) {
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const songStartX = ((chunkDuration - offsetInSeconds) / chunkDuration) * containerWidth;

				if (timeSeconds === 0) {
					x = songStartX;
				} else if (timeSeconds <= offsetInSeconds) {
					// Linear progression: map timeSeconds linearly across the song portion
					const progressRatio = timeSeconds / offsetInSeconds;
					const songPortionWidth = containerWidth - songStartX;
					x = songStartX + progressRatio * songPortionWidth;
				}
			}
		} else {
			// Normal playhead positioning for regular chunks
			if (beatOffset > 0) {
				const chunkStartTime = chunkDuration + currentChunkIndex * chunkDuration;
				const timeInChunk = timeSeconds - chunkStartTime;
				x = (timeInChunk / chunkDuration) * containerWidth;
			} else if (beatOffset < 0) {
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const chunkStartTime = offsetInSeconds + currentChunkIndex * chunkDuration;
				const timeInChunk = timeSeconds - chunkStartTime;
				x = (timeInChunk / chunkDuration) * containerWidth;
			} else {
				const chunkStartTime = currentChunkIndex * chunkDuration;
				const timeInChunk = timeSeconds - chunkStartTime;
				x = (timeInChunk / chunkDuration) * containerWidth;
			}
		}

		return {
			chunkIndex: currentChunkIndex,
			chunkContainerIndex,
			x
		};
	}

	/**
	 * PlayheadAnimator: Manages smooth playhead updates via requestAnimationFrame
	 * Updates canvas directly without triggering Svelte reactivity
	 */
	class PlayheadAnimator {
		private rafId: number | null = null;
		private isRunning = false;
		private lastActiveChunkIndex: number | null = null;
		// Pre-rendered triangle+glow bitmaps (avoids per-frame shadowBlur)
		private topTriangleCanvas: HTMLCanvasElement | null = null;
		private bottomTriangleCanvas: HTMLCanvasElement | null = null;
		private static readonly TRI_SIZE = 8;
		private static readonly TRI_PAD = 4; // padding for shadow blur spread
		private getCurrentTime: () => number;
		private computePosition: (
			time: number
		) => { chunkIndex: number; chunkContainerIndex: number; x: number } | null;
		private onTick: (() => void) | null;
		private chunkLayers: Map<
			number,
			{
				canvas: HTMLCanvasElement | null;
				ctx: CanvasRenderingContext2D | null;
				height: number;
			}
		> = new Map();
		// Beat lines for the overlay (shared across all non-special chunks)
		private beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }> = [];

		constructor(
			getCurrentTime: () => number,
			computePosition: (
				time: number
			) => { chunkIndex: number; chunkContainerIndex: number; x: number } | null,
			onTick?: () => void
		) {
			this.getCurrentTime = getCurrentTime;
			this.computePosition = computePosition;
			this.onTick = onTick ?? null;
		}

		/**
		 * Pre-render triangle+glow to offscreen canvases (called once, reused every frame)
		 */
		private ensureTriangleCaches(): void {
			if (this.topTriangleCanvas) return; // already created

			const size = PlayheadAnimator.TRI_SIZE;
			const pad = PlayheadAnimator.TRI_PAD;
			const dim = size + pad * 2;

			// Top triangle (pointing down): tip at bottom-center
			this.topTriangleCanvas = document.createElement('canvas');
			this.topTriangleCanvas.width = dim;
			this.topTriangleCanvas.height = dim;
			const topCtx = this.topTriangleCanvas.getContext('2d')!;
			topCtx.shadowColor = 'rgba(251, 191, 36, 0.8)';
			topCtx.shadowBlur = 2;
			topCtx.shadowOffsetX = 0;
			topCtx.shadowOffsetY = 0;
			topCtx.fillStyle = '#fbbf24';
			topCtx.beginPath();
			topCtx.moveTo(pad, pad);
			topCtx.lineTo(pad + size, pad);
			topCtx.lineTo(pad + size / 2, pad + size);
			topCtx.closePath();
			topCtx.fill();

			// Bottom triangle (pointing up): tip at top-center
			this.bottomTriangleCanvas = document.createElement('canvas');
			this.bottomTriangleCanvas.width = dim;
			this.bottomTriangleCanvas.height = dim;
			const botCtx = this.bottomTriangleCanvas.getContext('2d')!;
			botCtx.shadowColor = 'rgba(251, 191, 36, 0.8)';
			botCtx.shadowBlur = 2;
			botCtx.shadowOffsetX = 0;
			botCtx.shadowOffsetY = 0;
			botCtx.fillStyle = '#fbbf24';
			botCtx.beginPath();
			botCtx.moveTo(pad, pad + size);
			botCtx.lineTo(pad + size, pad + size);
			botCtx.lineTo(pad + size / 2, pad);
			botCtx.closePath();
			botCtx.fill();
		}

		/**
		 * Update the beat line positions used for overlay flash rendering.
		 * Called when beatGrouping or containerWidth changes.
		 */
		setBeatLines(lines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>): void {
			this.beatLines = lines;
		}

		/**
		 * Compute which beat lines are currently active (within flash window).
		 * Uses component closure variables: bpm, beatOffset, chunkDuration, beatGrouping.
		 */
		private computeActiveBeatIndices(time: number, chunkIndex: number): Set<number> {
			const indices = new Set<number>();
			if (chunkIndex === -1) return indices; // No beat grid on special chunk

			const offsetInSeconds = beatOffset / 1000;
			const beatDuration = 60 / bpm;
			const flashDuration = 0.1; // 100ms window
			const gridTime = time + offsetInSeconds;

			const chunkStartGridTime = chunkIndex * chunkDuration;

			let lineIndex = 0;
			for (let i = 0.5; i < beatGrouping; i += 0.5) {
				const beatLineGridTime = chunkStartGridTime + i * beatDuration;
				if (Math.abs(gridTime - beatLineGridTime) <= flashDuration / 2) {
					indices.add(lineIndex);
				}
				lineIndex++;
			}
			return indices;
		}

		/**
		 * Register a playhead layer for a chunk
		 */
		registerChunkLayer(chunkIndex: number, canvas: HTMLCanvasElement | null): void {
			const ctx = canvas?.getContext('2d') || null;
			const height = canvas?.height || 0;
			this.chunkLayers.set(chunkIndex, { canvas, ctx, height });
			// Immediately sync position - this will show playhead on the correct chunk
			// Sync both immediately and in next frame to ensure canvas is ready
			const currentTime = this.getCurrentTime();
			this.updatePosition(currentTime);
			// Also sync in next frame in case canvas context wasn't ready
			requestAnimationFrame(() => {
				this.updatePosition(this.getCurrentTime());
			});
		}

		/**
		 * Unregister a playhead layer (e.g., when chunk is virtualized out)
		 */
		unregisterChunkLayer(chunkIndex: number): void {
			this.chunkLayers.delete(chunkIndex);
		}

		/**
		 * Update playhead position for a specific time
		 */
		private updatePosition(time: number): void {
			const pos = this.computePosition(time);
			if (!pos) return;

			// Only clear the previously active chunk's canvas (not all registered chunks)
			if (this.lastActiveChunkIndex !== null && this.lastActiveChunkIndex !== pos.chunkIndex) {
				const prevLayer = this.chunkLayers.get(this.lastActiveChunkIndex);
				if (prevLayer?.ctx && prevLayer?.canvas) {
					prevLayer.ctx.clearRect(0, 0, prevLayer.canvas.width, prevLayer.canvas.height);
				}
			}

			// Show and position playhead for the active chunk
			const activeLayer = this.chunkLayers.get(pos.chunkIndex);
			if (!activeLayer || !activeLayer.ctx || !activeLayer.canvas) {
				this.lastActiveChunkIndex = pos.chunkIndex;
				return;
			}

			// Clear current chunk's canvas before redrawing
			activeLayer.ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
			this.lastActiveChunkIndex = pos.chunkIndex;

			const roundedX = Math.round(pos.x);
			const dpr = 1;
			const logicalHeight = activeLayer.height / dpr;

			// Draw playhead line
			activeLayer.ctx.strokeStyle = '#fbbf24';
			activeLayer.ctx.lineWidth = 1.5;
			activeLayer.ctx.globalAlpha = 0.3;
			activeLayer.ctx.beginPath();
			activeLayer.ctx.moveTo(roundedX, 0);
			activeLayer.ctx.lineTo(roundedX, logicalHeight);
			activeLayer.ctx.stroke();
			activeLayer.ctx.globalAlpha = 1.0;

			// Stamp pre-rendered triangle+glow bitmaps
			this.ensureTriangleCaches();
			const pad = PlayheadAnimator.TRI_PAD;
			const triangleX = roundedX - PlayheadAnimator.TRI_SIZE / 2;

			// Top triangle
			activeLayer.ctx.drawImage(this.topTriangleCanvas!, triangleX - pad, -pad);
			// Bottom triangle
			activeLayer.ctx.drawImage(this.bottomTriangleCanvas!, triangleX - pad, logicalHeight - PlayheadAnimator.TRI_SIZE - pad);

			// Draw active beat line flash on the overlay
			if (this.beatLines.length > 0) {
				const activeIndices = this.computeActiveBeatIndices(time, pos.chunkIndex);
				if (activeIndices.size > 0) {
					drawActiveBeatFlash(activeLayer.ctx, this.beatLines, logicalHeight, activeIndices);
				}
			}
		}

		/**
		 * Animation loop (capped at ~90fps to avoid wasting cycles on high-refresh displays)
		 */
		private static readonly FRAME_INTERVAL = 1000 / 90; // ~11.1ms
		private lastFrameTime = 0;
		private animate = (now: number): void => {
			if (!this.isRunning) return;

			// Everything capped at ~60fps — tick + draw in same gate
			if (now - this.lastFrameTime >= PlayheadAnimator.FRAME_INTERVAL) {
				this.lastFrameTime = now;
				this.onTick?.();
				const time = this.getCurrentTime();
				this.updatePosition(time);
			}

			this.rafId = requestAnimationFrame(this.animate);
		};

		/**
		 * Set playing state (start/stop animation loop)
		 */
		setPlayingState(playing: boolean): void {
			if (playing === this.isRunning) return;

			this.isRunning = playing;

			if (playing) {
				this.lastFrameTime = 0; // draw immediately on first frame
				this.rafId = requestAnimationFrame(this.animate);
			} else {
				if (this.rafId !== null) {
					cancelAnimationFrame(this.rafId);
					this.rafId = null;
				}
			}
		}

		/**
		 * Sync playhead to a specific time (for seeks/pauses)
		 */
		syncToTime(time: number): void {
			this.updatePosition(time);
		}

		/**
		 * Cleanup
		 */
		dispose(): void {
			this.setPlayingState(false);
			this.chunkLayers.clear();
			this.lastActiveChunkIndex = null;
			this.topTriangleCanvas = null;
			this.bottomTriangleCanvas = null;
		}
	}

	// Derived values
	const chunkDuration = $derived(beatGrouping * (60 / bpm));
	const effectiveChunkDuration = $derived(beatGrouping * (60 / targetBPM));
	const effectiveDuration = $derived(audioDuration * (bpm / targetBPM));
	const totalChunks = $derived.by(() => {
		if (audioDuration <= 0) return 0;
		const baseChunks = Math.ceil(audioDuration / chunkDuration);
		if (beatOffset > 0) return baseChunks + 1;
		if (beatOffset < 0) return baseChunks + 1;
		return baseChunks;
	});

	// Width reserved for the row controls column on the right of each row
	const BUTTON_COLUMN_WIDTH = 32;

	// Get responsive container width (reacts to resize via containerWidthState)
	// Subtract button column width so the waveform canvas fits alongside it
	const containerWidth = $derived(Math.max(100, containerWidthState - BUTTON_COLUMN_WIDTH));

	// Helper function to find nearest power of two below or equal to n
	function nearestPow2BelowOrEqual(n: number): number {
		if (n <= 0) return 1;
		return Math.pow(2, Math.floor(Math.log2(n)));
	}

	// Helper function to find nearest power of two above or equal to n
	function nearestPow2AboveOrEqual(n: number): number {
		if (n <= 0) return 1;
		return Math.pow(2, Math.ceil(Math.log2(n)));
	}

	const MAX_PER_BEAT = 128; // Guardrail to prevent excessive bar generation
	const MIN_PER_BEAT = 8; // Minimum for auto mode

	// Compute rectangles per beat using power-of-two constraint
	const rectsPerBeat = $derived.by(() => {
		// If manual mode, use the specified value (must be power of two)
		if (rectsPerBeatMode !== 'auto' && typeof rectsPerBeatMode === 'number') {
			return rectsPerBeatMode;
		}

		// Auto mode: compute desired density based on viewport width
		const pixelsPerBeat = containerWidth / beatGrouping;
		const desired = Math.max(1, Math.floor(pixelsPerBeat / 2)); // ~2px per rect
		const capped = Math.min(MAX_PER_BEAT, desired);
		const pow2 = nearestPow2BelowOrEqual(capped);

		// Ensure we meet the minimum requirement while keeping it a power of two
		if (pow2 >= MIN_PER_BEAT) {
			return pow2;
		} else {
			// If pow2 is less than min, find the smallest power of two >= MIN_PER_BEAT
			return nearestPow2AboveOrEqual(MIN_PER_BEAT);
		}
	});

	// Compute total target bars as beats per line * rectangles per beat
	const targetBars = $derived(beatGrouping * rectsPerBeat);

	const waveformConfig = $derived.by(
		(): WaveformConfig => ({
			width: containerWidth,
			height: rowHeight,
			sampleRate: audioSampleRate,
			audioDuration,
			beatOffset,
			chunkDuration
		})
	);

	// Virtualization: Calculate chunk height (waveform height + spacing between rows)
	const chunkHeight = $derived(waveformConfig.height + 12); // 12px spacing (space-y-3)

	/**
	 * Calculate virtual window: which chunks should be rendered based on scroll position
	 * Returns: { startIndex, endIndex, offsetTop }
	 */
	function calculateVirtualWindow(
		scrollTop: number,
		viewportHeight: number,
		itemHeight: number,
		itemCount: number,
		overscanCount: number
	): { startIndex: number; endIndex: number; offsetTop: number } {
		if (itemCount === 0) {
			return { startIndex: 0, endIndex: 0, offsetTop: 0 };
		}

		// Calculate visible range
		const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscanCount);
		const endIndex = Math.min(
			itemCount,
			Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscanCount
		);

		// Calculate offset for positioning visible items
		const offsetTop = startIndex * itemHeight;

		return { startIndex, endIndex, offsetTop };
	}

	// Compute all chunk metadata first (lightweight)
	const chunkMetadata = $derived.by(() => {
		if (!isInitialized || totalChunks === 0) return [];

		const metadata = [];
		for (let chunkIndex = beatOffset !== 0 ? -1 : 0; chunkIndex < totalChunks; chunkIndex++) {
			if (chunkIndex === -1 && beatOffset === 0) continue;

			const bounds = calculateChunkBounds(chunkIndex, waveformConfig);
			const isSpecialChunk = chunkIndex === -1 && beatOffset !== 0;

			metadata.push({
				index: chunkIndex,
				bounds,
				isSpecialChunk,
				startTime: bounds.startTimeMs / 1000,
				endTime: bounds.endTimeMs / 1000
			});
		}
		return metadata;
	});

	// Calculate virtual window based on current scroll state
	const virtualWindow = $derived.by(() => {
		if (chunkMetadata.length === 0) {
			return { startIndex: 0, endIndex: 0, offsetTop: 0 };
		}
		// If viewport height not yet measured, render first few chunks
		if (viewportHeight === 0) {
			return { startIndex: 0, endIndex: Math.min(5, chunkMetadata.length), offsetTop: 0 };
		}
		return calculateVirtualWindow(
			scrollTop,
			viewportHeight,
			chunkHeight,
			chunkMetadata.length,
			OVERSCAN_CHUNKS
		);
	});

	// Get visible chunk indices for rendering
	const visibleChunkIndices = $derived.by(() => {
		const indices = new Set<number>();
		for (let i = virtualWindow.startIndex; i < virtualWindow.endIndex; i++) {
			if (i >= 0 && i < chunkMetadata.length) {
				indices.add(chunkMetadata[i].index);
			}
		}
		return indices;
	});

	// --- Per-chunk render cache ---
	// Caches generated waveform data so that scrolling (which only changes visibility)
	// returns the SAME array references for already-visible chunks. Svelte's fine-grained
	// comparison sees unchanged references and skips downstream $effect redraws.
	type ChunkRenderData = {
		waveformBars: Array<{
			x: number;
			y: number;
			width: number;
			height: number;
			isEmpty?: boolean;
			annotationColors?: Array<{ color: string; startY: number; endY: number }>;
		}>;
		waveformBarsPerStem:
			| Array<Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }>>
			| undefined;
		beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>;
		headerInfo: string;
		cacheKey: string;
	};
	const chunkRenderCache = new Map<number, ChunkRenderData>();

	// Shared beat grid for all non-special chunks (same positions for every chunk)
	let sharedBeatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }> = [];
	let sharedBeatLinesKey = '';

	function getSharedBeatLines(): Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }> {
		const key = `${beatGrouping}-${waveformConfig.width}-${waveformConfig.height}`;
		if (key !== sharedBeatLinesKey) {
			sharedBeatLines = generateBeatGrid(beatGrouping, waveformConfig.width, waveformConfig.height);
			sharedBeatLinesKey = key;
		}
		return sharedBeatLines;
	}

	// Build a cache key from parameters that affect waveform generation for a chunk
	function buildChunkCacheKey(chunkIndex: number, boundsStart: number, boundsEnd: number): string {
		return `${chunkIndex}|${boundsStart}|${boundsEnd}|${waveformConfig.width}|${waveformConfig.height}|${targetBars}|${beatGrouping}|${beatOffset}|${chunkDuration}|${isStemMode}|${stemPeaksData.length}`;
	}

	// Heavy computation: generate waveform data for visible chunks only
	const rawChunkData = $derived.by(() => {
		if (
			(!peaksData && !isStemMode) ||
			(isStemMode && stemPeaksData.length === 0) ||
			chunkMetadata.length === 0
		)
			return [];

		const chunks = [];

		// Collect which chunk indices are still needed so we can prune stale cache entries
		const neededIndices = new Set<number>();

		for (const meta of chunkMetadata) {
			const shouldRenderContent = isChunkInRenderRange(meta.index);

			if (shouldRenderContent) {
				neededIndices.add(meta.index);
				const key = buildChunkCacheKey(meta.index, meta.bounds.startSample, meta.bounds.endSample);
				const cached = chunkRenderCache.get(meta.index);

				if (cached && cached.cacheKey === key) {
					// Cache hit — reuse same array references (no downstream Svelte updates)
					chunks.push({
						index: meta.index,
						bounds: meta.bounds,
						isSpecialChunk: meta.isSpecialChunk,
						waveformBars: cached.waveformBars,
						waveformBarsPerStem: cached.waveformBarsPerStem,
						beatLines: cached.beatLines,
						headerInfo: cached.headerInfo,
						startTime: meta.startTime,
						endTime: meta.endTime,
						shouldRenderContent: true
					});
					continue;
				}

				// Cache miss — generate fresh data
				let waveformBars: ChunkRenderData['waveformBars'] = [];
				let waveformBarsPerStem: ChunkRenderData['waveformBarsPerStem'] = undefined;
				let beatLines: ChunkRenderData['beatLines'] = [];
				let headerInfo = '';

				if (isStemMode && stemPeaksData.length > 0) {
					if (meta.isSpecialChunk) {
						const offsetInSeconds = Math.abs(beatOffset) / 1000;
						headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;
						const stemBars = stemPeaksData.map((stemPeaks) =>
							generateWaveformBars(
								stemPeaks,
								meta.bounds,
								waveformConfig.width,
								waveformConfig.height,
								targetBars,
								meta.index,
								beatOffset,
								chunkDuration
							)
						);
						waveformBarsPerStem = stemBars;
						waveformBars = stemBars[0] || [];
					} else {
						beatLines = getSharedBeatLines();
						const stemBars = stemPeaksData.map((stemPeaks) =>
							generateWaveformBars(
								stemPeaks,
								meta.bounds,
								waveformConfig.width,
								waveformConfig.height,
								targetBars,
								meta.index,
								beatOffset,
								chunkDuration
							)
						);
						waveformBarsPerStem = stemBars;
						waveformBars = stemBars[0] || [];
						const st = meta.bounds.startTimeMs / 1000;
						const et = meta.bounds.endTimeMs / 1000;
						const startingBeat = meta.index * beatGrouping + 1;
						headerInfo = `Chunk ${meta.index + 1} (${st.toFixed(1)}s - ${et.toFixed(1)}s) Beats ${startingBeat} - ${startingBeat + beatGrouping - 1}`;
					}
				} else {
					if (meta.isSpecialChunk) {
						const offsetInSeconds = Math.abs(beatOffset) / 1000;
						headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;
						waveformBars = generateWaveformBars(
							peaksData!,
							meta.bounds,
							waveformConfig.width,
							waveformConfig.height,
							targetBars,
							meta.index,
							beatOffset,
							chunkDuration
						);
					} else {
						beatLines = getSharedBeatLines();
						waveformBars = generateWaveformBars(
							peaksData!,
							meta.bounds,
							waveformConfig.width,
							waveformConfig.height,
							targetBars,
							meta.index,
							beatOffset,
							chunkDuration
						);
						const st = meta.bounds.startTimeMs / 1000;
						const et = meta.bounds.endTimeMs / 1000;
						const startingBeat = meta.index * beatGrouping + 1;
						headerInfo = `Chunk ${meta.index + 1} (${st.toFixed(1)}s - ${et.toFixed(1)}s) Beats ${startingBeat} - ${startingBeat + beatGrouping - 1}`;
					}
				}

				// Store in cache
				chunkRenderCache.set(meta.index, {
					waveformBars,
					waveformBarsPerStem,
					beatLines,
					headerInfo,
					cacheKey: key
				});

				chunks.push({
					index: meta.index,
					bounds: meta.bounds,
					isSpecialChunk: meta.isSpecialChunk,
					waveformBars,
					waveformBarsPerStem,
					beatLines,
					headerInfo,
					startTime: meta.startTime,
					endTime: meta.endTime,
					shouldRenderContent: true
				});
			} else {
				// Non-visible chunk — lightweight placeholder
				chunks.push({
					index: meta.index,
					bounds: meta.bounds,
					isSpecialChunk: meta.isSpecialChunk,
					waveformBars: [] as ChunkRenderData['waveformBars'],
					waveformBarsPerStem: undefined,
					beatLines: [] as ChunkRenderData['beatLines'],
					headerInfo: '',
					startTime: meta.startTime,
					endTime: meta.endTime,
					shouldRenderContent: false
				});
			}
		}

		// Prune stale cache entries (chunks scrolled far away)
		for (const cachedIndex of chunkRenderCache.keys()) {
			if (!neededIndices.has(cachedIndex)) {
				chunkRenderCache.delete(cachedIndex);
			}
		}

		return chunks;
	});

	// Helper function to calculate annotation stacking positions
	function calculateAnnotationStacks(
		annotations: Annotation[],
		chunkBounds: ChunkBounds
	): Array<Annotation & { stackPosition: number }> {
		if (annotations.length <= 1) {
			return annotations.map((annotation) => ({ ...annotation, stackPosition: 0 }));
		}

		// Sort annotations by start time
		const sortedAnnotations: Annotation[] = [...annotations].sort(
			(a, b) => a.startTimeMs - b.startTimeMs
		);
		const annotationsWithStacks: Array<Annotation & { stackPosition: number }> = [];

		// Convert pixel collision width to time for point annotations
		const pointCollisionWidthMs =
			(50 / waveformConfig.width) * (chunkBounds.endTimeMs - chunkBounds.startTimeMs);

		for (const annotation of sortedAnnotations) {
			let stackPosition = 0;

			// Check for overlaps with previously placed annotations
			while (true) {
				const overlapping = annotationsWithStacks.some((placedAnnotation) => {
					// Check if they're at the same stack level and overlap in time
					if (placedAnnotation.stackPosition !== stackPosition) return false;

					// Determine effective collision bounds for both annotations
					const currentIsPoint =
						annotation.isPoint || annotation.startTimeMs === annotation.endTimeMs;
					const placedIsPoint =
						placedAnnotation.isPoint || placedAnnotation.startTimeMs === placedAnnotation.endTimeMs;

					let currentStart = annotation.startTimeMs;
					let currentEnd = annotation.endTimeMs;
					let placedStart = placedAnnotation.startTimeMs;
					let placedEnd = placedAnnotation.endTimeMs;

					// Expand collision bounds for point annotations
					if (currentIsPoint) {
						const halfCollision = pointCollisionWidthMs / 2;
						currentStart = annotation.startTimeMs - halfCollision;
						currentEnd = annotation.startTimeMs + halfCollision;
					}

					if (placedIsPoint) {
						const halfCollision = pointCollisionWidthMs / 2;
						placedStart = placedAnnotation.startTimeMs - halfCollision;
						placedEnd = placedAnnotation.startTimeMs + halfCollision;
					}

					// Check time overlap with collision bounds
					const timeOverlap = currentStart < placedEnd && currentEnd > placedStart;

					return timeOverlap;
				});

				if (!overlapping) {
					break;
				}

				stackPosition++;
			}

			annotationsWithStacks.push({ ...annotation, stackPosition });
		}

		return annotationsWithStacks;
	}

	// Lightweight computation: combine raw data with annotations and dynamic state
	const chunkData = $derived.by(() => {
		if (rawChunkData.length === 0) return [];

		return rawChunkData.map((rawChunk) => {
			// Only process annotations for visible chunks
			let stackedAnnotations: Array<Annotation & { stackPosition: number }> = [];

			if (rawChunk.shouldRenderContent) {
				// Calculate chunk annotations (lightweight)
				const chunkAnnotations = annotations.filter(
					(annotation) =>
						annotation.startTimeMs < rawChunk.bounds.endTimeMs &&
						annotation.endTimeMs > rawChunk.bounds.startTimeMs
				);

				// Calculate stacking positions for overlapping annotations
				stackedAnnotations = calculateAnnotationStacks(chunkAnnotations, rawChunk.bounds);
			}

			// Calculate placeholder visibility for this chunk (lightweight)
			// Use <= and >= to handle point annotations at chunk boundaries
			const placeholderVisible =
				showPlaceholder &&
				placeholderStartTimeMs <= rawChunk.bounds.endTimeMs &&
				placeholderEndTimeMs >= rawChunk.bounds.startTimeMs;

			let placeholderAnnotation = null;
			if (placeholderVisible) {
				placeholderAnnotation = {
					id: 'placeholder',
					startTimeMs: placeholderStartTimeMs,
					endTimeMs: placeholderEndTimeMs,
					label:
						placeholderStartTimeMs === placeholderEndTimeMs ? 'Point annotation' : 'New annotation',
					color: '#ff5500',
					isPoint: placeholderStartTimeMs === placeholderEndTimeMs,
					stackPosition: 0 // Placeholder always goes at bottom
				};
			}

			return {
				...rawChunk,
				annotations: stackedAnnotations,
				placeholderAnnotation,
				isLooping: loopingChunkIndices.has(rawChunk.index)
			};
		});
	});

	// Helper function to check if chunk should be rendered (uses virtual window)
	function isChunkInRenderRange(chunkIndex: number): boolean {
		return visibleChunkIndices.has(chunkIndex);
	}

	// Scroll to a specific chunk by index (works even for virtualized-out chunks)
	function scrollToChunk(chunkIndex: number) {
		if (!scrollContainer || chunkMetadata.length === 0) return;
		// Find the metadata index for this chunkIndex
		const metaIndex = chunkMetadata.findIndex((m) => m.index === chunkIndex);
		if (metaIndex < 0) return;
		const targetTop = metaIndex * chunkHeight;
		const centered = targetTop - viewportHeight / 2 + chunkHeight / 2;
		scrollContainer.scrollTo({ top: Math.max(0, centered), behavior: 'smooth' });
	}

	// Register scroll function with parent
	$effect(() => {
		registerScrollToChunk?.(scrollToChunk);
	});

	// Initialize audio data when AudioEngine changes
	let isInitializing = $state(false);
	let lastAudioEngineId = $state<AudioEngine | null>(null);
	$effect(() => {
		// Only initialize if audioEngine actually changed (not just on every reactive update)
		if (audioEngine && audioEngine !== lastAudioEngineId && !isInitializing) {
			isInitializing = true;
			lastAudioEngineId = audioEngine;
			try {
				initializeFromAudioEngine();
			} finally {
				isInitializing = false;
			}
		}
	});

	// Sync stem enabled state and colors from session when they change
	$effect(() => {
		if (isStemMode && currentSession?.mode === 'stem' && currentSession.stems) {
			stemEnabled = currentSession.stems.map((stem) => stem.enabled);
			stemColors = currentSession.stems.map((stem) => stem.color || '#3b82f6');
		}
	});

	// Initialize playhead animator (only when audio is initialized)
	$effect(() => {
		const shouldInit = isInitialized && audioDuration > 0 && audioEngine;

		if (shouldInit && !playheadAnimator) {
			const computePos = (time: number) => {
				return computePlayheadPosition(
					time,
					chunkDuration,
					containerWidth,
					beatOffset,
					audioDuration
				);
			};

			const animator = new PlayheadAnimator(
				() => audioEngine.getCurrentTime(),
				computePos,
				() => audioEngine.tick()
			);

			playheadAnimator = animator;

			// Apply all pending registrations that happened before animator was ready
			for (const [chunkIndex, { canvas }] of pendingRegistrations.entries()) {
				animator.registerChunkLayer(chunkIndex, canvas);
			}
			pendingRegistrations.clear();

			// Sync immediately after creation - this will update any already-registered layers
			// New layers will also sync when they register
			requestAnimationFrame(() => {
				if (playheadAnimator === animator) {
					animator.syncToTime(audioEngine.getCurrentTime());
				}
			});
		} else if (!shouldInit && playheadAnimator) {
			playheadAnimator.dispose();
			playheadAnimator = null;
			// Clear pending registrations when animator is disposed
			pendingRegistrations.clear();
		}
	});

	// Keep PlayheadAnimator's beat lines in sync with config
	$effect(() => {
		if (playheadAnimator) {
			playheadAnimator.setBeatLines(generateBeatGrid(beatGrouping, containerWidth, rowHeight));
		}
	});

	// Sync animator when playing state changes
	$effect(() => {
		if (playheadAnimator) {
			playheadAnimator.setPlayingState(isPlaying);
		}
	});

	// Sync animator when time changes during pause/seek only.
	// During playback the rAF loop handles updates — no need to double-draw.
	let lastSyncedTime = $state(0);
	$effect(() => {
		if (playheadAnimator && !isPlaying && Math.abs(currentTime - lastSyncedTime) > 0.01) {
			playheadAnimator.syncToTime(currentTime);
			lastSyncedTime = currentTime;
		}
	});

	// Scroll handler with throttling (max 60Hz)
	function handleScroll() {
		if (!scrollContainer) return;

		scrollTop = scrollContainer.scrollTop;
		viewportHeight = scrollContainer.clientHeight;
	}

	// Throttled scroll handler using requestAnimationFrame
	function throttledScrollHandler() {
		if (rafId !== null) return; // Already scheduled

		rafId = requestAnimationFrame(() => {
			handleScroll();
			rafId = null;
		});
	}

	// Initialize scroll tracking and resize observation after component mounts
	onMount(() => {
		let resizeObserver: ResizeObserver | null = null;
		let resizeDebounceTimer: number | null = null;
		const RESIZE_DEBOUNCE_MS = 150; // Debounce resize events
		let scrollResizeHandler: (() => void) | null = null;

		// Wait for initial render to get container dimensions
		const initTimer = setTimeout(() => {
			// Initialize container width from waveformContainer
			if (waveformContainer) {
				containerWidthState = waveformContainer.offsetWidth || 800;

				// Set up ResizeObserver for waveform container
				resizeObserver = new ResizeObserver((entries) => {
					// Debounce resize updates
					if (resizeDebounceTimer !== null) {
						clearTimeout(resizeDebounceTimer);
					}

					resizeDebounceTimer = window.setTimeout(() => {
						if (waveformContainer) {
							const newWidth = waveformContainer.offsetWidth || 800;
							if (newWidth !== containerWidthState) {
								containerWidthState = newWidth;
							}
						}
					}, RESIZE_DEBOUNCE_MS);
				});

				resizeObserver.observe(waveformContainer);
			}

			if (scrollContainer) {
				// Initialize viewport dimensions
				scrollTop = scrollContainer.scrollTop;
				viewportHeight = scrollContainer.clientHeight;

				// Attach scroll listener with throttling
				scrollContainer.addEventListener('scroll', throttledScrollHandler, { passive: true });

				// Also handle resize to update viewport height
				scrollResizeHandler = () => {
					if (scrollContainer) {
						viewportHeight = scrollContainer.clientHeight;
					}
				};
				window.addEventListener('resize', scrollResizeHandler);
			}
		}, 100);

		return () => {
			clearTimeout(initTimer);
			if (resizeDebounceTimer !== null) {
				clearTimeout(resizeDebounceTimer);
			}
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
			if (scrollContainer && throttledScrollHandler) {
				scrollContainer.removeEventListener('scroll', throttledScrollHandler);
			}
			if (scrollResizeHandler) {
				window.removeEventListener('resize', scrollResizeHandler);
			}
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			playheadAnimator?.dispose();
		};
	});

	// Update beat grouping when beatsPerLine changes
	$effect(() => {
		beatGrouping = beatsPerLine;
	});

	// Update viewport height when scroll container becomes available
	$effect(() => {
		if (scrollContainer) {
			viewportHeight = scrollContainer.clientHeight;
		}
	});

	// Memoized active chunk index — returns a primitive number so Svelte skips
	// downstream updates when the playhead stays in the same chunk (~10Hz currentTime
	// changes but chunk boundary crossings are rare, maybe once every few seconds).
	// Actual playhead rendering is handled by PlayheadAnimator via rAF.
	const activeChunkIndex = $derived.by(() => {
		if (!isInitialized || audioDuration <= 0) return -2;
		const time = currentTime;
		if (beatOffset > 0) {
			return time < chunkDuration ? -1 : Math.floor((time - chunkDuration) / chunkDuration);
		} else if (beatOffset < 0) {
			const offsetInSeconds = Math.abs(beatOffset) / 1000;
			return time < offsetInSeconds ? -1 : Math.floor((time - offsetInSeconds) / chunkDuration);
		}
		return Math.floor(time / chunkDuration);
	});

	// Beat line flash is now handled by PlayheadAnimator on the overlay canvas via rAF.
	// No reactive derivation needed — eliminates ~10Hz full canvas redraws during playback.

	// Notify parent when annotation modal state changes
	$effect(() => {
		if (onAnnotationModalStateChange) {
			onAnnotationModalStateChange(showAnnotationPopup);
		}
	});

	function initializeFromAudioEngine() {
		console.time('initializeFromAudioEngine');
		try {
			// Check if we're in stem mode
			if (audioEngine.isInStemMode) {
				const stemBuffers = audioEngine.getStemBuffers();
				if (stemBuffers.length === 0) {
					console.error('No stem buffers available from AudioEngine');
					return;
				}

				console.time('extractPeaks');
				// Use first stem for canonical properties
				const firstBuffer = stemBuffers[0];
				audioSampleRate = firstBuffer.sampleRate;
				audioDuration = firstBuffer.duration;

				// Extract peaks data from all stems
				stemPeaksData = stemBuffers.map((buffer) => buffer.getChannelData(0));
				isStemMode = true;
				console.timeEnd('extractPeaks');

				// Get enabled state (default to all enabled if not available)
				stemEnabled = audioEngine.getStemsState();
				if (stemEnabled.length === 0) {
					stemEnabled = stemBuffers.map(() => true);
				}

				// Get colors from session if available, otherwise use defaults
				if (currentSession?.mode === 'stem' && currentSession.stems) {
					stemColors = currentSession.stems.map((stem) => stem.color || '#3b82f6');
					stemEnabled = currentSession.stems.map((stem) => stem.enabled);
				} else {
					const defaultColors = [
						'#3b82f6',
						'#ef4444',
						'#10b981',
						'#f59e0b',
						'#8b5cf6',
						'#ec4899',
						'#06b6d4',
						'#84cc16'
					];
					stemColors = stemBuffers.map((_, i) => defaultColors[i % defaultColors.length]);
					stemEnabled = stemBuffers.map(() => true);
				}

				// Also set peaksData to first stem for backward compatibility
				peaksData = stemPeaksData[0];
			} else {
				const audioBuffer = audioEngine.getAudioBuffer();
				if (!audioBuffer) {
					console.error('No audio buffer available from AudioEngine');
					return;
				}

				// Extract peaks data directly from AudioBuffer
				audioSampleRate = audioBuffer.sampleRate;
				audioDuration = audioBuffer.duration;
				peaksData = audioBuffer.getChannelData(0);
				isStemMode = false;
				stemPeaksData = [];
				stemColors = [];
				stemEnabled = [];
			}

			isInitialized = true;
			console.timeEnd('initializeFromAudioEngine');
		} catch (error) {
			console.error('Failed to initialize from AudioEngine:', error);
			console.timeEnd('initializeFromAudioEngine');
		}
	}

	function handleWaveformMouseDown(event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) {
		// Canvas element for waveform interaction
		const element = event.currentTarget as HTMLCanvasElement;
		const rect = element.getBoundingClientRect();
		const x = event.clientX - rect.left;

		// Convert pixel position to time (in milliseconds)
		const clickedTimeMs = pixelToTime(x, bounds, waveformConfig.width);

		// If annotation mode is off, seek to clicked position and return early
		if (!isAnnotationMode) {
			if (onSeek) {
				// Convert milliseconds to seconds for seek
				const clickedTimeSeconds = clickedTimeMs / 1000;
				onSeek(clickedTimeSeconds);
			}
			event.preventDefault();
			return;
		}

		// Annotation mode is on - start drag for annotation creation
		lastPointerClientX = event.clientX;
		lastPointerClientY = event.clientY;

		dragStartTimeMs = clickedTimeMs;
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

	function handleWaveformTouchStart(event: TouchEvent, chunkIndex: number, bounds: ChunkBounds) {
		if (event.touches.length === 0) return;
		const touch = event.touches[0];
		// Canvas element for waveform interaction
		const element = event.currentTarget as HTMLCanvasElement;
		const rect = element.getBoundingClientRect();
		const x = touch.clientX - rect.left;

		// Convert pixel position to time (in milliseconds)
		const clickedTimeMs = pixelToTime(x, bounds, waveformConfig.width);

		// Store touch start position and time for scroll detection
		touchStartX = touch.clientX;
		touchStartY = touch.clientY;
		touchStartTime = Date.now();
		isTouchDrag = false;

		// If annotation mode is off, track touch but don't seek yet (wait for touchend)
		if (!isAnnotationMode) {
			// Store the seek target for potential tap
			dragStartTimeMs = clickedTimeMs;
			dragStartChunk = chunkIndex;

			// Add global touch handlers to detect if this is a scroll or tap
			document.addEventListener('touchmove', handleNonAnnotationTouchMove, { passive: true });
			document.addEventListener('touchend', handleNonAnnotationTouchEnd, { passive: true });
			document.addEventListener('touchcancel', handleNonAnnotationTouchEnd, { passive: true });

			// Don't preventDefault - allow scrolling
			return;
		}

		// Annotation mode is on - start drag for annotation creation
		lastPointerClientX = touch.clientX;
		lastPointerClientY = touch.clientY;

		dragStartTimeMs = clickedTimeMs;
		dragEndTimeMs = dragStartTimeMs;
		dragStartChunk = chunkIndex;
		dragCurrentChunk = chunkIndex;
		isDragging = true;

		// Show initial placeholder for point annotation
		showPlaceholder = true;
		placeholderStartTimeMs = dragStartTimeMs;
		placeholderEndTimeMs = dragStartTimeMs;

		// Add global touch handlers
		document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
		document.addEventListener('touchend', handleGlobalTouchEnd);
		document.addEventListener('touchcancel', handleGlobalTouchEnd);

		event.preventDefault();
	}

	function handleNonAnnotationTouchMove(event: TouchEvent) {
		if (event.touches.length === 0) return;
		const touch = event.touches[0];

		// Check if touch has moved significantly (indicating a scroll)
		const deltaX = Math.abs(touch.clientX - touchStartX);
		const deltaY = Math.abs(touch.clientY - touchStartY);

		// If moved more than threshold, consider it a scroll
		if (deltaX > TOUCH_MOVE_THRESHOLD || deltaY > TOUCH_MOVE_THRESHOLD) {
			isTouchDrag = true;
		}
	}

	function handleNonAnnotationTouchEnd(event: TouchEvent) {
		// Remove listeners
		document.removeEventListener('touchmove', handleNonAnnotationTouchMove);
		document.removeEventListener('touchend', handleNonAnnotationTouchEnd);
		document.removeEventListener('touchcancel', handleNonAnnotationTouchEnd);

		// Only seek if this was a tap (not a scroll)
		if (!isTouchDrag && onSeek) {
			const clickedTimeSeconds = dragStartTimeMs / 1000;
			onSeek(clickedTimeSeconds);
		}

		// Reset state
		isTouchDrag = false;
	}

	function handleGlobalMouseMove(event: MouseEvent) {
		if (!isDragging) return;

		// Find which chunk we're over
		const chunkElement = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest('[data-chunk-index]');
		if (chunkElement) {
			const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index') || '0');
			// Look for canvas element
			const canvas = chunkElement.querySelector('canvas');
			const waveformElement = canvas;
			if (waveformElement) {
				const rect = waveformElement.getBoundingClientRect();
				const x = event.clientX - rect.left;
				const bounds = calculateChunkBounds(chunkIndex, waveformConfig);

				dragEndTimeMs = pixelToTime(x, bounds, waveformConfig.width);
				dragCurrentChunk = chunkIndex;
				lastPointerClientX = event.clientX;
				lastPointerClientY = event.clientY;

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

		// Finalize placeholder times to match what will be shown in popup
		annotationStartTimeMs = Math.min(dragStartTimeMs, dragEndTimeMs);
		annotationEndTimeMs = isPoint
			? annotationStartTimeMs
			: Math.max(dragStartTimeMs, dragEndTimeMs);
		placeholderStartTimeMs = annotationStartTimeMs;
		placeholderEndTimeMs = annotationEndTimeMs;
		// Keep placeholder visible while popup is open - it will be cleared on save/cancel

		// Show annotation creation popup
		showAnnotationPopup = true;
		popupX = event.clientX;
		popupY = event.clientY;
		editingAnnotation = null;
	}

	function handleGlobalTouchMove(event: TouchEvent) {
		if (!isDragging) return;
		if (event.touches.length === 0) return;
		const touch = event.touches[0];

		// Find which chunk we're over
		const chunkElement = document
			.elementFromPoint(touch.clientX, touch.clientY)
			?.closest('[data-chunk-index]');
		if (chunkElement) {
			const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index') || '0');
			// Look for canvas element
			const canvas = chunkElement.querySelector('canvas');
			const waveformElement = canvas;
			if (waveformElement) {
				const rect = waveformElement.getBoundingClientRect();
				const x = touch.clientX - rect.left;
				const bounds = calculateChunkBounds(chunkIndex, waveformConfig);

				dragEndTimeMs = pixelToTime(x, bounds, waveformConfig.width);
				dragCurrentChunk = chunkIndex;
				lastPointerClientX = touch.clientX;
				lastPointerClientY = touch.clientY;

				// Update placeholder annotation
				showPlaceholder = true;
				placeholderStartTimeMs = Math.min(dragStartTimeMs, dragEndTimeMs);
				placeholderEndTimeMs = Math.max(dragStartTimeMs, dragEndTimeMs);
			}
		}

		event.preventDefault();
	}

	function handleGlobalTouchEnd(event: TouchEvent) {
		if (!isDragging) return;

		isDragging = false;
		document.removeEventListener('touchmove', handleGlobalTouchMove);
		document.removeEventListener('touchend', handleGlobalTouchEnd);
		document.removeEventListener('touchcancel', handleGlobalTouchEnd);

		// Determine if this was a tap or drag
		const timeDiff = Math.abs(dragEndTimeMs - dragStartTimeMs);
		const isPoint = timeDiff < 50; // Less than 50ms = point annotation

		// Finalize placeholder times to match what will be shown in popup
		annotationStartTimeMs = Math.min(dragStartTimeMs, dragEndTimeMs);
		annotationEndTimeMs = isPoint
			? annotationStartTimeMs
			: Math.max(dragStartTimeMs, dragEndTimeMs);
		placeholderStartTimeMs = annotationStartTimeMs;
		placeholderEndTimeMs = annotationEndTimeMs;
		// Keep placeholder visible while popup is open - it will be cleared on save/cancel

		// Use last known touch position for popup
		showAnnotationPopup = true;
		const touch = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null;
		popupX = touch ? touch.clientX : lastPointerClientX;
		popupY = touch ? touch.clientY : lastPointerClientY;
		editingAnnotation = null;
	}

	function toggleChunkLoop(
		chunkIndex: number,
		startTime: number,
		endTime: number,
		shiftKey: boolean
	) {
		console.log('Toggle chunk loop:', { chunkIndex, startTime, endTime, chunkDuration, shiftKey });
		// Always call onChunkLoop for individual chunk toggling - it handles both add and remove
		onChunkLoop?.(chunkIndex, startTime, endTime, shiftKey);
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

	function handleMoveAnnotation(
		annotationId: string,
		newStartTimeMs: number,
		newEndTimeMs: number
	) {
		onAnnotationUpdated?.(annotationId, {
			startTimeMs: newStartTimeMs,
			endTimeMs: newEndTimeMs
		});
	}

	// Cross-row annotation drag handlers
	function handleAnnotationDragStart(
		annotationId: string,
		annotation: Annotation,
		chunkIndex: number,
		clientX: number,
		clientY: number,
		isCopy: boolean = false
	) {
		isDraggingAnnotation = true;
		draggingAnnotationId = annotationId;
		dragAnnotationSourceChunk = chunkIndex;
		dragAnnotationOriginalTimes = {
			startTimeMs: annotation.startTimeMs,
			endTimeMs: annotation.endTimeMs
		};
		dragAnnotationDuration = annotation.endTimeMs - annotation.startTimeMs;
		dragAnnotationCurrentChunk = chunkIndex;
		dragAnnotationPreviewTimeMs = annotation.startTimeMs;
		isDragCopyOperation = isCopy;
		dragAnnotationLabel = annotation.label || '';
		dragAnnotationColor = annotation.color || '#ff5500';
		lastPointerClientX = clientX;
		lastPointerClientY = clientY;

		// Add global mouse handlers
		document.addEventListener('mousemove', handleAnnotationDragMove);
		document.addEventListener('mouseup', handleAnnotationDragEnd);
		document.addEventListener('touchmove', handleAnnotationDragTouchMove, { passive: false });
		document.addEventListener('touchend', handleAnnotationDragTouchEnd);
		document.addEventListener('touchcancel', handleAnnotationDragTouchEnd);
	}

	function handleAnnotationDragMove(event: MouseEvent) {
		if (!isDraggingAnnotation) return;

		// Find which chunk we're over using elementFromPoint
		const chunkElement = document
			.elementFromPoint(event.clientX, event.clientY)
			?.closest('[data-chunk-index]');

		if (chunkElement) {
			const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index') || '0');
			const canvas = chunkElement.querySelector('canvas');

			if (canvas) {
				const rect = canvas.getBoundingClientRect();
				const x = event.clientX - rect.left;
				const bounds = calculateChunkBounds(chunkIndex, waveformConfig);

				// Calculate new start time based on mouse position
				const newStartTimeMs = pixelToTime(x, bounds, waveformConfig.width);
				// Snap to 25ms
				const snappedStartTime = Math.round(newStartTimeMs / 25) * 25;

				dragAnnotationCurrentChunk = chunkIndex;
				dragAnnotationPreviewTimeMs = Math.max(0, snappedStartTime);
			}
		}

		lastPointerClientX = event.clientX;
		lastPointerClientY = event.clientY;
	}

	function handleAnnotationDragTouchMove(event: TouchEvent) {
		if (!isDraggingAnnotation) return;
		if (event.touches.length === 0) return;

		const touch = event.touches[0];

		// Find which chunk we're over
		const chunkElement = document
			.elementFromPoint(touch.clientX, touch.clientY)
			?.closest('[data-chunk-index]');

		if (chunkElement) {
			const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index') || '0');
			const canvas = chunkElement.querySelector('canvas');

			if (canvas) {
				const rect = canvas.getBoundingClientRect();
				const x = touch.clientX - rect.left;
				const bounds = calculateChunkBounds(chunkIndex, waveformConfig);

				const newStartTimeMs = pixelToTime(x, bounds, waveformConfig.width);
				const snappedStartTime = Math.round(newStartTimeMs / 25) * 25;

				dragAnnotationCurrentChunk = chunkIndex;
				dragAnnotationPreviewTimeMs = Math.max(0, snappedStartTime);
			}
		}

		lastPointerClientX = touch.clientX;
		lastPointerClientY = touch.clientY;
		event.preventDefault();
	}

	function handleAnnotationDragEnd() {
		if (!isDraggingAnnotation || !draggingAnnotationId || dragAnnotationPreviewTimeMs === null) {
			cleanupAnnotationDrag();
			return;
		}

		const newStartTimeMs = dragAnnotationPreviewTimeMs;
		const newEndTimeMs = newStartTimeMs + dragAnnotationDuration;
		const isPoint = dragAnnotationDuration === 0;

		if (isDragCopyOperation) {
			// Create a copy at the new position
			onAnnotationCreated?.(
				newStartTimeMs,
				newEndTimeMs,
				dragAnnotationLabel,
				dragAnnotationColor,
				isPoint
			);
		} else {
			// Move the existing annotation
			onAnnotationUpdated?.(draggingAnnotationId, {
				startTimeMs: newStartTimeMs,
				endTimeMs: newEndTimeMs
			});
		}

		cleanupAnnotationDrag();
	}

	function handleAnnotationDragTouchEnd() {
		handleAnnotationDragEnd();
	}

	function cleanupAnnotationDrag() {
		isDraggingAnnotation = false;
		draggingAnnotationId = null;
		dragAnnotationSourceChunk = null;
		dragAnnotationOriginalTimes = null;
		dragAnnotationPreviewTimeMs = null;
		dragAnnotationCurrentChunk = null;
		dragAnnotationDuration = 0;
		isDragCopyOperation = false;
		dragAnnotationLabel = '';
		dragAnnotationColor = '#ff5500';

		document.removeEventListener('mousemove', handleAnnotationDragMove);
		document.removeEventListener('mouseup', handleAnnotationDragEnd);
		document.removeEventListener('touchmove', handleAnnotationDragTouchMove);
		document.removeEventListener('touchend', handleAnnotationDragTouchEnd);
		document.removeEventListener('touchcancel', handleAnnotationDragTouchEnd);
	}

	// Loop marker drag state
	let isDraggingLoopMarker = $state(false);
	let draggingMarkerChunkIndex = $state<number | null>(null);
	let draggingMarkerWhich = $state<'a' | 'b' | null>(null);

	function handleLoopMarkerDragStart(chunkIndex: number, which: 'a' | 'b', clientX: number) {
		isDraggingLoopMarker = true;
		draggingMarkerChunkIndex = chunkIndex;
		draggingMarkerWhich = which;

		document.addEventListener('mousemove', handleLoopMarkerDragMove);
		document.addEventListener('mouseup', handleLoopMarkerDragEnd);
		document.addEventListener('touchmove', handleLoopMarkerDragTouchMove, { passive: false });
		document.addEventListener('touchend', handleLoopMarkerDragTouchEnd);
		document.addEventListener('touchcancel', handleLoopMarkerDragTouchEnd);
	}

	function computeLoopMarkerFraction(clientX: number): number | null {
		if (draggingMarkerChunkIndex === null) return null;

		// Find the chunk element by data-chunk-index
		const chunkElements = document.querySelectorAll(
			`[data-chunk-index="${draggingMarkerChunkIndex}"]`
		);
		if (chunkElements.length === 0) return null;

		const chunkElement = chunkElements[0];
		const canvas = chunkElement.querySelector('canvas');
		if (!canvas) return null;

		const rect = canvas.getBoundingClientRect();
		const x = clientX - rect.left;
		const fraction = Math.max(0, Math.min(1, x / rect.width));
		return fraction;
	}

	function handleLoopMarkerDragMove(event: MouseEvent) {
		if (!isDraggingLoopMarker || draggingMarkerChunkIndex === null || draggingMarkerWhich === null)
			return;

		const fraction = computeLoopMarkerFraction(event.clientX);
		if (fraction !== null) {
			onLoopMarkerUpdate?.(draggingMarkerChunkIndex, draggingMarkerWhich, fraction);
		}
	}

	function handleLoopMarkerDragTouchMove(event: TouchEvent) {
		if (!isDraggingLoopMarker || event.touches.length === 0) return;
		event.preventDefault();

		const fraction = computeLoopMarkerFraction(event.touches[0].clientX);
		if (fraction !== null && draggingMarkerChunkIndex !== null && draggingMarkerWhich !== null) {
			onLoopMarkerUpdate?.(draggingMarkerChunkIndex, draggingMarkerWhich, fraction);
		}
	}

	function handleLoopMarkerDragEnd() {
		isDraggingLoopMarker = false;
		draggingMarkerChunkIndex = null;
		draggingMarkerWhich = null;

		document.removeEventListener('mousemove', handleLoopMarkerDragMove);
		document.removeEventListener('mouseup', handleLoopMarkerDragEnd);
		document.removeEventListener('touchmove', handleLoopMarkerDragTouchMove);
		document.removeEventListener('touchend', handleLoopMarkerDragTouchEnd);
		document.removeEventListener('touchcancel', handleLoopMarkerDragTouchEnd);
	}

	function handleLoopMarkerDragTouchEnd() {
		handleLoopMarkerDragEnd();
	}

	function handleDuplicateAnnotation(annotation: any) {
		// Calculate the duration of the annotation
		const duration = annotation.endTimeMs - annotation.startTimeMs;
		const isPoint = annotation.isPoint || duration === 0;

		// Position the duplicate immediately to the right
		// For point annotations, add a small offset (500ms)
		// For duration annotations, place it right after the original ends
		const offset = isPoint ? 200 : duration || 200;
		const newStartTimeMs = annotation.endTimeMs + offset;
		const newEndTimeMs = isPoint ? newStartTimeMs : newStartTimeMs + duration;

		// Create the duplicate with same label and color
		onAnnotationCreated?.(
			newStartTimeMs,
			newEndTimeMs,
			annotation.label,
			annotation.color,
			isPoint
		);
	}

	async function handleChunkExport(chunkIndex: number, startTime: number, endTime: number) {
		try {
			exportingChunks.add(chunkIndex);

			// Apply loop markers to narrow the export range if they exist
			const markers = getMarkerPosition(chunkIndex, loopMarkerPositions);
			const effectiveRange = getEffectiveRange(markers.markerA, markers.markerB);
			const narrowed = fractionRangeToTimeRange(effectiveRange, { startTime, endTime });
			startTime = narrowed.start;
			endTime = narrowed.end;

			// Generate meaningful filename
			const chunkName = chunkIndex === -1 ? 'pre-song' : `chunk_${chunkIndex}`;
			const exportFilename = `${filename}_${chunkName}.wav`;
			// Apply current BPM scaling (pitch shifts) using playbackRate
			const playbackRate = targetBPM / bpm;

			// Check if we're in stem mode
			if (audioEngine.isInStemMode) {
				debugger;
				// Stem mode: mix all enabled stems
				const stemBuffers = audioEngine.getStemBuffers();
				if (!stemBuffers || stemBuffers.length === 0) {
					alert('No stem buffers available for export');
					return;
				}

				// Get enabled state for each stem
				// Use stemEnabled array if available and matches length, otherwise default to all enabled
				const enabledFlags =
					stemEnabled.length === stemBuffers.length
						? [...stemEnabled]
						: stemBuffers.map(() => true);

				// Check if any stems are enabled
				if (!enabledFlags.some((enabled) => enabled)) {
					alert('No stems are enabled. Please enable at least one stem to export.');
					return;
				}

				await exportService.exportStemsChunkCombined(
					stemBuffers,
					enabledFlags,
					startTime,
					endTime,
					exportFilename,
					{ playbackRate }
				);
			} else {
				// Single track mode: use existing behavior
				const audioBuffer = audioEngine.getAudioBuffer();
				if (!audioBuffer) {
					alert('No audio data available for export');
					return;
				}

				await exportService.exportChunk(audioBuffer, startTime, endTime, exportFilename, {
					playbackRate
				});
			}
		} catch (error) {
			console.error('Failed to export chunk:', error);
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			alert(`Failed to export chunk: ${errorMessage}`);
		} finally {
			exportingChunks.delete(chunkIndex);
		}
	}
</script>

<div class="flex flex-col space-y-4">
	<!-- Info Bar -->
	<!-- <div class="bg-gray-800 rounded-lg p-4">
		<div class="mt-2 text-sm text-gray-400">
			<span>Duration: {effectiveDuration.toFixed(1)}s</span>
			<span class="mx-2">•</span>
			<span>Chunk Duration: {effectiveChunkDuration.toFixed(2)}s</span>
			<span class="mx-2">•</span>
			<span>Total Chunks: {totalChunks}</span>
			<span class="mx-2">•</span>
			<span>BPM: {targetBPM}</span>
			<span class="mx-2">•</span>
			<span>Offset: {beatOffset}ms</span>
      <span class="mx-2">•</span>
      <span>Current: {Math.floor(currentTime / chunkDuration) + 1} / {totalChunks}</span>
		</div>
	</div> -->

	<!-- Waveform Container with Virtualization -->
	<div bind:this={waveformContainer} class="relative w-full" style="min-height: 100vh;">
		<div
			bind:this={scrollContainer}
			class="scrollbar-hide w-full overflow-y-auto"
			style="height: 100vh; max-height: 100vh; overflow-anchor: none;"
		>
			<!-- Spacer for total height to maintain scrollbar - uses fixed height based on total chunks -->
			<div
				class="bg-gray-950"
				style="height: {chunkMetadata.length *
					chunkHeight}px; min-height: 100vh; position: relative;"
			>
				<!-- Visible chunks positioned with transform -->
				<div style="position: absolute; top: {virtualWindow.offsetTop}px; left: 0; right: 0;">
					<div class="flex flex-col gap-3">
						{#each chunkData.slice(virtualWindow.startIndex, virtualWindow.endIndex) as chunk (chunk.index)}
							{#if chunk.shouldRenderContent}
								<!-- Render full chunk with content -->
								<WaveformCanvasRow
									chunkIndex={chunk.index}
									bounds={chunk.bounds}
									isSpecialChunk={chunk.isSpecialChunk}
									waveformBars={chunk.waveformBars}
									waveformBarsPerStem={chunk.waveformBarsPerStem}
									stemColors={isStemMode ? stemColors : undefined}
									stemEnabled={isStemMode ? stemEnabled : undefined}
									beatLines={chunk.beatLines}
									headerInfo={chunk.headerInfo}
									startTime={chunk.startTime}
									endTime={chunk.endTime}
									annotations={chunk.annotations}
									placeholderAnnotation={chunk.placeholderAnnotation}
									isLooping={chunk.isLooping}
									loopMarkerPosition={chunk.isLooping
										? getMarkerPosition(chunk.index, loopMarkerPositions)
										: null}
									onLoopMarkerDragStart={handleLoopMarkerDragStart}
									hasActiveLoops={loopingChunkIndices.size > 0}
									isActiveChunk={activeChunkIndex === chunk.index}
									{waveformConfig}
									{chunkDuration}
									{beatOffset}
									exportingChunk={exportingChunks.has(chunk.index)}
									onWaveformMouseDown={handleWaveformMouseDown}
									onWaveformTouchStart={handleWaveformTouchStart}
									onChunkExport={handleChunkExport}
									onToggleChunkLoop={toggleChunkLoop}
									onEditAnnotation={handleEditAnnotation}
									onDeleteAnnotation={handleDeleteAnnotation}
									onMoveAnnotation={handleMoveAnnotation}
									onDuplicateAnnotation={handleDuplicateAnnotation}
									registerPlayheadLayer={createRegisterCallback(chunk.index)}
									unregisterPlayheadLayer={createUnregisterCallback(chunk.index)}
									{isAnnotationMode}
									{showBeatNumbers}
									beatsPerLine={beatGrouping}
									{onOpenTempoTrainer}
									onAnnotationDragStart={handleAnnotationDragStart}
									{isDraggingAnnotation}
									{draggingAnnotationId}
									{isDragCopyOperation}
									dragAnnotationPreviewStartTimeMs={dragAnnotationPreviewTimeMs}
									dragAnnotationPreviewEndTimeMs={dragAnnotationPreviewTimeMs !== null
										? dragAnnotationPreviewTimeMs + dragAnnotationDuration
										: null}
									isDragTarget={isDraggingAnnotation && dragAnnotationCurrentChunk === chunk.index}
									dragAnnotationColor={draggingAnnotationId
										? annotations.find((a) => a.id === draggingAnnotationId)?.color || '#ff5500'
										: '#ff5500'}
								/>
							{:else}
								<!-- Render placeholder for non-visible chunk -->
								<div
									class="relative mb-0 flex overflow-hidden bg-gray-900"
									data-chunk-index={chunk.index}
									style="height: {waveformConfig.height}px"
								>
									<div class="flex-1 bg-gray-900"></div>
									<div class="w-8 flex-shrink-0 bg-gray-800/60"></div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			</div>
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
	{editingAnnotation}
	on:save={handleAnnotationSave}
	on:cancel={handleAnnotationCancel}
/>
