<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	
	let offsetUpdateTimeout: number | null = null;
	
	function handleOffsetInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const rawValue = parseFloat(target.value);
		
		// Define snap zone (within 5ms of zero)
		const snapZone = 5;
		
		// Update slider display value immediately for smooth dragging
		if (Math.abs(rawValue) <= snapZone) {
			sessionStore.sliderBeatOffset = 0;
		} else {
			sessionStore.sliderBeatOffset = Math.round(rawValue);
		}
		
		// Debounce the actual state update and session save
		if (offsetUpdateTimeout) {
			clearTimeout(offsetUpdateTimeout);
		}
		
		offsetUpdateTimeout = setTimeout(async () => {
			// Update the actual beatOffset state (this triggers rerenders)
			sessionStore.beatOffset = sessionStore.sliderBeatOffset;
			await sessionStore.updateBeatOffset(sessionStore.sliderBeatOffset);
			offsetUpdateTimeout = null;
		}, 250);
	}
	
	$effect(() => {
		// Cleanup timeout on unmount
		return () => {
			if (offsetUpdateTimeout) {
				clearTimeout(offsetUpdateTimeout);
			}
		};
	});
</script>

<div class="space-y-3">
	<div class="flex justify-between items-center">
		<label for="beat-offset" class="text-sm font-medium text-gray-300">
			Beat Grid Alignment
		</label>
		<span class="text-xs text-gray-400">
			{Math.round(sessionStore.beatOffset) > 0 ? '+' : ''}{Math.round(sessionStore.beatOffset)}ms
		</span>
	</div>
	
	<div class="space-y-2">
		<div class="relative">
			<input 
				id="beat-offset"
				type="range" 
				value={sessionStore.sliderBeatOffset}
				oninput={handleOffsetInput}
				min={-sessionStore.maxBeatOffset}
				max={sessionStore.maxBeatOffset}
				step="5"
				class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
			/>
			<!-- Center marker -->
			<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-500 pointer-events-none"></div>
		</div>
		
		<div class="flex justify-between text-xs text-gray-500">
			<span>−½ beat</span>
			<span class="text-gray-400">0</span>
			<span>+½ beat</span>
		</div>
	</div>
	
	<div class="text-xs text-gray-400 space-y-1">
		<p>Adjust to align the beat grid with the music.</p>
		<p>Range: ±{Math.round(sessionStore.maxBeatOffset)}ms</p>
	</div>
</div>

<style>
	.slider::-webkit-slider-thumb {
		appearance: none;
		height: 14px;
		width: 14px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1f2937;
	}

	.slider::-moz-range-thumb {
		height: 14px;
		width: 14px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1f2937;
	}
</style>