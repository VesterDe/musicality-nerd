<script lang="ts">
	import type { Beat, Tag } from '../types';

	interface Props {
		beats: Beat[];
		tags: Record<string, Tag>;
		currentBeatIndex: number;
		currentTime: number;
		bpm: number;
	}

	let { beats = [], tags = {}, currentBeatIndex = -1, currentTime = 0, bpm = 120 }: Props = $props();

	// Show a window of beats around the current beat
	const windowSize = 16; // Show 16 beats at a time
	
	const visibleBeats = $derived.by(() => {
		if (beats.length === 0) return [];
		
		const start = Math.max(0, currentBeatIndex - Math.floor(windowSize / 2));
		const end = Math.min(beats.length, start + windowSize);
		
		return beats.slice(start, end).map((beat, index) => ({
			...beat,
			isVisible: true,
			globalIndex: start + index
		}));
	});

	function getBeatTags(beat: Beat): Array<{ id: string; tag: Tag }> {
		return beat.tags.map(tagId => ({
			id: tagId,
			tag: tags[tagId]
		})).filter(item => item.tag);
	}

	function formatBeatTime(time: number): string {
		const mins = Math.floor(time / 60);
		const secs = Math.floor(time % 60);
		const ms = Math.floor((time % 1) * 100);
		return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
	}
</script>

{#if beats.length > 0}
	<div class="bg-gray-800 rounded-lg p-4">
		<div class="flex items-center justify-between mb-4">
			<h3 class="text-lg font-semibold text-gray-200">Beat Grid</h3>
			<div class="text-sm text-gray-400">
				{currentBeatIndex >= 0 ? currentBeatIndex + 1 : '-'} / {beats.length}
			</div>
		</div>

		<!-- Beat Grid -->
		<div class="grid grid-cols-8 gap-2 mb-4">
			{#each visibleBeats as beat}
				<div 
					class="relative p-2 rounded border transition-all text-center
						   {beat.globalIndex === currentBeatIndex 
						   	? 'border-blue-400 bg-blue-400/20' 
						   	: 'border-gray-600 bg-gray-700/50'}"
				>
					<!-- Beat number -->
					<div class="text-xs font-mono text-gray-300 mb-1">
						{beat.index + 1}
					</div>
					
					<!-- Beat time -->
					<div class="text-xs text-gray-500 mb-1">
						{formatBeatTime(beat.time)}
					</div>
					
					<!-- Tags -->
					{#if beat.tags.length > 0}
						<div class="flex flex-wrap gap-1 justify-center">
							{#each getBeatTags(beat) as { id, tag }}
								<div 
									class="w-2 h-2 rounded-full border border-gray-400"
									style="background-color: {tag.color}"
									title={tag.label}
								></div>
							{/each}
						</div>
					{/if}
					
					<!-- Current beat indicator -->
					{#if beat.globalIndex === currentBeatIndex}
						<div class="absolute -top-1 -right-1 w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Progress indicator -->
		<div class="w-full bg-gray-700 rounded-full h-1 mb-2">
			<div 
				class="bg-blue-600 h-1 rounded-full transition-all duration-100"
				style="width: {beats.length > 0 ? ((currentBeatIndex + 1) / beats.length) * 100 : 0}%"
			></div>
		</div>

		<!-- Beat info -->
		{#if currentBeatIndex >= 0 && beats[currentBeatIndex]}
			{@const currentBeat = beats[currentBeatIndex]}
			<div class="text-sm text-gray-400">
				<span>Current: Beat {currentBeat.index + 1}</span>
				<span class="mx-2">•</span>
				<span>Time: {formatBeatTime(currentBeat.time)}</span>
				{#if currentBeat.tags.length > 0}
					<span class="mx-2">•</span>
					<span>Tags: {currentBeat.tags.map(tagId => tags[tagId]?.label || tagId).join(', ')}</span>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
	
	.animate-pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
</style> 