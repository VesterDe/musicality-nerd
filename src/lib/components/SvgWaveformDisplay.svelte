<script lang="ts">
	import { onMount } from 'svelte';
	import AnnotationPopup from './AnnotationPopup.svelte';
	import SingleLineWaveformDisplay from './SingleLineWaveformDisplay.svelte';
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

	interface Props {
		currentTime: number;
		bpm: number;
		targetBPM: number;
		audioEngine: AudioEngine;
		beatOffset: number;
		beatsPerLine: number;
		isPlaying?: boolean;
		rectsPerBeatMode?: 'auto' | number;
		onChunkLoop?: (chunkIndex: number, startTime: number, endTime: number) => void;
		onClearLoop?: () => void;
		loopingChunkIndices?: Set<number>;
		onSeek?: (time: number) => void;
		onBeatsPerLineChange?: (value: number) => void;
		isAnnotationMode?: boolean;
		annotations?: Annotation[];
		onAnnotationCreated?: (startTimeMs: number, endTimeMs: number, label?: string, color?: string, isPoint?: boolean) => void;
		onAnnotationUpdated?: (id: string, updates: Partial<Annotation>) => void;
		onAnnotationDeleted?: (id: string) => void;
		onAnnotationModalStateChange?: (isOpen: boolean) => void;
		filename?: string;
		currentSession?: { mode?: 'single' | 'stem'; stems?: Array<{ enabled: boolean; color?: string }> } | null;
	}

	let { 
		currentTime = 0, 
		bpm = 120,
		targetBPM = 120,
		audioEngine,
		beatOffset = 0,
		beatsPerLine = 16,
		isPlaying = false,
		rectsPerBeatMode = 'auto',
		onChunkLoop,
		onClearLoop,
		loopingChunkIndices = new Set<number>(),
		onSeek,
		isAnnotationMode = false,
		annotations = [],
		onAnnotationCreated,
		onAnnotationUpdated,
		onAnnotationDeleted,
		onAnnotationModalStateChange,
		filename = 'audio',
		currentSession = null,
	}: Props = $props();

	// Component state
	let waveformContainer: HTMLDivElement | undefined = $state();
	let beatGrouping = $state(beatsPerLine);
	let isInitialized = $state(false);
	let peaksData: Float32Array | null = $state(null);
	let audioSampleRate = $state(44100);
	let audioDuration = $state(0);
	
	// Stem mode state
	let stemPeaksData: Float32Array[] = $state([]);
	let stemColors: string[] = $state([]);
	let stemEnabled: boolean[] = $state([]);
	let isStemMode = $state(false);
	
	// Virtualization state - scroll-based
	let scrollContainer: HTMLDivElement | undefined = $state();
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
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

	// Placeholder annotation state
	let showPlaceholder = $state(false);
	let placeholderStartTimeMs = $state(0);
	let placeholderEndTimeMs = $state(0);

	// Playhead animation state
	let playheadAnimator: PlayheadAnimator | null = $state(null);
	
	// Queue for registrations that happen before animator exists
	const pendingRegistrations = new Map<number, {
		line: SVGLineElement | null;
		topTriangle: HTMLElement | null;
		bottomTriangle: HTMLElement | null;
	}>();
	
	// Stable callback functions for playhead layer registration
	function createRegisterCallback(chunkIndex: number) {
		return (line: SVGLineElement | null, topTriangle: HTMLElement | null, bottomTriangle: HTMLElement | null) => {
			if (playheadAnimator) {
				playheadAnimator.registerChunkLayer(chunkIndex, line, topTriangle, bottomTriangle);
			} else {
				// Queue the registration for when animator is ready
				pendingRegistrations.set(chunkIndex, { line, topTriangle, bottomTriangle });
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
	 * Updates DOM directly without triggering Svelte reactivity
	 */
	class PlayheadAnimator {
		private rafId: number | null = null;
		private isRunning = false;
		private getCurrentTime: () => number;
		private computePosition: (time: number) => { chunkIndex: number; chunkContainerIndex: number; x: number } | null;
		private chunkLayers: Map<number, {
			line: SVGLineElement | null;
			topTriangle: HTMLElement | null;
			bottomTriangle: HTMLElement | null;
		}> = new Map();

		constructor(
			getCurrentTime: () => number,
			computePosition: (time: number) => { chunkIndex: number; chunkContainerIndex: number; x: number } | null
		) {
			this.getCurrentTime = getCurrentTime;
			this.computePosition = computePosition;
		}

		/**
		 * Register a playhead layer for a chunk
		 */
		registerChunkLayer(
			chunkIndex: number,
			line: SVGLineElement | null,
			topTriangle: HTMLElement | null,
			bottomTriangle: HTMLElement | null
		): void {
			this.chunkLayers.set(chunkIndex, { line, topTriangle, bottomTriangle });
			// Immediately sync position - this will show playhead on the correct chunk
			// Sync both immediately and in next frame to ensure it works
			const currentTime = this.getCurrentTime();
			this.updatePosition(currentTime);
			// Also sync in next frame in case DOM wasn't ready
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

			// Hide all playhead layers first
			for (const [index, layer] of this.chunkLayers.entries()) {
				if (layer.line) {
					layer.line.style.display = 'none';
				}
				if (layer.topTriangle) {
					layer.topTriangle.style.display = 'none';
				}
				if (layer.bottomTriangle) {
					layer.bottomTriangle.style.display = 'none';
				}
			}

			// Show and position playhead for the active chunk
			const activeLayer = this.chunkLayers.get(pos.chunkIndex);
			if (!activeLayer) {
				return;
			}

			const roundedX = Math.round(pos.x);
			
			if (activeLayer.line) {
				// SVG line: update x1 and x2 attributes directly
				activeLayer.line.setAttribute('x1', String(roundedX));
				activeLayer.line.setAttribute('x2', String(roundedX));
				activeLayer.line.style.display = 'block';
			}
			
			if (activeLayer.topTriangle) {
				activeLayer.topTriangle.style.display = 'block';
				activeLayer.topTriangle.style.left = `${roundedX - 4}px`;
			}
			
			if (activeLayer.bottomTriangle) {
				activeLayer.bottomTriangle.style.display = 'block';
				activeLayer.bottomTriangle.style.left = `${roundedX - 4}px`;
			}
		}

		/**
		 * Animation loop
		 */
		private animate = (): void => {
			if (!this.isRunning) return;
			
			const time = this.getCurrentTime();
			this.updatePosition(time);
			
			this.rafId = requestAnimationFrame(this.animate);
		};

		/**
		 * Set playing state (start/stop animation loop)
		 */
		setPlayingState(playing: boolean): void {
			if (playing === this.isRunning) return;
			
			this.isRunning = playing;
			
			if (playing) {
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

	// Get responsive container width  
	const containerWidth = $derived(waveformContainer?.offsetWidth || 800);

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

	const MAX_PER_BEAT = 128; // Guardrail to prevent DOM explosion
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
	
	const waveformConfig = $derived.by((): WaveformConfig => ({
		width: containerWidth,
		height: 120,
		sampleRate: audioSampleRate,
		audioDuration,
		beatOffset,
		chunkDuration
	}));

	// Virtualization: Calculate chunk height (waveform height + header height + spacing)
	const chunkHeight = $derived(waveformConfig.height + 40 + 8); // 40px header + 8px spacing (space-y-2)

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
	
	// Heavy computation: generate waveform data for visible chunks only
	const rawChunkData = $derived.by(() => {
		if ((!peaksData && !isStemMode) || (isStemMode && stemPeaksData.length === 0) || chunkMetadata.length === 0) return [];

		const startTime = performance.now();
		const chunks = [];
		let visibleChunkCount = 0;
		let stemBarGenerationCount = 0;
		
		// OPTIMIZATION: Only process chunks that are visible or in buffer zone
		// We still need metadata for all chunks for scrolling/virtualization, but we only
		// generate expensive waveform bars for visible chunks
		for (const meta of chunkMetadata) {
			// Check if chunk should be rendered (visible or in buffer zone)
			const shouldRenderContent = isChunkInRenderRange(meta.index);

			// Get annotations for this chunk (lightweight - we'll pass to bar generation)
			const chunkAnnotations = annotations.filter(annotation =>
				annotation.startTimeMs < meta.bounds.endTimeMs && annotation.endTimeMs > meta.bounds.startTimeMs
			);

			// Generate waveform data only for visible chunks
			let waveformBars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> = [];
			let waveformBarsPerStem: Array<Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }>> = [];
			let beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }> = [];
			let headerInfo = '';

			if (shouldRenderContent) {
				if (isStemMode && stemPeaksData.length > 0) {
					// Stem mode: generate bars for each stem
					if (meta.isSpecialChunk) {
						const offsetInSeconds = Math.abs(beatOffset) / 1000;
						headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;

						// Generate waveform bars for each stem
						waveformBarsPerStem = stemPeaksData.map((stemPeaks, stemIndex) => {
							stemBarGenerationCount++;
							return generateWaveformBars(
								stemPeaks,
								meta.bounds,
								waveformConfig.width,
								waveformConfig.height,
								targetBars,
								meta.index,
								beatOffset,
								chunkDuration,
								chunkAnnotations
							);
						});
					} else {
						// Generate beat grid
						beatLines = generateBeatGrid(beatGrouping, waveformConfig.width, waveformConfig.height);

						// Generate waveform bars for each stem
						waveformBarsPerStem = stemPeaksData.map((stemPeaks, stemIndex) => {
							stemBarGenerationCount++;
							return generateWaveformBars(
								stemPeaks,
								meta.bounds,
								waveformConfig.width,
								waveformConfig.height,
								targetBars,
								meta.index,
								beatOffset,
								chunkDuration,
								chunkAnnotations
							);
						});

						const startTime = meta.bounds.startTimeMs / 1000;
						const endTime = meta.bounds.endTimeMs / 1000;
						const startingBeat = meta.index * beatGrouping + 1;
						headerInfo = `Chunk ${meta.index + 1} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s) Beats ${startingBeat} - ${startingBeat + beatGrouping - 1}`;
					}
					// For backward compatibility, use first stem's bars
					waveformBars = waveformBarsPerStem[0] || [];
				} else {
					// Single track mode (existing logic)
					if (meta.isSpecialChunk) {
						const offsetInSeconds = Math.abs(beatOffset) / 1000;
						headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;

						// Generate waveform bars for special chunk (includes empty and song bars)
						waveformBars = generateWaveformBars(
							peaksData!,
							meta.bounds,
							waveformConfig.width,
							waveformConfig.height,
							targetBars,
							meta.index,
							beatOffset,
							chunkDuration,
							chunkAnnotations
						);
					} else {
						// Generate beat grid
						beatLines = generateBeatGrid(beatGrouping, waveformConfig.width, waveformConfig.height);

						// Generate waveform bars
						waveformBars = generateWaveformBars(
							peaksData!,
							meta.bounds,
							waveformConfig.width,
							waveformConfig.height,
							targetBars,
							meta.index,
							beatOffset,
							chunkDuration,
							chunkAnnotations
						);

						const startTime = meta.bounds.startTimeMs / 1000;
						const endTime = meta.bounds.endTimeMs / 1000;
						const startingBeat = meta.index * beatGrouping + 1;
						headerInfo = `Chunk ${meta.index + 1} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s) Beats ${startingBeat} - ${startingBeat + beatGrouping - 1}`;
					}
				}
			} else {
				// For non-visible chunks, create minimal header info
				if (meta.isSpecialChunk) {
					const offsetInSeconds = Math.abs(beatOffset) / 1000;
					headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;
				} else {
					const startTime = meta.bounds.startTimeMs / 1000;
					const endTime = meta.bounds.endTimeMs / 1000;
					const startingBeat = meta.index * beatGrouping + 1;
					headerInfo = `Chunk ${meta.index + 1} (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s) Beats ${startingBeat} - ${startingBeat + beatGrouping - 1}`;
				}
			}

			chunks.push({
				index: meta.index,
				bounds: meta.bounds,
				isSpecialChunk: meta.isSpecialChunk,
				waveformBars,
				waveformBarsPerStem: isStemMode && shouldRenderContent ? waveformBarsPerStem : undefined,
				beatLines,
				headerInfo,
				startTime: meta.startTime,
				endTime: meta.endTime,
				shouldRenderContent
			});
		}
		
		const endTime = performance.now();
		if (endTime - startTime > 50) {
			console.warn(`rawChunkData took ${(endTime - startTime).toFixed(2)}ms: ${chunkMetadata.length} total chunks, ${visibleChunkCount} visible, ${stemBarGenerationCount} stem bar generations`);
		}
		
		return chunks;
	});

	// Helper function to calculate annotation stacking positions
	function calculateAnnotationStacks(
		annotations: Annotation[],
		chunkBounds: ChunkBounds
	): Array<Annotation & { stackPosition: number }> {
		if (annotations.length <= 1) {
			return annotations.map(annotation => ({ ...annotation, stackPosition: 0 }));
		}
		
		// Sort annotations by start time
		const sortedAnnotations: Annotation[] = [...annotations].sort((a, b) => a.startTimeMs - b.startTimeMs);
		const annotationsWithStacks: Array<Annotation & { stackPosition: number }> = [];
		
		// Convert pixel collision width to time for point annotations
		const pointCollisionWidthMs = (50 / waveformConfig.width) * (chunkBounds.endTimeMs - chunkBounds.startTimeMs);
		
		for (const annotation of sortedAnnotations) {
			let stackPosition = 0;
			
			// Check for overlaps with previously placed annotations
			while (true) {
				const overlapping = annotationsWithStacks.some(placedAnnotation => {
					// Check if they're at the same stack level and overlap in time
					if (placedAnnotation.stackPosition !== stackPosition) return false;
					
					// Determine effective collision bounds for both annotations
					const currentIsPoint = annotation.isPoint || annotation.startTimeMs === annotation.endTimeMs;
					const placedIsPoint = placedAnnotation.isPoint || placedAnnotation.startTimeMs === placedAnnotation.endTimeMs;
					
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
		
		return rawChunkData.map(rawChunk => {
			// Only process annotations for visible chunks
			let stackedAnnotations: Array<Annotation & { stackPosition: number }> = [];
			
			if (rawChunk.shouldRenderContent) {
				// Calculate chunk annotations (lightweight)
				const chunkAnnotations = annotations.filter(annotation => 
					annotation.startTimeMs < rawChunk.bounds.endTimeMs && annotation.endTimeMs > rawChunk.bounds.startTimeMs
				);
				
				// Calculate stacking positions for overlapping annotations
				stackedAnnotations = calculateAnnotationStacks(chunkAnnotations, rawChunk.bounds);
			}
			
			// Calculate placeholder visibility for this chunk (lightweight)
			// Use <= and >= to handle point annotations at chunk boundaries
			const placeholderVisible = showPlaceholder && 
				placeholderStartTimeMs <= rawChunk.bounds.endTimeMs && placeholderEndTimeMs >= rawChunk.bounds.startTimeMs;
			
			let placeholderAnnotation = null;
			if (placeholderVisible) {
				placeholderAnnotation = {
					id: 'placeholder',
					startTimeMs: placeholderStartTimeMs,
					endTimeMs: placeholderEndTimeMs,
					label: placeholderStartTimeMs === placeholderEndTimeMs ? 'Point annotation' : 'New annotation',
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
			stemEnabled = currentSession.stems.map(stem => stem.enabled);
			stemColors = currentSession.stems.map(stem => stem.color || '#3b82f6');
		}
	});
	
	// Initialize playhead animator (only when audio is initialized)
	$effect(() => {
		const shouldInit = isInitialized && audioDuration > 0 && audioEngine;

		if (shouldInit && !playheadAnimator) {
			const computePos = (time: number) => {
				return computePlayheadPosition(time, chunkDuration, containerWidth, beatOffset, audioDuration);
			};

			const animator = new PlayheadAnimator(
				() => audioEngine.getCurrentTime(),
				computePos
			);

			playheadAnimator = animator;
			
			// Apply all pending registrations that happened before animator was ready
			for (const [chunkIndex, { line, topTriangle, bottomTriangle }] of pendingRegistrations.entries()) {
				animator.registerChunkLayer(chunkIndex, line, topTriangle, bottomTriangle);
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

	// Sync animator when playing state changes
	$effect(() => {
		if (playheadAnimator) {
			playheadAnimator.setPlayingState(isPlaying);
		}
	});

	// Sync animator when time changes (for seeks/pauses) - guard against infinite loops
	let lastSyncedTime = $state(0);
	$effect(() => {
		if (playheadAnimator && Math.abs(currentTime - lastSyncedTime) > 0.01) {
			// Sync when time changed significantly (both playing and paused)
			// When playing, rAF handles smooth updates, but we still sync here for seeks
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

	// Initialize scroll tracking after component mounts
	onMount(() => {
		// Wait for initial render to get container dimensions
		const initTimer = setTimeout(() => {
			if (scrollContainer) {
				// Initialize viewport dimensions
				scrollTop = scrollContainer.scrollTop;
				viewportHeight = scrollContainer.clientHeight;
				
				// Attach scroll listener with throttling
				scrollContainer.addEventListener('scroll', throttledScrollHandler, { passive: true });
				
				// Also handle resize to update viewport height
				const resizeHandler = () => {
					if (scrollContainer) {
						viewportHeight = scrollContainer.clientHeight;
					}
				};
				window.addEventListener('resize', resizeHandler);
				
				return () => {
					scrollContainer?.removeEventListener('scroll', throttledScrollHandler);
					window.removeEventListener('resize', resizeHandler);
					if (rafId !== null) {
						cancelAnimationFrame(rafId);
						rafId = null;
					}
				};
			}
		}, 100);
		
		return () => {
			clearTimeout(initTimer);
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



	// Calculate playhead position declaratively (for non-critical UI that still uses reactive values)
	// Note: Actual playhead rendering is handled by PlayheadAnimator via rAF
	const playheadInfo = $derived.by(() => {
		if (!isInitialized || audioDuration <= 0) return null;
		return computePlayheadPosition(currentTime, chunkDuration, containerWidth, beatOffset, audioDuration);
	});

	// Compute currently active bar index for the active chunk only
	const activeBarInfo = $derived.by(() => {
		if (!playheadInfo || !isInitialized || audioDuration <= 0) return null;
		const currentChunk = rawChunkData.find(chunk => chunk.index === playheadInfo.chunkIndex);
		if (!currentChunk) return null;
		const barCount = targetBars;
		const barWidth = containerWidth / barCount;
		const idx = Math.max(0, Math.min(barCount - 1, Math.floor(playheadInfo.x / barWidth)));
		return { chunkIndex: playheadInfo.chunkIndex, barIndex: idx };
	});

	// Compute flashing beat lines for the active chunk only
	const activeBeatLineIndices = $derived.by(() => {
		if (!isInitialized || audioDuration <= 0 || !playheadInfo) return new Set<number>();
		const indices = new Set<number>();
		const offsetInSeconds = beatOffset / 1000;
		const beatDuration = 60 / bpm;
		const flashDuration = 0.1; // 100ms window
		const gridTime = currentTime + offsetInSeconds;

		const chunkIndex = playheadInfo.chunkIndex;
		if (chunkIndex === undefined || chunkIndex === null) return indices;

		let chunkStartGridTime: number;
		if (chunkIndex === -1) {
			chunkStartGridTime = beatOffset < 0 ? -chunkDuration : 0;
		} else {
			chunkStartGridTime = chunkIndex * chunkDuration;
		}

		let lineIndex = 0;
		for (let i = 0.5; i < beatGrouping; i += 0.5) {
			const beatLineGridTime = chunkStartGridTime + (i * beatDuration);
			const timeDiff = Math.abs(gridTime - beatLineGridTime);
			if (timeDiff <= flashDuration / 2) {
				indices.add(lineIndex);
			}
			lineIndex++;
		}

		return indices;
	});


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
				stemPeaksData = stemBuffers.map(buffer => buffer.getChannelData(0));
				isStemMode = true;
				console.timeEnd('extractPeaks');
				
				// Get enabled state (default to all enabled if not available)
				stemEnabled = audioEngine.getStemsState();
				if (stemEnabled.length === 0) {
					stemEnabled = stemBuffers.map(() => true);
				}
				
				// Get colors from session if available, otherwise use defaults
				if (currentSession?.mode === 'stem' && currentSession.stems) {
					stemColors = currentSession.stems.map(stem => stem.color || '#3b82f6');
					stemEnabled = currentSession.stems.map(stem => stem.enabled);
				} else {
					const defaultColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
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
		const svg = event.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
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
		const svg = event.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
		const x = touch.clientX - rect.left;
		
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
		annotationEndTimeMs = isPoint ? annotationStartTimeMs : Math.max(dragStartTimeMs, dragEndTimeMs);
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
		const chunkElement = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-chunk-index]');
		if (chunkElement) {
			const chunkIndex = parseInt(chunkElement.getAttribute('data-chunk-index') || '0');
			const svg = chunkElement.querySelector('svg');
			if (svg) {
				const rect = (svg as SVGElement).getBoundingClientRect();
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
		annotationEndTimeMs = isPoint ? annotationStartTimeMs : Math.max(dragStartTimeMs, dragEndTimeMs);
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

	function toggleChunkLoop(chunkIndex: number, startTime: number, endTime: number) {
		console.log('Toggle chunk loop:', { chunkIndex, startTime, endTime, chunkDuration });
		// Always call onChunkLoop for individual chunk toggling - it handles both add and remove
		onChunkLoop?.(chunkIndex, startTime, endTime);
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

	function handleMoveAnnotation(annotationId: string, newStartTimeMs: number, newEndTimeMs: number) {
		onAnnotationUpdated?.(annotationId, { 
			startTimeMs: newStartTimeMs, 
			endTimeMs: newEndTimeMs 
		});
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
		onAnnotationCreated?.(newStartTimeMs, newEndTimeMs, annotation.label, annotation.color, isPoint);
	}

	async function handleChunkExport(chunkIndex: number, startTime: number, endTime: number) {
		const audioBuffer = audioEngine.getAudioBuffer();
		if (!audioBuffer) {
			alert('No audio data available for export');
			return;
		}

		try {
			exportingChunks.add(chunkIndex);
			
			// Generate meaningful filename
			const chunkName = chunkIndex === -1 ? 'pre-song' : `chunk_${chunkIndex}`;
			const exportFilename = `${filename}_${chunkName}.wav`;
			// Apply current BPM scaling (pitch shifts) using playbackRate
			const playbackRate = targetBPM / bpm;
			await exportService.exportChunk(audioBuffer, startTime, endTime, exportFilename, { playbackRate });
		} catch (error) {
			console.error('Failed to export chunk:', error);
			alert('Failed to export chunk. Please try again.');
		} finally {
			exportingChunks.delete(chunkIndex);
		}
	}

	async function handleGroupExport() {
		const audioBuffer = audioEngine.getAudioBuffer();
		if (!audioBuffer || loopingChunkIndices.size === 0) {
			alert('No audio data or looping chunks available for export');
			return;
		}

		try {
			// Convert looping chunk indices to chunk data with timing
			const chunks = Array.from(loopingChunkIndices).map(chunkIndex => {
				const beatsPerChunk = beatGrouping;
				const chunkDuration = beatsPerChunk * (60 / bpm);
				const offsetInSeconds = beatOffset / 1000;
				
				let chunkStartTime: number;
				let chunkEndTime: number;
				
				if (chunkIndex === -1) {
					// Special chunk -1 handling
					if (beatOffset > 0) {
						chunkStartTime = 0;
						chunkEndTime = chunkDuration - offsetInSeconds;
					} else if (beatOffset < 0) {
						chunkStartTime = 0;
						chunkEndTime = Math.abs(offsetInSeconds);
					} else {
						chunkStartTime = 0;
						chunkEndTime = chunkDuration;
					}
				} else {
					// Regular chunks - use same logic as in main page
					if (beatOffset > 0) {
						chunkStartTime = chunkDuration - offsetInSeconds + chunkIndex * chunkDuration;
						chunkEndTime = chunkDuration - offsetInSeconds + (chunkIndex + 1) * chunkDuration;
					} else if (beatOffset < 0) {
						chunkStartTime = chunkIndex * chunkDuration + Math.abs(offsetInSeconds);
						chunkEndTime = (chunkIndex + 1) * chunkDuration + Math.abs(offsetInSeconds);
					} else {
						chunkStartTime = chunkIndex * chunkDuration;
						chunkEndTime = (chunkIndex + 1) * chunkDuration;
					}
				}
				
				return {
					startTime: Math.max(0, chunkStartTime),
					endTime: Math.min(chunkEndTime, audioDuration),
					index: chunkIndex
				};
			});
			
			// Generate filename for chunk range
			const sortedIndices = Array.from(loopingChunkIndices).sort((a, b) => a - b);
			const rangeStr = sortedIndices.length === 1 
				? `chunk_${sortedIndices[0] === -1 ? 'pre-song' : sortedIndices[0]}`
				: `chunks_${sortedIndices[0] === -1 ? 'pre-song' : sortedIndices[0]}-${sortedIndices[sortedIndices.length - 1]}`;
			const exportFilename = `${filename}_${rangeStr}.wav`;
			
			// Apply current BPM scaling (pitch shifts) using playbackRate to the combined buffer
			const playbackRate = targetBPM / bpm;
			await exportService.exportChunkGroup(audioBuffer, chunks, exportFilename, { playbackRate });
		} catch (error) {
			console.error('Failed to export chunk group:', error);
			alert('Failed to export chunk group. Please try again.');
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
	<div bind:this={waveformContainer} class="relative w-full">
		<div 
			bind:this={scrollContainer}
			class="overflow-y-auto w-full"
			style="height: 100vh; max-height: 100vh;"
		>
			<!-- Spacer for total height to maintain scrollbar -->
			<div style="height: {chunkMetadata.length * chunkHeight}px; position: relative;">
				<!-- Visible chunks positioned with transform -->
				<div style="position: absolute; top: {virtualWindow.offsetTop}px; left: 0; right: 0;">
					<div class="space-y-2">
						{#each chunkData.slice(virtualWindow.startIndex, virtualWindow.endIndex) as chunk (chunk.index)}
							{#if chunk.shouldRenderContent}
								<!-- Render full chunk with content -->
								<SingleLineWaveformDisplay
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
									isActiveChunk={playheadInfo?.chunkIndex === chunk.index}
									activeBarIndex={playheadInfo?.chunkIndex === chunk.index && activeBarInfo ? activeBarInfo.barIndex : -1}
									activeBeatLineIndices={playheadInfo?.chunkIndex === chunk.index ? activeBeatLineIndices : undefined}
									playheadVisible={playheadInfo?.chunkIndex === chunk.index}
									playheadX={playheadInfo?.chunkIndex === chunk.index ? playheadInfo.x : 0}
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
									onGroupExport={handleGroupExport}
									showGroupExportButton={loopingChunkIndices.size > 1 && chunk.isLooping && Array.from(loopingChunkIndices).sort((a, b) => a - b)[0] === chunk.index}
									loopingChunkCount={loopingChunkIndices.size}
									registerPlayheadLayer={createRegisterCallback(chunk.index)}
									unregisterPlayheadLayer={createUnregisterCallback(chunk.index)}
								/>
							{:else}
								<!-- Render placeholder for non-visible chunk (shouldn't happen with virtualization, but kept for safety) -->
								<div 
									class="relative mb-0 bg-gray-900 rounded-lg overflow-hidden" 
									data-chunk-index={chunk.index}
									style="height: {waveformConfig.height + 40}px"
								>
									<!-- Minimal header -->
									<div class="px-3 py-2 bg-gray-800 text-sm text-gray-300 flex items-center justify-between">
										<div>{chunk.headerInfo}</div>
										<div class="text-xs text-gray-500">Loading...</div>
									</div>
									<!-- Empty space for waveform -->
									<div class="bg-gray-900" style="height: {waveformConfig.height}px"></div>
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
	editingAnnotation={editingAnnotation}
	on:save={handleAnnotationSave}
	on:cancel={handleAnnotationCancel}
/>

<style>
	/* Custom styles for the SVG waveform */
	:global(svg) {
		user-select: none;
	}

	/* Beat marker active state with smooth transitions */
	:global(.beat-active) {
		transition: stroke 0.05s ease-out, stroke-width 0.05s ease-out, filter 0.05s ease-out;
		animation: beatFlash 0.1s ease-out;
	}

	/* Quick flash animation for beat markers as playhead crosses them */
	@keyframes beatFlash {
		0% {
			opacity: 1;
			stroke-width: 3;
		}
		50% {
			opacity: 0.8;
			stroke-width: 4;
		}
		100% {
			opacity: 1;
			stroke-width: 3;
		}
	}
</style>