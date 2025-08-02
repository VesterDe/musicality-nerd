<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Annotation } from '../types';

	interface Props {
		visible: boolean;
		x: number;
		y: number;
		startTimeMs: number;
		endTimeMs: number;
		editingAnnotation?: Annotation | null;
	}

	let { visible = false, x = 0, y = 0, startTimeMs = 0, endTimeMs = 0, editingAnnotation = null }: Props = $props();

	const dispatch = createEventDispatcher<{
		save: { label: string; color: string; startTimeMs: number; endTimeMs: number; isPoint?: boolean };
		cancel: void;
	}>();

	// Component state
	let annotationLabel = $state('');
	let annotationColor = $state('#ff5500');
	let inputRef: HTMLInputElement | undefined = $state();

	const defaultColors = [
		'#ff5500', // Orange
		'#00baff', // Blue
		'#ff3366', // Red
		'#33ff66', // Green
		'#ffaa00', // Yellow
		'#aa00ff', // Purple
		'#ff0099', // Pink
		'#00ffaa'  // Cyan
	];

	// Auto-focus input when popup becomes visible
	$effect(() => {
		if (visible && inputRef) {
			inputRef.focus();
			inputRef.select();
		}
	});

	// Check if this is a point annotation
	const isPointAnnotation = $derived(startTimeMs === endTimeMs);

	// Reset form when popup becomes visible
	$effect(() => {
		if (visible) {
			if (editingAnnotation) {
				// Editing mode - populate with existing data
				annotationLabel = editingAnnotation.label;
				annotationColor = editingAnnotation.color;
			} else {
				// Creation mode - use defaults
				if (isPointAnnotation) {
					annotationLabel = 'Point annotation';
				} else {
					const duration = (endTimeMs - startTimeMs) / 1000;
					annotationLabel = `Annotation ${duration.toFixed(1)}s`;
				}
				annotationColor = '#ff5500';
			}
		}
	});

	function handleSave() {
		if (annotationLabel.trim()) {
			dispatch('save', {
				label: annotationLabel.trim(),
				color: annotationColor,
				startTimeMs,
				endTimeMs,
				isPoint: isPointAnnotation
			});
		}
	}

	function handleCancel() {
		dispatch('cancel');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			handleSave();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			handleCancel();
		}
	}

	function formatTime(timeMs: number): string {
		const seconds = timeMs / 1000;
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = (seconds % 60).toFixed(1);
		return `${minutes}:${remainingSeconds.padStart(4, '0')}`;
	}

	// Calculate popup position to stay within viewport - only when opening
	let adjustedX = $state(x);
	let adjustedY = $state(y);
	
	$effect(() => {
		if (visible && typeof window !== 'undefined') {
			// Use requestAnimationFrame to avoid blocking the render
			requestAnimationFrame(() => {
				const popup = document.querySelector('.annotation-popup') as HTMLElement;
				if (popup) {
					const rect = popup.getBoundingClientRect();
					const viewportWidth = window.innerWidth;
					const viewportHeight = window.innerHeight;
					
					// Adjust position if popup would go off-screen
					let newX = x;
					let newY = y;
					
					if (x + rect.width > viewportWidth) {
						newX = viewportWidth - rect.width - 10;
					}
					if (y + rect.height > viewportHeight) {
						newY = y - rect.height - 10;
					}
					
					adjustedX = Math.max(10, newX);
					adjustedY = Math.max(10, newY);
				}
			});
		}
	});
</script>

{#if visible}
	<!-- Backdrop -->
	<div 
		class="fixed inset-0 bg-black/50 z-40 mb-0"
		onclick={handleCancel}
		onkeydown={handleKeydown}
		role="button"
		tabindex="-1"
	></div>

	<!-- Popup -->
	<div 
		class="annotation-popup fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-4 min-w-80"
		style="left: {adjustedX}px; top: {adjustedY}px;"
	>
		<div class="space-y-4">
			<!-- Header -->
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold text-gray-200">
					{#if editingAnnotation}
						Edit {editingAnnotation.isPoint || editingAnnotation.startTimeMs === editingAnnotation.endTimeMs ? 'Point' : ''} Annotation
					{:else}
						New {isPointAnnotation ? 'Point' : 'Duration'} Annotation
					{/if}
				</h3>
				<button
					class="text-gray-400 hover:text-gray-300 text-lg leading-none"
					onclick={handleCancel}
					title="Cancel"
				>
					×
				</button>
			</div>

			<!-- Time info -->
			<div class="text-xs text-gray-400 bg-gray-700 px-2 py-1 rounded">
				{#if isPointAnnotation}
					Point at {formatTime(startTimeMs)}
				{:else}
					{formatTime(startTimeMs)} - {formatTime(endTimeMs)} 
					<span class="mx-1">•</span>
					{((endTimeMs - startTimeMs) / 1000).toFixed(1)}s
				{/if}
			</div>

			<!-- Label input -->
			<div>
				<label class="block text-sm font-medium text-gray-300 mb-1">
					Label
				</label>
				<input
					bind:this={inputRef}
					bind:value={annotationLabel}
					type="text"
					placeholder="Enter annotation name..."
					class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg 
						   text-white placeholder-gray-400 focus:outline-none focus:ring-2 
						   focus:ring-blue-500 focus:border-transparent"
					onkeydown={handleKeydown}
				/>
			</div>

			<!-- Color picker -->
			<div>
				<label class="block text-sm font-medium text-gray-300 mb-2">
					Color
				</label>
				<div class="flex items-center space-x-3">
					<!-- Custom color picker -->
					<input
						type="color"
						bind:value={annotationColor}
						class="w-8 h-8 rounded border border-gray-600 cursor-pointer"
					/>
					
					<!-- Preset colors -->
					<div class="flex space-x-1">
						{#each defaultColors as color}
							<button
								class="w-6 h-6 rounded border-2 transition-all hover:scale-110
									   {annotationColor === color ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'}"
								style="background-color: {color}"
								onclick={() => annotationColor = color}
								title={color}
							></button>
						{/each}
					</div>
				</div>
			</div>

			<!-- Action buttons -->
			<div class="flex space-x-2 pt-2">
				<button
					class="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
					onclick={handleSave}
					disabled={!annotationLabel.trim()}
				>
{editingAnnotation ? 'Update Annotation' : 'Create Annotation'}
				</button>
				<button
					class="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
					onclick={handleCancel}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.annotation-popup {
		animation: popup-appear 0.15s ease-out;
	}

	@keyframes popup-appear {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-10px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}
</style>