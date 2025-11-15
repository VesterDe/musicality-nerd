<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';

	// Compute derived values from session store
	const beatsPerLine = $derived(sessionStore.currentSession?.beatsPerLine ?? sessionStore.beatsPerLine);
	
	const chunkDuration = $derived(beatsPerLine > 0 
		? beatsPerLine * (60 / sessionStore.bpm) 
		: 0);
	
	const effectiveChunkDuration = $derived(beatsPerLine > 0 
		? beatsPerLine * (60 / sessionStore.targetBPM) 
		: 0);
	
	const effectiveDuration = $derived(sessionStore.duration * (sessionStore.bpm / sessionStore.targetBPM));
	
	const totalChunks = $derived.by(() => {
		if (!sessionStore.currentSession || sessionStore.duration <= 0 || chunkDuration <= 0) return 0;
		const baseChunks = Math.ceil(sessionStore.duration / chunkDuration);
		return sessionStore.beatOffset !== 0 ? baseChunks + 1 : baseChunks;
	});
	
	const currentChunk = $derived.by(() => {
		if (!sessionStore.currentSession || chunkDuration <= 0) return 0;
		return Math.floor(sessionStore.currentTime / chunkDuration) + 1;
	});
</script>

<div class="space-y-2 text-xs text-gray-400">
		<div class="flex justify-between">
			<span>Duration:</span>
			<span class="text-gray-300">{effectiveDuration.toFixed(1)}s</span>
		</div>
		<div class="flex justify-between">
			<span>Chunk Duration:</span>
			<span class="text-gray-300">{effectiveChunkDuration.toFixed(2)}s</span>
		</div>
		<div class="flex justify-between">
			<span>Total Chunks:</span>
			<span class="text-gray-300">{totalChunks}</span>
		</div>
		<div class="flex justify-between">
			<span>BPM:</span>
			<span class="text-gray-300">{sessionStore.targetBPM}</span>
		</div>
		<div class="flex justify-between">
			<span>Offset:</span>
			<span class="text-gray-300">{sessionStore.beatOffset}ms</span>
		</div>
		<div class="flex justify-between">
			<span>Current:</span>
			<span class="text-gray-300">{currentChunk} / {totalChunks}</span>
		</div>
		<div class="flex justify-between">
			<span>Beats:</span>
			<span class="text-gray-300">{sessionStore.currentSession?.beats.length || 0}</span>
		</div>
</div>

