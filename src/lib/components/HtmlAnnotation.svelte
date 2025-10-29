<script lang="ts">
	import type { Annotation } from '../types';
	import { timeToPixel, type ChunkBounds } from '../utils/svgWaveform';

	interface Props {
		annotation: Annotation;
		chunkBounds: ChunkBounds;
		chunkWidth: number;
		chunkHeight: number;
		chunkIndex: number;
		stackPosition?: number;
		onEdit?: (annotation: Annotation) => void;
		onDelete?: (annotationId: string) => void;
		onMove?: (annotationId: string, newStartTimeMs: number, newEndTimeMs: number) => void;
		onDuplicate?: (annotation: Annotation) => void;
		isPlaceholder?: boolean;
	}

	let {
		annotation,
		chunkBounds,
		chunkWidth,
		chunkHeight,
		chunkIndex,
		stackPosition = 0,
		onEdit,
		onDelete,
		onMove,
		onDuplicate,
		isPlaceholder = false
	}: Props = $props();

	// Local state
	let isHovered = $state(false);
	let isUtilityHovered = $state(false);
	let isDragging = $state(false);
	let isResizing = $state(false);
	let resizeHandle: 'start' | 'end' | null = $state(null);
	let dragStartX = $state(0);
	let originalStartTime = $state(0);
	let originalEndTime = $state(0);
	let hideTimeout: number | null = $state(null);
	let lastPointerClientX = $state(0);

	// Show utility panel when either annotation or utility panel is hovered
	const showUtility = $derived(isHovered || isUtilityHovered);

	// Helper functions for delayed hiding
	function startHideTimer() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
		}
		hideTimeout = setTimeout(() => {
			isHovered = false;
			isUtilityHovered = false;
			hideTimeout = null;
		}, 150); // 150ms delay
	}

	function cancelHideTimer() {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
	}

	// Cleanup timeout on component destroy
	$effect(() => {
		return () => {
			if (hideTimeout) {
				clearTimeout(hideTimeout);
			}
		};
	});

	// Calculate annotation positioning
	const isPointAnnotation = $derived(annotation.isPoint || annotation.startTimeMs === annotation.endTimeMs);

	const startX = $derived(() => {
		return timeToPixel(annotation.startTimeMs, chunkBounds, chunkWidth);
	});

	const endX = $derived(() => {
		return timeToPixel(annotation.endTimeMs, chunkBounds, chunkWidth);
	});

	const width = $derived(isPointAnnotation ? 12 : Math.max(20, endX() - startX())); // Minimum width for duration annotations

	function handleMouseDown(event: MouseEvent) {
		if (isPlaceholder) return;

		event.stopPropagation();

		const target = event.target as HTMLElement;

		// Check if clicking on resize handle
		if (target.classList.contains('resize-handle')) {
			isResizing = true;
			resizeHandle = target.dataset.handle as 'start' | 'end';
			originalStartTime = annotation.startTimeMs;
			originalEndTime = annotation.endTimeMs;
		} else {
			// Start dragging the annotation
			isDragging = true;
			originalStartTime = annotation.startTimeMs;
			originalEndTime = annotation.endTimeMs;
		}

		dragStartX = event.clientX;
		lastPointerClientX = event.clientX;

		// Add global mouse listeners
		document.addEventListener('mousemove', handleGlobalMouseMove);
		document.addEventListener('mouseup', handleGlobalMouseUp);
	}

	function handleTouchStart(event: TouchEvent) {
		if (isPlaceholder) return;
		if (event.touches.length === 0) return;
		event.stopPropagation();
		const touch = event.touches[0];
		const target = event.target as HTMLElement;

		if (target.classList.contains('resize-handle')) {
			isResizing = true;
			resizeHandle = target.dataset.handle as 'start' | 'end';
			originalStartTime = annotation.startTimeMs;
			originalEndTime = annotation.endTimeMs;
		} else {
			isDragging = true;
			originalStartTime = annotation.startTimeMs;
			originalEndTime = annotation.endTimeMs;
		}

		dragStartX = touch.clientX;
		lastPointerClientX = touch.clientX;

		document.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
		document.addEventListener('touchend', handleGlobalTouchEnd);
		document.addEventListener('touchcancel', handleGlobalTouchEnd);
	}

	function handleGlobalMouseMove(event: MouseEvent) {
		if (!isDragging && !isResizing) return;

		const deltaX = event.clientX - dragStartX;
		const deltaTime = (deltaX / chunkWidth) * (chunkBounds.endTimeMs - chunkBounds.startTimeMs);
		lastPointerClientX = event.clientX;

		if (isResizing && resizeHandle) {
			// Handle resizing
			if (resizeHandle === 'start') {
				const newStartTime = Math.max(0, originalStartTime + deltaTime);
				if (newStartTime < annotation.endTimeMs - 100) { // Minimum 100ms duration
					annotation.startTimeMs = Math.round(newStartTime / 25) * 25; // Snap to 25ms
				}
			} else if (resizeHandle === 'end') {
				const newEndTime = originalEndTime + deltaTime;
				if (newEndTime > annotation.startTimeMs + 100) { // Minimum 100ms duration
					annotation.endTimeMs = Math.round(newEndTime / 25) * 25; // Snap to 25ms
				}
			}
		} else if (isDragging) {
			// Handle moving
			const duration = originalEndTime - originalStartTime;
			const newStartTime = Math.max(0, originalStartTime + deltaTime);
			annotation.startTimeMs = Math.round(newStartTime / 25) * 25; // Snap to 25ms
			annotation.endTimeMs = annotation.startTimeMs + duration;
		}
	}

	function handleGlobalMouseUp() {
		if (isDragging || isResizing) {
			// Notify parent of the change
			if (onMove) {
				onMove(annotation.id, annotation.startTimeMs, annotation.endTimeMs);
			}
		}

		isDragging = false;
		isResizing = false;
		resizeHandle = null;

		document.removeEventListener('mousemove', handleGlobalMouseMove);
		document.removeEventListener('mouseup', handleGlobalMouseUp);
	}

	function handleGlobalTouchMove(event: TouchEvent) {
		if (!isDragging && !isResizing) return;
		if (event.touches.length === 0) return;
		const touch = event.touches[0];
		const deltaX = touch.clientX - dragStartX;
		const deltaTime = (deltaX / chunkWidth) * (chunkBounds.endTimeMs - chunkBounds.startTimeMs);
		lastPointerClientX = touch.clientX;

		if (isResizing && resizeHandle) {
			if (resizeHandle === 'start') {
				const newStartTime = Math.max(0, originalStartTime + deltaTime);
				if (newStartTime < annotation.endTimeMs - 100) {
					annotation.startTimeMs = Math.round(newStartTime / 25) * 25;
				}
			} else if (resizeHandle === 'end') {
				const newEndTime = originalEndTime + deltaTime;
				if (newEndTime > annotation.startTimeMs + 100) {
					annotation.endTimeMs = Math.round(newEndTime / 25) * 25;
				}
			}
		} else if (isDragging) {
			const duration = originalEndTime - originalStartTime;
			const newStartTime = Math.max(0, originalStartTime + deltaTime);
			annotation.startTimeMs = Math.round(newStartTime / 25) * 25;
			annotation.endTimeMs = annotation.startTimeMs + duration;
		}

		event.preventDefault();
	}

	function handleGlobalTouchEnd() {
		if (isDragging || isResizing) {
			if (onMove) {
				onMove(annotation.id, annotation.startTimeMs, annotation.endTimeMs);
			}
		}
		isDragging = false;
		isResizing = false;
		resizeHandle = null;
		document.removeEventListener('touchmove', handleGlobalTouchMove);
		document.removeEventListener('touchend', handleGlobalTouchEnd);
		document.removeEventListener('touchcancel', handleGlobalTouchEnd);
	}

	function handleEdit() {
		if (onEdit) {
			onEdit(annotation);
		}
	}

	function handleDelete() {
		console.log('HtmlAnnotation handleDelete called for:', annotation.id);
		if (onDelete) {
			onDelete(annotation.id);
		}
	}

	function handleDuplicate() {
		if (onDuplicate) {
			onDuplicate(annotation);
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="absolute group"
	class:cursor-pointer={!isPlaceholder}
	class:cursor-default={isPlaceholder}
	class:opacity-60={isPlaceholder}
	style:left="{startX()}px"
	style:top="0px"
	style:width="{width}px"
	style:height="{chunkHeight}px"
	role={isPlaceholder ? "presentation" : "button"}
	tabindex={isPlaceholder ? -1 : 0}
	onmouseenter={() => {
		if (!isPlaceholder) {
			cancelHideTimer();
			isHovered = true;
		}
	}}
	onmouseleave={() => {
		if (!isPlaceholder) {
			startHideTimer();
		}
	}}
	onmousedown={handleMouseDown}
	ontouchstart={handleTouchStart}
	style:touch-action="none"
	onkeydown={(e) => {
		if (isPlaceholder) return;
		if (e.key === 'Enter' || e.key === ' ') {
			handleEdit();
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			handleDelete();
		}
	}}
>
	<!-- Invisible interaction area - covers full height -->
	<div class="w-full h-full" style:opacity="0"></div>

	<!-- Resize handles for duration annotations -->
	{#if showUtility && !isPointAnnotation && !isPlaceholder}
		<div
			class="resize-handle absolute left-0 top-0 w-2 h-full cursor-w-resize bg-white bg-opacity-20 hover:bg-opacity-40 transition-all duration-150"
			data-handle="start"
		></div>
		<div
			class="resize-handle absolute right-0 top-0 w-2 h-full cursor-e-resize bg-white bg-opacity-20 hover:bg-opacity-40 transition-all duration-150"
			data-handle="end"
		></div>
	{/if}

	<!-- Utility Panel - visible on hover -->
	{#if showUtility && !isPlaceholder}
		<div
			class="annotation-utility-panel absolute z-10 flex items-center space-x-1 bg-gray-800 rounded px-2 shadow-lg border border-gray-600"
			style:right="-90px"
			style:top="50%"
			style:transform="translateY(-50%)"
			style:height="28px"
			onmouseenter={() => {
				cancelHideTimer();
				isUtilityHovered = true;
			}}
			onmouseleave={() => {
				startHideTimer();
			}}
			role="toolbar"
			aria-label="Annotation actions"
			tabindex="-1"
		>
			<button
				class="utility-button w-5 h-5 rounded transition-all duration-150 text-white text-xs flex items-center justify-center hover:scale-105 bg-blue-600 hover:bg-blue-500"
				onclick={handleEdit}
				title="Edit annotation"
				aria-label="Edit annotation"
			>
				<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
					<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"></path>
				</svg>
			</button>
			<button
				class="utility-button w-5 h-5 rounded transition-all duration-150 text-white text-xs flex items-center justify-center hover:scale-105 bg-green-600 hover:bg-green-500"
				onclick={handleDuplicate}
				title="Duplicate annotation"
				aria-label="Duplicate annotation"
			>
				<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
					<path d="M7 7h10v10H7z"></path>
					<path d="M3 3h10v10H3z" fill="none" stroke="currentColor" stroke-width="1"></path>
				</svg>
			</button>
			<button
				class="utility-button w-5 h-5 rounded transition-all duration-150 text-white text-xs flex items-center justify-center hover:scale-105 bg-red-600 hover:bg-red-500"
				onclick={handleDelete}
				title="Delete annotation"
				aria-label="Delete annotation"
			>
				<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
					<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path>
				</svg>
			</button>
		</div>
	{/if}

	<!-- Label display - shown on hover -->
	{#if showUtility && !isPlaceholder}
		<div
			class="absolute z-10 bg-gray-900 text-white px-2 py-1 rounded text-xs whitespace-nowrap shadow-lg border border-gray-700"
			style:left="50%"
			style:top="-30px"
			style:transform="translateX(-50%)"
		>
			{annotation.label}
		</div>
	{/if}
</div>

<style>
	.resize-handle {
		pointer-events: all;
	}

	.annotation-utility-panel {
		pointer-events: all;
		animation: utility-panel-appear 0.15s ease-out;
	}

	.utility-button {
		pointer-events: all;
	}

	.utility-button:hover {
		transform: scale(1.05);
	}

	@keyframes utility-panel-appear {
		from {
			opacity: 0;
			transform: translateY(-50%) translateX(-4px) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translateY(-50%) translateX(0) scale(1);
		}
	}
</style>
