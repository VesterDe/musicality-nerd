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
	}
	
	let { audioEngine, bpmDetector, persistenceService }: Props = $props();
	
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
			const playbackRate = sessionStore.bpm > 0 
				? sessionStore.targetBPM / sessionStore.bpm 
				: 1;
			
			// Export the entire stem with BPM adjustment
			await exportService.exportChunk(
				stemBuffer,
				0,
				stemBuffer.duration,
				exportFilename,
				{ playbackRate }
			);
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
					oninput={(e) => sessionStore.updateBPM(Number((e.target as HTMLInputElement).value), true)}
					class="bg-gray-700 text-white px-2 py-1 rounded w-16 text-sm text-center"
					min="60" 
					max="200"
				/>
				<button 
					class="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs transition-colors cursor-pointer"
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
		<label for="target-bpm" class="text-sm font-medium text-gray-300 block">Practice BPM</label>
		<div class="flex items-center gap-2">
			<button 
				class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm cursor-pointer"
				onclick={decrementTargetBPM}
			>
				−
			</button>
			<input 
				id="target-bpm"
				type="number"
				value={sessionStore.targetBPM}
				oninput={(e) => sessionStore.updateTargetBPM(Number((e.target as HTMLInputElement).value))}
				class="bg-gray-700 text-white px-3 py-1 rounded w-20 text-sm text-center"
				min="40"
				max="300"
			/>
			<button 
				class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm cursor-pointer"
				onclick={incrementTargetBPM}
			>
				+
			</button>
			<button 
				class="px-3 py-1 bg-amber-600 hover:bg-amber-700 rounded text-sm cursor-pointer"
				onclick={resetTargetBPM}
				title="Reset to song BPM"
			>
				Reset
			</button>
		</div>
		
		<!-- Speed Indicator -->
		<div class="mt-2 p-2 bg-gray-800 rounded">
			<div class="flex justify-between items-center text-xs">
				<span class="text-gray-400">Playback Speed</span>
				<span class="text-blue-400 font-medium">{sessionStore.playbackSpeedPercentage}%</span>
			</div>
			<div class="mt-1 w-full bg-gray-700 rounded-full h-1.5">
				<div 
					class="bg-blue-600 h-1.5 rounded-full transition-all duration-200"
					style="width: {Math.min(100, Math.max(0, sessionStore.playbackSpeedPercentage))}%"
				></div>
			</div>
		</div>
	</div>
	
	<!-- Stem Controls (only for stem sessions) -->
	{#if sessionStore.currentSession?.mode === 'stem' && sessionStore.currentSession.stems}
		<div class="space-y-2 pt-4 border-t border-gray-700">
			<label class="text-sm font-medium text-gray-300 block">Stem Controls</label>
			<div class="space-y-2">
				{#each sessionStore.currentSession.stems as stem, index}
					<div class="flex items-center gap-2">
						<button
							class="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-between cursor-pointer
								{stem.enabled 
									? 'bg-blue-600 hover:bg-blue-700 text-white' 
									: 'bg-gray-700 hover:bg-gray-600 text-gray-300'}"
							onclick={async () => {
								const newEnabled = !stem.enabled;
								audioEngine.setStemEnabled(index, newEnabled);
								// Update session state
								stem.enabled = newEnabled;
								sessionStore.setCurrentSession({ ...sessionStore.currentSession });
								// Persist the change
								await persistenceService.updateStemEnabled(sessionStore.currentSession.id, stem.id, newEnabled);
							}}
						>
							<div class="flex items-center gap-2 flex-1 min-w-0">
								<div 
									class="w-3 h-3 rounded-full flex-shrink-0"
									style="background-color: {stem.color || '#3b82f6'}"
								></div>
								<span class="truncate" title={stem.filename}>
									{stem.filename.replace(/\.[^/.]+$/, '')}
								</span>
							</div>
							<span class="text-xs opacity-75 flex-shrink-0">
								{stem.enabled ? '✓' : '✗'}
							</span>
						</button>
						<button
							class="px-2 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors flex-shrink-0 cursor-pointer"
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