<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Tag } from '../types';
	import { v4 as uuidv4 } from 'uuid';

	interface Props {
		tags: Record<string, Tag>;
		armedTagId: string | null;
	}

	let { tags = {}, armedTagId = null }: Props = $props();

	const dispatch = createEventDispatcher<{
		'tag-created': { id: string; label: string; color: string };
		'tag-deleted': { id: string };
		'tag-armed': { id: string | null };
	}>();

	// Component state
	let showCreateForm = $state(false);
	let newTagLabel = $state('');
	let newTagColor = $state('#ff5500');

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

	function toggleCreateForm() {
		showCreateForm = !showCreateForm;
		if (!showCreateForm) {
			resetForm();
		}
	}

	function resetForm() {
		newTagLabel = '';
		newTagColor = '#ff5500';
	}

	function createTag() {
		if (!newTagLabel.trim()) return;

		const id = uuidv4();
		dispatch('tag-created', {
			id,
			label: newTagLabel.trim(),
			color: newTagColor
		});

		resetForm();
		showCreateForm = false;
	}

	function deleteTag(tagId: string) {
		if (confirm('Are you sure you want to delete this tag?')) {
			dispatch('tag-deleted', { id: tagId });
		}
	}

	function armTag(tagId: string | null) {
		dispatch('tag-armed', { id: tagId });
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			createTag();
		} else if (event.key === 'Escape') {
			toggleCreateForm();
		}
	}
</script>

<div class="bg-gray-800 rounded-lg p-4">
	<div class="flex items-center justify-between mb-4">
		<h3 class="text-lg font-semibold text-gray-200">Tags</h3>
		<button
			class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg text-sm transition-colors"
			on:click={toggleCreateForm}
		>
			{showCreateForm ? '✕' : '➕'} {showCreateForm ? 'Cancel' : 'New Tag'}
		</button>
	</div>

	<!-- Create Tag Form -->
	{#if showCreateForm}
		<div class="mb-4 p-3 bg-gray-700 rounded-lg border border-gray-600">
			<div class="space-y-3">
				<div>
					<label class="block text-sm font-medium text-gray-300 mb-1">
						Tag Name
					</label>
					<input
						type="text"
						bind:value={newTagLabel}
						placeholder="e.g., Kick, Snare, Break"
						class="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-lg 
							   text-white placeholder-gray-400 focus:outline-none focus:ring-2 
							   focus:ring-blue-500 focus:border-transparent"
						on:keydown={handleKeydown}
						autofocus
					/>
				</div>
				
				<div>
					<label class="block text-sm font-medium text-gray-300 mb-2">
						Color
					</label>
					<div class="flex items-center space-x-3">
						<!-- Color picker -->
						<input
							type="color"
							bind:value={newTagColor}
							class="w-8 h-8 rounded border border-gray-500 cursor-pointer"
						/>
						
						<!-- Preset colors -->
						<div class="flex space-x-1">
							{#each defaultColors as color}
								<button
									class="w-6 h-6 rounded border-2 transition-all
										   {newTagColor === color ? 'border-white scale-110' : 'border-gray-500 hover:border-gray-400'}"
									style="background-color: {color}"
									on:click={() => newTagColor = color}
								></button>
							{/each}
						</div>
					</div>
				</div>
				
				<div class="flex space-x-2">
					<button
						class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm transition-colors"
						on:click={createTag}
						disabled={!newTagLabel.trim()}
					>
						Create Tag
					</button>
					<button
						class="bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded text-sm transition-colors"
						on:click={toggleCreateForm}
					>
						Cancel
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Tag List -->
	{#if Object.keys(tags).length === 0}
		<div class="text-center py-6 text-gray-400">
			<div class="text-2xl mb-2">🏷️</div>
			<p>No tags created yet</p>
			<p class="text-sm">Create tags to mark instruments, breaks, and events</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each Object.entries(tags) as [tagId, tag]}
				<div 
					class="flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer
						   {armedTagId === tagId 
						   	? 'border-blue-400 bg-blue-400/10' 
						   	: 'border-gray-600 hover:border-gray-500'}"
					on:click={() => armTag(armedTagId === tagId ? null : tagId)}
				>
					<div class="flex items-center space-x-3">
						<!-- Color indicator -->
						<div 
							class="w-4 h-4 rounded-full border border-gray-400"
							style="background-color: {tag.color}"
						></div>
						
						<!-- Tag label -->
						<span class="text-gray-200">
							{tag.label}
						</span>
						
						<!-- Armed indicator -->
						{#if armedTagId === tagId}
							<span class="text-xs bg-blue-600 px-2 py-1 rounded text-white">
								ARMED
							</span>
						{/if}
					</div>
					
					<button
						class="text-red-400 hover:text-red-300 text-sm p-1 transition-colors"
						on:click|stopPropagation={() => deleteTag(tagId)}
						title="Delete tag"
					>
						🗑️
					</button>
				</div>
			{/each}
		</div>
		
		<!-- Instructions -->
		<div class="mt-4 p-3 bg-gray-700/50 rounded-lg border border-gray-600">
			<h4 class="text-sm font-medium text-gray-300 mb-1">How to use tags:</h4>
			<ul class="text-xs text-gray-400 space-y-1">
				<li>• Click a tag to <strong>arm</strong> it for tagging</li>
				<li>• While armed, press <kbd class="bg-gray-600 px-1 rounded">Space</kbd> during playback to toggle tag on current beat</li>
				<li>• Click the armed tag again to <strong>disarm</strong></li>
			</ul>
		</div>
	{/if}
</div>

<style>
	kbd {
		font-family: monospace;
		font-size: 0.7rem;
	}
</style> 