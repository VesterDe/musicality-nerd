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
		filename?: string;
	}

	let { 
		currentTime = 0, 
		bpm = 120,
		targetBPM = 120,
		audioEngine,
		beatOffset = 0,
		beatsPerLine = 16,
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
		filename = 'audio',
	}: Props = $props();

	// Component state
	let waveformContainer: HTMLDivElement | undefined = $state();
	let beatGrouping = $state(beatsPerLine);
	let isInitialized = $state(false);
	let peaksData: Float32Array | null = $state(null);
	let audioSampleRate = $state(44100);
	let audioDuration = $state(0);
	
	// Virtualization state
	let visibleChunkIndices = $state(new Set<number>());
	let chunkObserver: IntersectionObserver | null = $state(null);
	const BUFFER_CHUNKS = 2; // Number of chunks to render outside viewport

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

	// Compute target bars dynamically to limit DOM nodes while preserving detail
	const targetBars = $derived.by(() => {
		const barsPerTwoPixels = Math.floor(containerWidth / 2);
		return Math.max(120, Math.min(360, barsPerTwoPixels));
	});
	
	const waveformConfig = $derived.by((): WaveformConfig => ({
		width: containerWidth,
		height: 120,
		sampleRate: audioSampleRate,
		audioDuration,
		beatOffset,
		chunkDuration
	}));
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
	
	// Heavy computation: generate waveform data for visible chunks only
	const rawChunkData = $derived.by(() => {
		if (!peaksData || chunkMetadata.length === 0) return [];

		const chunks = [];
		for (const meta of chunkMetadata) {
			// Check if chunk should be rendered (visible or in buffer zone)
			const shouldRenderContent = isChunkInRenderRange(meta.index);

			// Get annotations for this chunk (lightweight - we'll pass to bar generation)
			const chunkAnnotations = annotations.filter(annotation =>
				annotation.startTimeMs < meta.bounds.endTimeMs && annotation.endTimeMs > meta.bounds.startTimeMs
			);

			// Generate waveform data only for visible chunks
			let waveformBars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }> = [];
			let beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }> = [];
			let headerInfo = '';

			if (shouldRenderContent) {
				if (meta.isSpecialChunk) {
					// Special chunk -1 handling
					const offsetInSeconds = Math.abs(beatOffset) / 1000;
					headerInfo = `Pre-song (0s - ${chunkDuration.toFixed(1)}s, Song starts at ${offsetInSeconds.toFixed(3)}s)`;

					// Generate waveform bars for special chunk (includes empty and song bars)
						waveformBars = generateWaveformBars(
						peaksData,
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
						peaksData,
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
				beatLines,
				headerInfo,
				startTime: meta.startTime,
				endTime: meta.endTime,
				shouldRenderContent
			});
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
			const placeholderVisible = showPlaceholder && 
				placeholderStartTimeMs < rawChunk.bounds.endTimeMs && placeholderEndTimeMs > rawChunk.bounds.startTimeMs;
			
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

	// Helper function to check if chunk should be rendered
	function isChunkInRenderRange(chunkIndex: number): boolean {
		if (visibleChunkIndices.size === 0) {
			// Initially render first few chunks
			return chunkIndex >= -1 && chunkIndex < 3;
		}
		
		// Check if chunk is visible or in buffer zone
		const minVisible = Math.min(...visibleChunkIndices);
		const maxVisible = Math.max(...visibleChunkIndices);
		
		return chunkIndex >= minVisible - BUFFER_CHUNKS && 
		       chunkIndex <= maxVisible + BUFFER_CHUNKS;
	}
	
	// Setup Intersection Observer for viewport detection
	function setupIntersectionObserver() {
		if (typeof window === 'undefined' || !waveformContainer) return;
		
		// Clean up existing observer
		if (chunkObserver) {
			chunkObserver.disconnect();
		}
		
		chunkObserver = new IntersectionObserver(
			(entries) => {
				const newVisibleIndices = new Set(visibleChunkIndices);
				
				entries.forEach(entry => {
					const chunkElement = entry.target as HTMLElement;
					const chunkIndex = parseInt(chunkElement.dataset.chunkIndex || '0');
					
					if (entry.isIntersecting) {
						newVisibleIndices.add(chunkIndex);
					} else {
						newVisibleIndices.delete(chunkIndex);
					}
				});
				
				visibleChunkIndices = newVisibleIndices;
			},
			{
				root: null,
				rootMargin: '200px 0px', // 200px vertical buffer
				threshold: 0
			}
		);
	}
	
	// Initialize audio data when AudioEngine changes
	$effect(() => {
		if (audioEngine) {
			initializeFromAudioEngine();
		}
	});
	
	// Setup observer after component mounts
	onMount(() => {
		// Wait for initial render
		const initTimer = setTimeout(() => {
			if (waveformContainer) {
				setupIntersectionObserver();
				
				// Use MutationObserver to watch for new chunk elements
				const mutationObserver = new MutationObserver(() => {
					if (chunkObserver && waveformContainer) {
						const chunkElements = waveformContainer.querySelectorAll('[data-chunk-index]:not([data-observed])');
						chunkElements.forEach(element => {
							chunkObserver!.observe(element);
							element.setAttribute('data-observed', 'true');
						});
					}
				});
				
				// Start observing for DOM changes
				mutationObserver.observe(waveformContainer, {
					childList: true,
					subtree: true
				});
				
				// Observe initial elements
				if (chunkObserver) {
					const chunkElements = waveformContainer.querySelectorAll('[data-chunk-index]');
					chunkElements.forEach(element => {
						chunkObserver!.observe(element);
						element.setAttribute('data-observed', 'true');
					});
				}
				
				// Cleanup function
				return () => {
					clearTimeout(initTimer);
					mutationObserver.disconnect();
					chunkObserver?.disconnect();
				};
			}
		}, 100);
		
		return () => {
			clearTimeout(initTimer);
			chunkObserver?.disconnect();
		};
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
					// Linear progression: map time within the song portion
					const songDuration = chunkDuration - offsetInSeconds;
					const progressRatio = currentTime / songDuration;
					const songPortionWidth = containerWidth - songStartX;
					x = songStartX + progressRatio * songPortionWidth;
				}
			} else if (beatOffset < 0) {
				const offsetInSeconds = Math.abs(beatOffset) / 1000;
				const songStartX = ((chunkDuration - offsetInSeconds) / chunkDuration) * containerWidth;
				
				if (currentTime === 0) {
					x = songStartX;
				} else if (currentTime <= offsetInSeconds) {
					// Linear progression: map currentTime linearly across the song portion
					const progressRatio = currentTime / offsetInSeconds;
					const songPortionWidth = containerWidth - songStartX;
					x = songStartX + progressRatio * songPortionWidth;
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





	function handleWaveformMouseDown(event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) {
		// Start drag for annotation creation
		const svg = event.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
		const x = event.clientX - rect.left;
		lastPointerClientX = event.clientX;
		lastPointerClientY = event.clientY;
		
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

	function handleWaveformTouchStart(event: TouchEvent, chunkIndex: number, bounds: ChunkBounds) {
		if (event.touches.length === 0) return;
		const touch = event.touches[0];
		const svg = event.currentTarget as SVGElement;
		const rect = svg.getBoundingClientRect();
		const x = touch.clientX - rect.left;
		lastPointerClientX = touch.clientX;
		lastPointerClientY = touch.clientY;

		dragStartTimeMs = pixelToTime(x, bounds, waveformConfig.width);
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

		// Hide placeholder immediately - dragging is complete
		showPlaceholder = false;

		// Use last known touch position for popup
		showAnnotationPopup = true;
		const touch = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null;
		popupX = touch ? touch.clientX : lastPointerClientX;
		popupY = touch ? touch.clientY : lastPointerClientY;
		annotationStartTimeMs = Math.min(dragStartTimeMs, dragEndTimeMs);
		annotationEndTimeMs = isPoint ? annotationStartTimeMs : Math.max(dragStartTimeMs, dragEndTimeMs);
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
			
			await exportService.exportChunk(audioBuffer, startTime, endTime, exportFilename);
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
			
			await exportService.exportChunkGroup(audioBuffer, chunks, exportFilename);
		} catch (error) {
			console.error('Failed to export chunk group:', error);
			alert('Failed to export chunk group. Please try again.');
		}
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
					<span>Duration: {effectiveDuration.toFixed(1)}s</span>
					<span class="mx-2">•</span>
					<span>Chunk Duration: {effectiveChunkDuration.toFixed(2)}s</span>
					<span class="mx-2">•</span>
					<span>Total Chunks: {totalChunks}</span>
					<span class="mx-2">•</span>
					<span>BPM: {targetBPM}</span>
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
				{#if chunk.shouldRenderContent}
					<!-- Render full chunk with content -->
					<SingleLineWaveformDisplay
						chunkIndex={chunk.index}
						bounds={chunk.bounds}
						isSpecialChunk={chunk.isSpecialChunk}
						waveformBars={chunk.waveformBars}
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
					/>
				{:else}
					<!-- Render placeholder for non-visible chunk -->
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