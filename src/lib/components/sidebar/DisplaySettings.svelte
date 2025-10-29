<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	
	function handleBeatsPerLineChange(value: number) {
		// Clamp value between 1 and 64
		const clampedValue = Math.max(1, Math.min(512, value));
		sessionStore.updateBeatsPerLine(clampedValue);
	}
</script>

<div class="space-y-4">
	<!-- Beats Per Line -->
	<div class="space-y-2">
		<label for="beats-per-line" class="text-sm font-medium text-gray-300 block">
			Beats Per Line
		</label>
		<input 
			type="number"
			id="beats-per-line"
			value={sessionStore.beatsPerLine}
			onchange={(e) => handleBeatsPerLineChange(Number((e.target as HTMLInputElement).value))}
			oninput={(e) => {
				const target = e.target as HTMLInputElement;
				// Prevent non-numeric input
				if (target.value && isNaN(Number(target.value))) {
					target.value = String(sessionStore.beatsPerLine);
				}
			}}
			min="1"
			max="64"
			step="1"
			class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
		/>
		<p class="text-xs text-gray-400">
			Controls how many beats are displayed per line in the waveform
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