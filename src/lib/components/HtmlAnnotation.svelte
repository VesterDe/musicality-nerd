<script lang="ts">
	import type { Annotation } from '../types';
	import { timeToPixel, type ChunkBounds } from '../utils/svgWaveform';

	interface Props {
		annotation: Annotation;
		chunkBounds: ChunkBounds;
		chunkWidth: number;
		chunkHeight: number;
		chunkIndex: number;
		onEdit?: (annotation: Annotation) => void;
		onDelete?: (annotationId: string) => void;
		onMove?: (annotationId: string, newStartTimeMs: number, newEndTimeMs: number) => void;
		isPlaceholder?: boolean;
	}

	let {
		annotation,
		chunkBounds,
		chunkWidth,
		chunkHeight,
		chunkIndex,
		onEdit,
		onDelete,
		onMove,
		isPlaceholder = false
	}: Props = $props();

	// Local state
	let isHovered = $state(false);
	let isDragging = $state(false);
	let isResizing = $state(false);
	let resizeHandle: 'start' | 'end' | null = $state(null);
	let dragStartX = $state(0);
	let originalStartTime = $state(0);
	let originalEndTime = $state(0);

	// Calculate annotation positioning
	const isPointAnnotation = $derived(annotation.isPoint || annotation.startTimeMs === annotation.endTimeMs);
	
	const startX = $derived(() => {
		return timeToPixel(annotation.startTimeMs, chunkBounds, chunkWidth);
	});
	
	const endX = $derived(() => {
		return timeToPixel(annotation.endTimeMs, chunkBounds, chunkWidth);
	});
	
	const width = $derived(isPointAnnotation ? 12 : Math.max(20, endX() - startX())); // Minimum width for duration annotations
	
	const annotationY = $derived(chunkHeight - 60); // Position above beat markers

	// Visibility is already handled by parent component, so we always render

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
		
		// Add global mouse listeners
		document.addEventListener('mousemove', handleGlobalMouseMove);
		document.addEventListener('mouseup', handleGlobalMouseUp);
	}

	function handleGlobalMouseMove(event: MouseEvent) {
		if (!isDragging && !isResizing) return;
		
		const deltaX = event.clientX - dragStartX;
		const deltaTime = (deltaX / chunkWidth) * (chunkBounds.endTimeMs - chunkBounds.startTimeMs);
		
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
</script>

<div
		class="absolute group"
		class:transition-all={!isPlaceholder}
		class:duration-150={!isPlaceholder}
		class:cursor-pointer={!isPlaceholder}
		class:cursor-default={isPlaceholder}
		class:opacity-80={!isHovered && !isPlaceholder}
		class:opacity-100={isHovered && !isPlaceholder}
		class:opacity-60={isPlaceholder}
		class:animate-pulse={isPlaceholder}
		style:left="{startX()}px"
		style:top="{annotationY}px"
		style:width="{width}px"
		style:height="20px"
		role={isPlaceholder ? "presentation" : "button"}
		tabindex={isPlaceholder ? -1 : 0}
		onmouseenter={() => !isPlaceholder && (isHovered = true)}
		onmouseleave={() => !isPlaceholder && (isHovered = false)}
		onmousedown={handleMouseDown}
		onkeydown={(e) => {
			if (isPlaceholder) return;
			if (e.key === 'Enter' || e.key === ' ') {
				handleEdit();
			} else if (e.key === 'Delete' || e.key === 'Backspace') {
				handleDelete();
			}
		}}
	>
		{#if isPointAnnotation}
			<!-- Point Annotation -->
			<div
				class="point-annotation relative flex items-center"
				style:color={annotation.color}
			>
				<!-- Dot -->
				<div
					class="w-3 h-3 rounded-full border-2 transition-all duration-150"
					class:scale-125={isHovered}
					class:shadow-lg={isHovered}
					style:background-color={annotation.color}
					style:border-color="white"
				></div>
				
				<!-- Label -->
				<div
					class="ml-2 text-xs font-medium whitespace-nowrap"
					class:text-white={isHovered}
				>
					{annotation.label}
				</div>
				
				<!-- Hover buttons -->
				{#if isHovered && !isPlaceholder}
					<div class="absolute -top-1 -right-1 flex space-x-1">
						<button
							class="w-5 h-5 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs flex items-center justify-center"
							onclick={handleEdit}
							title="Edit"
						>
							✏️
						</button>
						<button
							class="w-5 h-5 bg-red-600 hover:bg-red-700 rounded text-white text-xs flex items-center justify-center"
							onclick={handleDelete}
							title="Delete"
						>
							🗑️
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Duration Annotation -->
			<div
				class="duration-annotation relative h-full rounded transition-all duration-150"
				class:shadow-lg={isHovered}
				class:ring-2={isHovered}
				class:ring-white={isHovered}
				class:ring-opacity-50={isHovered}
				style:background-color="{annotation.color}80"
				style:border="1px solid {annotation.color}"
			>
				<!-- Resize handles -->
				{#if isHovered && !isPointAnnotation && !isPlaceholder}
					<div
						class="resize-handle absolute left-0 top-0 w-2 h-full cursor-w-resize bg-white bg-opacity-20 hover:bg-opacity-40"
						data-handle="start"
					></div>
					<div
						class="resize-handle absolute right-0 top-0 w-2 h-full cursor-e-resize bg-white bg-opacity-20 hover:bg-opacity-40"
						data-handle="end"
					></div>
				{/if}
				
				<!-- Content -->
				<div class="flex items-center justify-between h-full px-2">
					<!-- Label -->
					<div class="text-white text-xs font-medium truncate flex-1">
						{annotation.label}
					</div>
					
					<!-- Hover buttons -->
					{#if isHovered && !isPlaceholder}
						<div class="flex space-x-1 ml-2">
							<button
								class="w-4 h-4 bg-blue-600 hover:bg-blue-700 rounded text-white text-xs flex items-center justify-center"
								onclick={handleEdit}
								title="Edit"
							>
								✏️
							</button>
							<button
								class="w-4 h-4 bg-red-600 hover:bg-red-700 rounded text-white text-xs flex items-center justify-center"
								onclick={handleDelete}
								title="Delete"
							>
								🗑️
							</button>
						</div>
					{/if}
				</div>
				
				<!-- Move indicator -->
				{#if isHovered && width > 60 && !isPlaceholder}
					<div class="absolute top-1 left-1/2 transform -translate-x-1/2 text-white text-xs opacity-60">
						↔️
					</div>
				{/if}
			</div>
		{/if}
	</div>

<style>
	.point-annotation {
		pointer-events: all;
	}
	
	.duration-annotation {
		pointer-events: all;
		user-select: none;
	}
	
	.resize-handle {
		pointer-events: all;
	}
</style>