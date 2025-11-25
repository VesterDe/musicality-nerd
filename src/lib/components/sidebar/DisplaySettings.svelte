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

	const rectsPerBeatMode = $derived(sessionStore.currentSession?.rectsPerBeatMode ?? 'auto');
	const rectsPerBeatValue = $derived(
		rectsPerBeatMode === 'auto' ? 'auto' : String(rectsPerBeatMode)
	);
	const autoFollow = $derived(sessionStore.autoFollow);
	const showBeatNumbers = $derived(sessionStore.showBeatNumbers);
</script>

<div class="space-y-4">
	<!-- Beats Per Line -->
	<div class="space-y-2">
		<label for="beats-per-line" class="block text-sm font-medium text-gray-300">
			Beats Per Line
		</label>
		<select
			id="beats-per-line"
			value={sessionStore.beatsPerLine}
			onchange={(e) => handleBeatsPerLineChange(Number((e.target as HTMLSelectElement).value))}
			class="w-full cursor-pointer rounded bg-gray-700 px-3 py-1.5 text-sm text-white"
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
		<label for="rects-per-beat" class="block text-sm font-medium text-gray-300">
			Rects per Beat
		</label>
		<select
			id="rects-per-beat"
			value={rectsPerBeatValue}
			onchange={(e) => handleRectsPerBeatChange((e.target as HTMLSelectElement).value)}
			class="w-full cursor-pointer rounded bg-gray-700 px-3 py-1.5 text-sm text-white"
		>
			<option value="auto">Auto</option>
			{#each rectsPerBeatManualOptions as option}
				<option value={option}>{option}</option>
			{/each}
		</select>
		<p class="text-xs text-gray-400">
			Auto chooses between 8 and upper limit based on viewport. Manual sets a fixed power-of-two
			value.
		</p>
	</div>

	<!-- Auto-follow Toggle -->
	<div class="space-y-2">
		<label class="flex cursor-pointer items-center justify-between">
			<span class="text-sm font-medium text-gray-300">Auto-follow Playback</span>
			<div class="relative">
				<input
					type="checkbox"
					checked={autoFollow}
					onchange={() => sessionStore.toggleAutoFollow()}
					class="sr-only"
				/>
				<div
					class="h-5 w-10 rounded-full shadow-inner transition-all duration-200 {autoFollow
						? 'bg-blue-600'
						: 'bg-gray-600'}"
				></div>
				<div
					class="absolute top-0.5 left-0.5 h-4 w-4 transform rounded-full bg-white shadow-md transition-all duration-200 {autoFollow
						? 'translate-x-5'
						: 'translate-x-0'}"
				></div>
			</div>
		</label>
		<p class="text-xs text-gray-400">
			Automatically scroll to follow the current playback position
		</p>
	</div>

	<!-- Show Beat Numbers Toggle -->
	<div class="space-y-2">
		<label class="flex cursor-pointer items-center justify-between">
			<span class="text-sm font-medium text-gray-300">Show Beat Numbers</span>
			<div class="relative">
				<input
					type="checkbox"
					checked={showBeatNumbers}
					onchange={() => sessionStore.toggleShowBeatNumbers()}
					class="sr-only"
				/>
				<div
					class="h-5 w-10 rounded-full shadow-inner transition-all duration-200 {showBeatNumbers
						? 'bg-blue-600'
						: 'bg-gray-600'}"
				></div>
				<div
					class="absolute top-0.5 left-0.5 h-4 w-4 transform rounded-full bg-white shadow-md transition-all duration-200 {showBeatNumbers
						? 'translate-x-5'
						: 'translate-x-0'}"
				></div>
			</div>
		</label>
		<p class="text-xs text-gray-400">
			Display beat numbers (1-4) in the top-left of each beat area
		</p>
	</div>
</div>
