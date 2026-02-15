<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import { detectBpmWithStemFallback } from '$lib/utils/bpmDetection';
	import { AudioExportService } from '$lib/audio/AudioExportService';
	import type { BpmDetector } from '$lib/audio/BpmDetector';
	import type { AudioEngine } from '$lib/audio/AudioEngine';
	import type { PersistenceService } from '$lib/persistence/PersistenceService';

	interface Props {
		audioEngine: AudioEngine;
		bpmDetector: BpmDetector;
		persistenceService: PersistenceService;
		onClearAllLoops?: () => void;
		onExportAllLoops?: () => void;
		loopingChunkCount?: number;
	}

	let { audioEngine, bpmDetector, persistenceService, onClearAllLoops, onExportAllLoops, loopingChunkCount = 0 }: Props = $props();

	// Export service for BPM-aware stem downloads
	let exportService = $state(new AudioExportService());

	async function recalculateBpmFromSong() {
		if (!sessionStore.currentSession) return;

		try {
			sessionStore.setIsDetectingBpm(true);
			const detectedBpm = await detectBpmWithStemFallback(audioEngine, bpmDetector);
			await sessionStore.updateBPM(detectedBpm, false); // Reset manual flag
		} catch (error) {
			console.error('BPM recalculation failed:', error);
			// Only show alert if all stems failed (error thrown means all attempts failed)
			alert('Failed to recalculate BPM from song. No detectable beats found in any stem.');
		} finally {
			sessionStore.setIsDetectingBpm(false);
		}
	}

	function incrementTargetBPM() {
		sessionStore.updateTargetBPM(Math.min(300, sessionStore.targetBPM + 1));
	}

	function decrementTargetBPM() {
		sessionStore.updateTargetBPM(Math.max(20, sessionStore.targetBPM - 1));
	}

	function resetTargetBPM() {
		sessionStore.updateTargetBPM(sessionStore.bpm);
	}

	async function handleStemDownload(index: number) {
		// Verify we're in stem mode
		if (!audioEngine.isInStemMode) {
			alert('Stem mode is not active');
			return;
		}

		// Get stem buffers
		const stemBuffers = audioEngine.getStemBuffers();
		if (!stemBuffers || index < 0 || index >= stemBuffers.length) {
			alert('Stem not available for download');
			return;
		}

		const stemBuffer = stemBuffers[index];
		if (!stemBuffer) {
			alert('Stem buffer not available');
			return;
		}

		// Get stem info from session
		if (!sessionStore.currentSession?.stems || index >= sessionStore.currentSession.stems.length) {
			alert('Stem information not available');
			return;
		}

		const stem = sessionStore.currentSession.stems[index];

		try {
			// Generate filename from stem filename, changing extension to .wav
			const baseFilename = stem.filename.replace(/\.[^/.]+$/, '');
			const exportFilename = `${baseFilename}.wav`;

			// Compute playbackRate from BPM settings (same logic as chunk exports)
			// Guard against division by zero
			const playbackRate = sessionStore.bpm > 0 ? sessionStore.targetBPM / sessionStore.bpm : 1;

			// Export the entire stem with BPM adjustment
			await exportService.exportChunk(stemBuffer, 0, stemBuffer.duration, exportFilename, {
				playbackRate
			});
		} catch (error) {
			console.error('Failed to export stem:', error);
			alert('Failed to export stem. Please try again.');
		}
	}
</script>

<div class="space-y-4">
	<!-- Song BPM Control -->
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<label class="text-sm font-medium text-gray-300" for="song-bpm">Song BPM</label>
			<div class="flex items-center gap-2">
				<input
					id="song-bpm"
					type="number"
					value={sessionStore.bpm}
					oninput={(e) =>
						sessionStore.updateBPM(Number((e.target as HTMLInputElement).value), true)}
					class="w-16 rounded bg-gray-700 px-2 py-1 text-center text-sm text-white"
					min="60"
					max="200"
				/>
				<button
					class="rounded bg-blue-600 px-2 py-1 text-xs transition-colors hover:bg-blue-700"
					onclick={recalculateBpmFromSong}
					disabled={sessionStore.isDetectingBpm}
					title="Recalculate BPM from audio"
				>
					{sessionStore.isDetectingBpm ? 'Detecting...' : 'Auto-detect'}
				</button>
			</div>
		</div>
	</div>

	<!-- Target BPM Control -->
	<div class="space-y-2">
		<label for="target-bpm" class="block text-sm font-medium text-gray-300">Practice BPM</label>
		<div class="flex items-center gap-2">
			<button
				class="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600"
				onclick={decrementTargetBPM}
			>
				−
			</button>
			<input
				id="target-bpm"
				type="number"
				value={sessionStore.targetBPM}
				oninput={(e) => sessionStore.updateTargetBPM(Number((e.target as HTMLInputElement).value))}
				class="w-20 rounded bg-gray-700 px-3 py-1 text-center text-sm text-white"
				min="40"
				max="300"
			/>
			<button
				class="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600"
				onclick={incrementTargetBPM}
			>
				+
			</button>
			<button
				class="rounded bg-amber-600 px-3 py-1 text-sm hover:bg-amber-700"
				onclick={resetTargetBPM}
				title="Reset to song BPM"
			>
				Reset
			</button>
		</div>

		<!-- Speed Indicator -->
		<div class="mt-2 rounded bg-gray-800 p-2">
			<div class="flex items-center justify-between text-xs">
				<span class="text-gray-400">Playback Speed</span>
				<span class="font-medium text-blue-400">{sessionStore.playbackSpeedPercentage}%</span>
			</div>
			<div class="mt-1 h-1.5 w-full rounded-full bg-gray-700">
				<div
					class="h-1.5 rounded-full bg-blue-600 transition-all duration-200"
					style="width: {Math.min(100, Math.max(0, sessionStore.playbackSpeedPercentage))}%"
				></div>
			</div>
		</div>
	</div>

	<!-- Loop Controls -->
	{#if loopingChunkCount > 0}
		<div class="space-y-2 border-t border-gray-700 pt-4">
			<p class="text-sm font-medium text-gray-300">Loop Controls ({loopingChunkCount} chunks)</p>
			<div class="flex gap-2">
				<button
					class="flex-1 rounded bg-gray-700 px-3 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-600"
					onclick={onExportAllLoops}
				>
					Export Loops
				</button>
				<button
					class="flex-1 rounded bg-red-700 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-600"
					onclick={onClearAllLoops}
				>
					Clear Loops
				</button>
			</div>
		</div>
	{/if}

	<!-- Stem Controls (only for stem sessions) -->
	{#if sessionStore.currentSession?.mode === 'stem' && sessionStore.currentSession.stems}
		<div class="space-y-2 border-t border-gray-700 pt-4">
			<label class="block text-sm font-medium text-gray-300">Stem Controls</label>
			<div class="space-y-2">
				{#each sessionStore.currentSession.stems as stem, index}
					<div class="flex items-center gap-2">
						<button
							class="flex flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors
								{stem.enabled
								? 'bg-blue-600 text-white hover:bg-blue-700'
								: 'bg-gray-700 text-gray-300 hover:bg-gray-600'}"
							onclick={async () => {
								const newEnabled = !stem.enabled;
								audioEngine.setStemEnabled(index, newEnabled);
								// Create new stems array with new stem object (immutable update for Svelte 5 reactivity)
								const newStems = sessionStore.currentSession!.stems!.map((s, i) =>
									i === index ? { ...s, enabled: newEnabled } : s
								);
								sessionStore.setCurrentSession({
									...sessionStore.currentSession!,
									stems: newStems
								});
								// Persist the change
								await persistenceService.updateStemEnabled(
									sessionStore.currentSession!.id,
									stem.id,
									newEnabled
								);
							}}
						>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								<div
									class="h-3 w-3 flex-shrink-0 rounded-full"
									style="background-color: {stem.color || '#3b82f6'}"
								></div>
								<span class="truncate" title={stem.filename}>
									{stem.filename.replace(/\.[^/.]+$/, '')}
								</span>
							</div>
							<span class="flex-shrink-0 text-xs opacity-75">
								{stem.enabled ? '✓' : '✗'}
							</span>
						</button>
						<button
							class="flex-shrink-0 rounded-lg bg-gray-700 px-2 py-2 text-sm transition-colors hover:bg-gray-600"
							title="Download {stem.filename} (BPM-adjusted)"
							onclick={() => handleStemDownload(index)}
						>
							⬇️
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
