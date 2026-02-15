<script lang="ts">
	import { TempoTrainerEngine, type MetronomeSoundType } from '$lib/audio/TempoTrainerEngine';
	import type { AudioEngine } from '$lib/audio/AudioEngine';
	import { onDestroy } from 'svelte';

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

	// Determine if we're in segment mode (have segment data and audio engine)
	const isSegmentMode = $derived(
		audioEngine !== undefined &&
		segmentStart !== undefined &&
		segmentEnd !== undefined
	);

	// Form state
	let startBpm = $state(isSegmentMode ? songBpm : 80);
	let endBpm = $state(isSegmentMode ? Math.min(songBpm * 1.25, songBpm + 40) : 120);
	let durationValue = $state(30);
	let durationUnit = $state<'seconds' | 'minutes'>('seconds');
	let sound = $state<MetronomeSoundType>('beep');

	// Training state
	let isRunning = $state(false);
	let progress = $state(0);
	let currentBpm = $state(0);

	// Engine instance
	let engine: TempoTrainerEngine | null = $state(null);

	// Computed values
	const durationSeconds = $derived(
		durationUnit === 'minutes' ? durationValue * 60 : durationValue
	);

	const segmentDuration = $derived(
		segmentStart !== undefined && segmentEnd !== undefined
			? segmentEnd - segmentStart
			: 0
	);

	// Validation
	const isValid = $derived(
		startBpm >= 40 && startBpm <= 300 &&
		endBpm >= 40 && endBpm <= 300 &&
		durationValue > 0
	);

	// Rate limit warnings (only relevant in segment mode)
	const maxSafeEndBpm = $derived(songBpm * 2.0);
	const minSafeEndBpm = $derived(songBpm * 0.25);
	const wouldExceedMaxRate = $derived(isSegmentMode && endBpm > maxSafeEndBpm);
	const wouldExceedMinRate = $derived(isSegmentMode && endBpm < minSafeEndBpm);

	// Update defaults when segment mode changes
	$effect(() => {
		if (isSegmentMode && songBpm) {
			startBpm = songBpm;
			endBpm = Math.min(songBpm * 1.25, songBpm + 40);
		}
	});

	async function handleStart() {
		if (!isValid) return;

		engine = new TempoTrainerEngine();

		engine.onProgress = (p, bpm) => {
			progress = p;
			currentBpm = bpm;
		};

		engine.onComplete = () => {
			isRunning = false;
			progress = 1;
		};

		isRunning = true;
		progress = 0;
		currentBpm = startBpm;

		if (isSegmentMode && audioEngine && segmentStart !== undefined && segmentEnd !== undefined) {
			// Segment mode: loop audio with tempo ramping
			await engine.startSegmentTraining({
				audioEngine,
				songBpm,
				startBpm,
				endBpm,
				durationSeconds,
				segmentStart,
				segmentEnd
			});
		} else {
			// Standalone mode: just metronome
			await engine.startMetronome({
				startBpm,
				endBpm,
				durationSeconds,
				sound
			});
		}
	}

	function handleStop() {
		if (engine) {
			engine.stop();
			engine.dispose();
			engine = null;
		}
		isRunning = false;
		progress = 0;
		currentBpm = 0;

		// Reset audio state if in segment mode
		if (isSegmentMode && audioEngine) {
			audioEngine.setPlaybackRate(1.0);
			audioEngine.clearLoop();
		}
	}

	function handleClose() {
		handleStop();
		onClose();
	}

	function handleStemToggle(index: number) {
		if (onStemToggle && stemStates[index] !== undefined) {
			onStemToggle(index, !stemStates[index]);
		}
	}

	onDestroy(() => {
		if (engine) {
			engine.stop();
			engine.dispose();
		}
	});

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function formatTimeDetailed(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = (seconds % 60).toFixed(1);
		return `${mins}:${secs.padStart(4, '0')}`;
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-white">Tempo Trainer</h2>
		<button
			class="text-gray-400 hover:text-gray-300 text-2xl leading-none"
			onclick={handleClose}
			title="Close"
		>
			&times;
		</button>
	</div>

	<!-- Segment Info (only in segment mode) -->
	{#if isSegmentMode && segmentStart !== undefined && segmentEnd !== undefined}
		<div class="bg-gray-700 rounded-lg px-3 py-2 text-sm">
			<div class="flex items-center justify-between text-gray-300">
				<span>Segment</span>
				<span class="text-white">
					{formatTimeDetailed(segmentStart)} - {formatTimeDetailed(segmentEnd)}
				</span>
			</div>
			<div class="flex items-center justify-between text-gray-400 text-xs mt-1">
				<span>Duration: {segmentDuration.toFixed(1)}s</span>
				<span>Chunk {chunkIndex === -1 ? 'Pre-song' : (chunkIndex ?? 0) + 1}</span>
			</div>
		</div>
	{:else}
		<p class="text-gray-400 text-sm">Practice with a metronome that gradually changes tempo.</p>
	{/if}

	<!-- BPM Settings -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class="block text-sm font-medium text-gray-300 mb-1">
				Starting BPM
			</label>
			<input
				type="number"
				bind:value={startBpm}
				min="40"
				max="300"
				disabled={isRunning}
				class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
			/>
			{#if isSegmentMode}
				<div class="text-xs text-gray-500 mt-1">Song: {songBpm} BPM</div>
			{/if}
		</div>
		<div>
			<label class="block text-sm font-medium text-gray-300 mb-1">
				Ending BPM
			</label>
			<input
				type="number"
				bind:value={endBpm}
				min="40"
				max="300"
				disabled={isRunning}
				class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
			/>
			{#if wouldExceedMaxRate}
				<div class="text-xs text-amber-400 mt-1">Will cap at {maxSafeEndBpm.toFixed(0)} BPM (2x)</div>
			{:else if wouldExceedMinRate}
				<div class="text-xs text-amber-400 mt-1">Will cap at {minSafeEndBpm.toFixed(0)} BPM (0.25x)</div>
			{/if}
		</div>
	</div>

	<!-- Duration Settings -->
	<div class="grid grid-cols-2 gap-4">
		<div>
			<label class="block text-sm font-medium text-gray-300 mb-1">
				Duration
			</label>
			<input
				type="number"
				bind:value={durationValue}
				min="1"
				max={durationUnit === 'minutes' ? 30 : 600}
				disabled={isRunning}
				class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
			/>
		</div>
		<div>
			<label class="block text-sm font-medium text-gray-300 mb-1">
				Unit
			</label>
			<select
				bind:value={durationUnit}
				disabled={isRunning}
				class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
			>
				<option value="seconds">Seconds</option>
				<option value="minutes">Minutes</option>
			</select>
		</div>
	</div>

	<!-- Sound Selection (only in standalone mode) -->
	{#if !isSegmentMode}
		<div>
			<label class="block text-sm font-medium text-gray-300 mb-1">
				Sound
			</label>
			<select
				bind:value={sound}
				disabled={isRunning}
				class="w-full bg-gray-700 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
			>
				<option value="beep">Beep (1000Hz sine)</option>
				<option value="click">Click (noise burst)</option>
				<option value="woodblock">Woodblock (800Hz triangle)</option>
			</select>
		</div>
	{/if}

	<!-- Stem Toggles (only in segment mode with stems) -->
	{#if isSegmentMode && stemStates.length > 0}
		<div>
			<label class="block text-sm font-medium text-gray-300 mb-2">
				Stems
			</label>
			<div class="flex flex-wrap gap-2">
				{#each stemStates as enabled, index}
					<button
						class="px-3 py-1 text-xs rounded transition-colors {enabled
							? 'bg-blue-600 text-white'
							: 'bg-gray-700 text-gray-400'}"
						onclick={() => handleStemToggle(index)}
						disabled={isRunning}
					>
						Stem {index + 1}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Progress Display -->
	{#if isRunning || progress > 0}
		<div class="space-y-2">
			<div class="flex items-center justify-between text-sm">
				<span class="text-gray-400">Progress</span>
				<span class="text-white font-medium">
					{Math.round(currentBpm)} BPM
					{#if isSegmentMode}
						({(currentBpm / songBpm).toFixed(2)}x)
					{/if}
				</span>
			</div>
			<div class="w-full bg-gray-700 rounded-full h-3">
				<div
					class="bg-amber-500 h-3 rounded-full transition-all duration-100"
					style="width: {progress * 100}%"
				></div>
			</div>
			<div class="flex items-center justify-between text-xs text-gray-500">
				<span>{formatTime(progress * durationSeconds)}</span>
				<span>{formatTime(durationSeconds)}</span>
			</div>
		</div>
	{/if}

	<!-- Action Buttons -->
	<div class="flex gap-3">
		{#if isRunning}
			<button
				class="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
				onclick={handleStop}
			>
				Stop
			</button>
		{:else}
			<button
				class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				onclick={handleStart}
				disabled={!isValid}
			>
				Start
			</button>
		{/if}
		<button
			class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg font-medium transition-colors"
			onclick={handleClose}
		>
			Close
		</button>
	</div>

	<!-- Info -->
	<div class="text-xs text-gray-500 space-y-1">
		{#if isSegmentMode}
			<p>The segment will loop while gradually changing tempo from {startBpm} to {endBpm} BPM.</p>
		{:else}
			<p>The metronome will gradually change tempo from {startBpm} to {endBpm} BPM over {durationUnit === 'minutes' ? `${durationValue} minute${durationValue !== 1 ? 's' : ''}` : `${durationValue} second${durationValue !== 1 ? 's' : ''}`}.</p>
		{/if}
		{#if startBpm > endBpm}
			<p class="text-amber-400">Note: Tempo will decrease (slowing down practice).</p>
		{/if}
	</div>
</div>
