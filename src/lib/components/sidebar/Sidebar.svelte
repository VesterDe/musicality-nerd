<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import PlaybackSettings from './PlaybackSettings.svelte';
	import BeatOffsetSettings from './BeatOffsetSettings.svelte';
	import DisplaySettings from './DisplaySettings.svelte';
	import AnnotationSettings from './AnnotationSettings.svelte';
	import InfoBar from './InfoBar.svelte';
	import type { AudioEngine } from '$lib/audio/AudioEngine';
	import type { BpmDetector } from '$lib/audio/BpmDetector';
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
	
	// Initialize panel states from localStorage or defaults
	function getInitialPanelStates() {
		const defaults = {
			info: true,
			playback: true,
			beatOffset: false,
			display: false,
			annotations: false,
			keyboardShortcuts: false
		};
		
		if (typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem('sidebar-panels');
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					return { ...defaults, ...parsed };
				} catch (e) {
					console.error('Failed to parse saved panel states:', e);
				}
			}
		}
		
		return defaults;
	}
	
	// Track which accordion panels are open
	let openPanels = $state(getInitialPanelStates());
	
	// Toggle panel open/close state
	function togglePanel(panel: keyof typeof openPanels) {
		openPanels[panel] = !openPanels[panel];
		
		// Save panel states to localStorage
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('sidebar-panels', JSON.stringify(openPanels));
		}
	}
</script>

<aside class="w-full lg:w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto h-full" style="overflow-anchor: none;">
	<div class="p-4 space-y-2">
		<!-- Playback Settings -->
		<div class="bg-gray-900 rounded-lg overflow-hidden">
			<button
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
				onclick={() => togglePanel('playback')}
			>
				<span class="text-sm font-medium text-gray-200">Playback Settings</span>
				<svg 
					class="w-4 h-4 text-gray-400 transition-transform duration-200 {openPanels.playback ? 'rotate-180' : ''}"
					fill="none" 
					stroke="currentColor" 
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if openPanels.playback}
				<div class="px-4 pb-4 pt-2 border-t border-gray-700">
					<PlaybackSettings {audioEngine} {bpmDetector} {persistenceService} {onClearAllLoops} {onExportAllLoops} {loopingChunkCount} />
				</div>
			{/if}
		</div>
		
		<!-- Beat Offset Settings -->
		<div class="bg-gray-900 rounded-lg overflow-hidden">
			<button
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
				onclick={() => togglePanel('beatOffset')}
			>
				<span class="text-sm font-medium text-gray-200">Beat Offset</span>
				<svg 
					class="w-4 h-4 text-gray-400 transition-transform duration-200 {openPanels.beatOffset ? 'rotate-180' : ''}"
					fill="none" 
					stroke="currentColor" 
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if openPanels.beatOffset}
				<div class="px-4 pb-4 pt-2 border-t border-gray-700">
					<BeatOffsetSettings />
				</div>
			{/if}
		</div>
		
		<!-- Display Settings -->
		<div class="bg-gray-900 rounded-lg overflow-hidden">
			<button
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
				onclick={() => togglePanel('display')}
			>
				<span class="text-sm font-medium text-gray-200">Display</span>
				<svg 
					class="w-4 h-4 text-gray-400 transition-transform duration-200 {openPanels.display ? 'rotate-180' : ''}"
					fill="none" 
					stroke="currentColor" 
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if openPanels.display}
				<div class="px-4 pb-4 pt-2 border-t border-gray-700">
					<DisplaySettings />
				</div>
			{/if}
		</div>
		
		<!-- Annotation Settings -->
		<div class="bg-gray-900 rounded-lg overflow-hidden">
			<button
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
				onclick={() => togglePanel('annotations')}
			>
				<span class="text-sm font-medium text-gray-200">Annotations</span>
				<svg 
					class="w-4 h-4 text-gray-400 transition-transform duration-200 {openPanels.annotations ? 'rotate-180' : ''}"
					fill="none" 
					stroke="currentColor" 
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if openPanels.annotations}
				<div class="px-4 pb-4 pt-2 border-t border-gray-700">
					<AnnotationSettings />
				</div>
			{/if}
		</div>
		
		<!-- Info Bar -->
		<div class="bg-gray-900 rounded-lg overflow-hidden">
			<button
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
				onclick={() => togglePanel('info')}
			>
				<span class="text-sm font-medium text-gray-200">Session Info</span>
				<svg
					class="w-4 h-4 text-gray-400 transition-transform duration-200 {openPanels.info ? 'rotate-180' : ''}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if openPanels.info}
				<div class="px-4 pb-4 pt-2 border-t border-gray-700">
					<InfoBar />
				</div>
			{/if}
		</div>

		<!-- Keyboard Shortcuts -->
		<div class="bg-gray-900 rounded-lg overflow-hidden">
			<button
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-700 transition-colors"
				onclick={() => togglePanel('keyboardShortcuts')}
			>
				<span class="text-sm font-medium text-gray-200">Keyboard Shortcuts</span>
				<svg 
					class="w-4 h-4 text-gray-400 transition-transform duration-200 {openPanels.keyboardShortcuts ? 'rotate-180' : ''}"
					fill="none" 
					stroke="currentColor" 
					viewBox="0 0 24 24"
				>
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>
			{#if openPanels.keyboardShortcuts}
				<div class="px-4 pb-4 pt-2 border-t border-gray-700">
					<div class="space-y-2 text-xs text-gray-400">
						<div><kbd class="bg-gray-700 px-1 rounded">Space</kbd> Play/Pause</div>
						<div><kbd class="bg-gray-700 px-1 rounded">←</kbd> Jump back 8 beats</div>
						<div><kbd class="bg-gray-700 px-1 rounded">→</kbd> Jump forward 8 beats</div>
						<div><kbd class="bg-gray-700 px-1 rounded">F</kbd> Scroll to playhead</div>
						<div class="pt-2 border-t border-gray-700">
							<div><kbd class="bg-gray-700 px-1 rounded">M</kbd> Toggle annotation mode</div>
							<div><kbd class="bg-gray-700 px-1 rounded">A</kbd> Create annotation (hold while playing)</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</aside>