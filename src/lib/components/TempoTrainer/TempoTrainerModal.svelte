<script lang="ts">
	import TempoTrainerView from './TempoTrainerView.svelte';
	import type { AudioEngine } from '$lib/audio/AudioEngine';

	interface Props {
		audioEngine?: AudioEngine;
		songBpm?: number;
		segmentStart?: number;
		segmentEnd?: number;
		chunkIndex?: number;
		stemStates?: boolean[];
		onStemToggle?: (index: number, enabled: boolean) => void;
		onClose: () => void;
	}

	let {
		audioEngine,
		songBpm = 120,
		segmentStart,
		segmentEnd,
		chunkIndex,
		stemStates = [],
		onStemToggle,
		onClose
	}: Props = $props();

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
	}
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 bg-black/50 z-40"
	onclick={onClose}
	onkeydown={handleKeydown}
	role="button"
	tabindex="-1"
></div>

<!-- Modal -->
<div
	class="tempo-trainer-modal fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-6 w-full max-w-md"
	style="left: 50%; top: 50%; transform: translate(-50%, -50%);"
>
	<TempoTrainerView
		{audioEngine}
		{songBpm}
		{segmentStart}
		{segmentEnd}
		{chunkIndex}
		{stemStates}
		{onStemToggle}
		{onClose}
	/>
</div>

<style>
	.tempo-trainer-modal {
		animation: modal-appear 0.15s ease-out;
	}

	@keyframes modal-appear {
		from {
			opacity: 0;
			transform: translate(-50%, -50%) scale(0.95);
		}
		to {
			opacity: 1;
			transform: translate(-50%, -50%) scale(1);
		}
	}
</style>
