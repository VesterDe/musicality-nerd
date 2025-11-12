<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	
	function handleBeatsPerLineChange(value: number) {
		// Clamp value between 1 and 64
		const clampedValue = Math.max(1, Math.min(512, value));
		sessionStore.updateBeatsPerLine(clampedValue);
	}

	function handleRectsPerBeatChange(value: string) {
		if (value === 'auto') {
			sessionStore.updateRectsPerBeatMode('auto');
		} else {
			sessionStore.updateRectsPerBeatMode(Number(value));
		}
	}

	const beatsPerLineOptions = [1, 2, 4, 8, 16, 32, 64, 128, 256];
	const rectsPerBeatManualOptions = [8, 16, 32, 64, 128];

	$: rectsPerBeatMode = sessionStore.currentSession?.rectsPerBeatMode ?? 'auto';
	$: rectsPerBeatValue = rectsPerBeatMode === 'auto' ? 'auto' : String(rectsPerBeatMode);
</script>

<div class="space-y-4">
	<!-- Beats Per Line -->
	<div class="space-y-2">
		<label for="beats-per-line" class="text-sm font-medium text-gray-300 block">
			Beats Per Line
		</label>
		<select
			id="beats-per-line"
			value={sessionStore.beatsPerLine}
			onchange={(e) => handleBeatsPerLineChange(Number((e.target as HTMLSelectElement).value))}
			class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm"
		>
			{#each beatsPerLineOptions as option}
				<option value={option}>{option}</option>
			{/each}
		</select>
		<p class="text-xs text-gray-400">
			Controls how many beats are displayed per line in the waveform
		</p>
	</div>

	<!-- Rects Per Beat -->
	<div class="space-y-2">
		<label for="rects-per-beat" class="text-sm font-medium text-gray-300 block">
			Rects per Beat
		</label>
		<select
			id="rects-per-beat"
			value={rectsPerBeatValue}
			onchange={(e) => handleRectsPerBeatChange((e.target as HTMLSelectElement).value)}
			class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm"
		>
			<option value="auto">Auto</option>
			{#each rectsPerBeatManualOptions as option}
				<option value={option}>{option}</option>
			{/each}
		</select>
		<p class="text-xs text-gray-400">
			Auto chooses between 8 and upper limit based on viewport. Manual sets a fixed power-of-two value.
		</p>
	</div>
	
	<!-- Auto-follow Toggle -->
	<div class="space-y-2">
		<label class="flex items-center justify-between cursor-pointer">
			<span class="text-sm font-medium text-gray-300">Auto-follow Playback</span>
			<div class="relative">
				<input 
					type="checkbox" 
					checked={sessionStore.autoFollow}
					onchange={() => sessionStore.toggleAutoFollow()}
					class="sr-only"
				/>
				<div class="w-10 h-5 bg-gray-600 rounded-full shadow-inner transition-all duration-200 {sessionStore.autoFollow ? 'bg-blue-600' : ''}"></div>
				<div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow-md transform transition-all duration-200 {sessionStore.autoFollow ? 'translate-x-5' : 'translate-x-0'}"></div>
			</div>
		</label>
		<p class="text-xs text-gray-400">
			Automatically scroll to follow the current playback position
		</p>
	</div>
</div>