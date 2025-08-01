<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { AudioEngine } from '$lib/audio/AudioEngine';
	import { BpmDetector } from '$lib/audio/BpmDetector';
	import { PersistenceService } from '$lib/persistence/PersistenceService';
	import TagManager from '$lib/components/TagManager.svelte';
	import BeatGrid from '$lib/components/BeatGrid.svelte';
	import type { TrackSession, Tag } from '$lib/types';

	// Core services
	let audioEngine: AudioEngine;
	let bpmDetector: BpmDetector;
	let persistenceService: PersistenceService;

	// Application state
	let currentSession: TrackSession | null = null;
	let isPlaying = false;
	let currentTime = 0;
	let duration = 0;
	let bpm = 120;
	let beatOffset = 0; // in milliseconds
	let isArmedForTagging = false;
	let armedTagId: string | null = null;
	let isDragOver = false;

	// UI state
	let currentBeatIndex = -1;
	let fileInput: HTMLInputElement;
	let isDetectingBpm = false;

	onMount(async () => {
		// Initialize services
		audioEngine = new AudioEngine();
		bpmDetector = new BpmDetector();
		persistenceService = new PersistenceService();

		// Setup audio engine event handlers
		audioEngine.onTimeUpdate = (time) => {
			currentTime = time;
			updateCurrentBeat();
		};

		audioEngine.onEnded = () => {
			isPlaying = false;
		};

		// Setup BPM detector event handlers
		bpmDetector.onBpmChanged = (newBpm) => {
			// Only update if BPM wasn't manually set
			if (!currentSession?.manualBpm) {
				bpm = newBpm;
			}
		};

		bpmDetector.onDetectionError = (error) => {
			console.error('BPM detection failed:', error);
			alert('Failed to detect BPM automatically. Using default tempo of 120 BPM.');
			bpm = 120;
		};

		// Setup keyboard shortcuts (browser only)
		if (typeof document !== 'undefined') {
			document.addEventListener('keydown', handleKeydown);
		}

		// Try to load the last session
		await loadLastSession();

		// Setup beforeunload warning for unsaved changes (browser only)
		if (typeof window !== 'undefined') {
			window.addEventListener('beforeunload', handleBeforeUnload);
		}
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') {
			document.removeEventListener('keydown', handleKeydown);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('beforeunload', handleBeforeUnload);
		}
		audioEngine?.dispose();
	});

	async function loadLastSession() {
		try {
			const lastSession = await persistenceService.loadCurrentSession();
			if (lastSession) {
				currentSession = lastSession;
				await audioEngine.loadTrack(lastSession.mp3Blob);
				duration = audioEngine.getDuration();
				
				// Run BPM detection on existing session
				const audioBuffer = audioEngine.getAudioBuffer();
				if (audioBuffer) {
					try {
						isDetectingBpm = true;
						const detectedBpm = await bpmDetector.detectBpm(audioBuffer);
						bpm = detectedBpm;
						await updateSessionBpm(false);
					} catch (error) {
						console.error('Auto BPM detection failed:', error);
						// Use saved BPM
						bpm = lastSession.bpm;
					} finally {
						isDetectingBpm = false;
					}
				} else {
					bpm = lastSession.bpm;
				}
				beatOffset = lastSession.beatOffset;
			}
		} catch (error) {
			console.error('Failed to load last session:', error);
		}
	}

	async function handleFilesDrop(files: FileList) {
		const file = files[0];
		if (!file || !file.type.startsWith('audio/')) {
			alert('Please drop an MP3 or other audio file');
			return;
		}

		try {
			// Create new session
			currentSession = await persistenceService.createSession(file);
			
			// Load audio
			await audioEngine.loadTrack(currentSession.mp3Blob);
			duration = audioEngine.getDuration();
			bpm = currentSession.bpm;
			beatOffset = currentSession.beatOffset;
			
			// Run automatic BPM detection
			const audioBuffer = audioEngine.getAudioBuffer();
			if (audioBuffer) {
				try {
					isDetectingBpm = true;
					const detectedBpm = await bpmDetector.detectBpm(audioBuffer);
					bpm = detectedBpm;
					await updateSessionBpm(false);
				} catch (error) {
					console.error('Auto BPM detection failed:', error);
					// Use default BPM
					bpm = 120;
					await updateSessionBpm(false);
				} finally {
					isDetectingBpm = false;
				}
			}
			
		} catch (error) {
			console.error('Failed to load track:', error);
			alert('Failed to load audio file. Please try another file.');
		}
	}

	async function updateSessionBpm(isManual = false) {
		if (!currentSession) return;
		
		try {
			await persistenceService.updateSessionBpm(currentSession.id, bpm, duration, isManual);
			// Reload session to get updated beats
			const updatedSession = await persistenceService.loadSession(currentSession.id);
			if (updatedSession) {
				currentSession = updatedSession;
			}
		} catch (error) {
			console.error('Failed to update BPM:', error);
		}
	}

	async function updateSessionOffset() {
		if (!currentSession) return;
		
		try {
			await persistenceService.updateSessionOffset(currentSession.id, beatOffset, duration);
			// Reload session to get updated beats
			const updatedSession = await persistenceService.loadSession(currentSession.id);
			if (updatedSession) {
				currentSession = updatedSession;
			}
		} catch (error) {
			console.error('Failed to update offset:', error);
		}
	}

	async function recalculateBpmFromSong() {
		if (!currentSession) return;
		
		const audioBuffer = audioEngine.getAudioBuffer();
		if (audioBuffer) {
			try {
				isDetectingBpm = true;
				const detectedBpm = await bpmDetector.detectBpm(audioBuffer);
				bpm = detectedBpm;
				await updateSessionBpm(false); // Reset manual flag
			} catch (error) {
				console.error('BPM recalculation failed:', error);
				alert('Failed to recalculate BPM from song.');
			} finally {
				isDetectingBpm = false;
			}
		}
	}

	function updateCurrentBeat() {
		if (!currentSession) return;
		
		// Find current beat based on time
		const beatIndex = currentSession.beats.findIndex((beat, index) => {
			const nextBeat = currentSession!.beats[index + 1];
			return currentTime >= beat.time && (!nextBeat || currentTime < nextBeat.time);
		});
		
		currentBeatIndex = beatIndex;
	}

	async function togglePlayback() {
		if (!audioEngine || !currentSession) return;

		try {
			if (isPlaying) {
				audioEngine.pause();
				isPlaying = false;
			} else {
				await audioEngine.play();
				isPlaying = true;
			}
		} catch (error) {
			console.error('Playback error:', error);
		}
	}

	async function handleKeydown(event: KeyboardEvent) {
		// Prevent default for our shortcuts
		if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'Enter') {
			event.preventDefault();
		}

		switch (event.code) {
			case 'Space':
				if (isArmedForTagging && armedTagId && currentSession) {
					// Tag toggling mode
					await toggleCurrentBeatTag();
				} else {
					// Regular playback
					await togglePlayback();
				}
				break;
				
			case 'ArrowLeft':
				await jumpToPreviousBoundary();
				break;
				
			case 'ArrowRight':
				await jumpToNextBoundary();
				break;
		}
	}

	async function toggleCurrentBeatTag() {
		if (!currentSession || !armedTagId || currentBeatIndex < 0) return;
		
		try {
			await persistenceService.toggleBeatTag(currentSession.id, currentBeatIndex, armedTagId);
			// Reload session to get updated beats
			const updatedSession = await persistenceService.loadSession(currentSession.id);
			if (updatedSession) {
				currentSession = updatedSession;
			}
		} catch (error) {
			console.error('Failed to toggle tag:', error);
		}
	}

	async function jumpToPreviousBoundary() {
		if (!currentSession) return;
		
		// Jump to previous 8-beat boundary
		const offsetInSeconds = beatOffset / 1000;
		const adjustedTime = currentTime - offsetInSeconds;
		const currentBeat = Math.floor(adjustedTime / (60 / bpm));
		const targetBeat = Math.max(0, Math.floor(currentBeat / 8) * 8 - 8);
		const targetTime = (targetBeat * (60 / bpm)) + offsetInSeconds;
		
		await audioEngine.seekTo(targetTime);
	}

	async function jumpToNextBoundary() {
		if (!currentSession) return;
		
		// Jump to next 8-beat boundary
		const offsetInSeconds = beatOffset / 1000;
		const adjustedTime = currentTime - offsetInSeconds;
		const currentBeat = Math.floor(adjustedTime / (60 / bpm));
		const targetBeat = Math.ceil((currentBeat + 1) / 8) * 8;
		const targetTime = Math.min((targetBeat * (60 / bpm)) + offsetInSeconds, duration);
		
		await audioEngine.seekTo(targetTime);
	}

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		// Add unsaved changes warning if needed
		// For now, we auto-save everything, so this is just a placeholder
		return;
	}

	// Drag and drop handlers
	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		
		if (event.dataTransfer?.files) {
			handleFilesDrop(event.dataTransfer.files);
		}
	}

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	// Tag management handlers
	async function handleTagCreated(event: CustomEvent<{ id: string; label: string; color: string }>) {
		if (!currentSession) return;
		
		const { id, label, color } = event.detail;
		try {
			await persistenceService.addTag(currentSession.id, id, label, color);
			const updatedSession = await persistenceService.loadSession(currentSession.id);
			if (updatedSession) {
				currentSession = updatedSession;
			}
		} catch (error) {
			console.error('Failed to create tag:', error);
		}
	}

	async function handleTagDeleted(event: CustomEvent<{ id: string }>) {
		if (!currentSession) return;
		
		const { id } = event.detail;
		try {
			await persistenceService.removeTag(currentSession.id, id);
			const updatedSession = await persistenceService.loadSession(currentSession.id);
			if (updatedSession) {
				currentSession = updatedSession;
			}
			// Disarm if this was the armed tag
			if (armedTagId === id) {
				armedTagId = null;
				isArmedForTagging = false;
			}
		} catch (error) {
			console.error('Failed to delete tag:', error);
		}
	}

	function handleTagArmed(event: CustomEvent<{ id: string | null }>) {
		armedTagId = event.detail.id;
		isArmedForTagging = armedTagId !== null;
	}

	function handleDropZoneClick() {
		fileInput?.click();
	}
</script>

<main class="min-h-screen bg-gray-900 text-white">
	<!-- Header -->
	<header class="bg-gray-800 border-b border-gray-700 p-4">
		<div class="max-w-7xl mx-auto">
			<h1 class="text-2xl font-bold text-blue-400">Music Nerd</h1>
			<p class="text-gray-400 text-sm">Analyze music structure for dance practice</p>
		</div>
	</header>

	<!-- Main Content -->
	<div class="max-w-7xl mx-auto p-4 space-y-6">
		
		{#if !currentSession}
			<!-- Drop Zone -->
			<div 
				class="border-2 border-dashed border-gray-600 rounded-lg p-12 text-center transition-colors
					{isDragOver ? 'border-blue-400 bg-blue-400/10' : 'hover:border-gray-500'}"
				role="button"
				tabindex="0"
				aria-label="Drop MP3 file here or click to browse"
				on:dragover={handleDragOver}
				on:dragleave={handleDragLeave}
				on:drop={handleDrop}
				on:click={handleDropZoneClick}
				on:keydown={(e) => e.key === 'Enter' && handleDropZoneClick()}
			>
				<div class="space-y-4">
					<div class="text-4xl">🎵</div>
					<h2 class="text-xl font-semibold">Drop your MP3 file here</h2>
					<p class="text-gray-400">
						Or click to browse files
					</p>
					<input 
						type="file" 
						accept="audio/*"
						class="hidden"
						bind:this={fileInput}
						on:change={(e) => {
							const target = e.target as HTMLInputElement;
							if (target.files) {
								handleFilesDrop(target.files);
							}
						}}
					/>
				</div>
			</div>
		{:else}
			<!-- Track Info -->
			<div class="bg-gray-800 rounded-lg p-4">
				<h2 class="text-lg font-semibold mb-2">{currentSession.filename}</h2>
				<div class="flex items-center space-x-4 text-sm text-gray-400 mb-3">
					<span>Duration: {formatTime(duration)}</span>
					<span>Beats: {currentSession.beats.length}</span>
				</div>
				
				<!-- BPM Controls -->
				<div class="flex items-center space-x-3 mb-3">
					<label class="text-sm text-gray-300">BPM:</label>
					<input 
						type="number" 
						bind:value={bpm}
						on:input={async () => await updateSessionBpm(true)}
						class="bg-gray-700 text-white px-2 py-1 rounded w-16 text-sm"
						min="60" 
						max="200"
					/>
					<button 
						class="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-xs transition-colors"
						on:click={recalculateBpmFromSong}
						disabled={isDetectingBpm}
					>
						{isDetectingBpm ? 'Calculating...' : 'Recalculate'}
					</button>
				</div>

				<!-- Beat Offset Slider -->
				<div class="space-y-2">
					<label class="text-sm text-gray-300 flex items-center justify-between">
						<span>Beat Offset:</span>
						<span class="text-xs text-gray-400">
							{beatOffset > 0 ? '+' : ''}{beatOffset}ms
						</span>
					</label>
					<div class="relative">
						<input 
							type="range" 
							bind:value={beatOffset}
							on:input={updateSessionOffset}
							min={-(60 / bpm) * 1000}
							max={(60 / bpm) * 1000}
							step="10"
							class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
						/>
						<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-500 pointer-events-none"></div>
					</div>
					<div class="flex justify-between text-xs text-gray-500">
						<span>-{Math.round((60 / bpm) * 1000)}ms</span>
						<span>0</span>
						<span>+{Math.round((60 / bpm) * 1000)}ms</span>
					</div>
				</div>
			</div>

			<!-- BPM Detection Status -->
			{#if isDetectingBpm}
				<div class="bg-blue-900/20 border border-blue-600 rounded-lg p-4">
					<h3 class="text-lg font-semibold text-blue-400 mb-2">🎵 Detecting BPM...</h3>
					<p class="text-gray-300">
						Analyzing audio to automatically detect the tempo. This may take a few seconds.
					</p>
				</div>
			{/if}


			<!-- Transport Controls -->
			<div class="bg-gray-800 rounded-lg p-4">
				<div class="flex items-center space-x-4">
					<button 
						class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
						on:click={togglePlayback}
					>
						{isPlaying ? '⏸️' : '▶️'}
						{isPlaying ? 'Pause' : 'Play'}
					</button>
					
					<div class="flex-1">
						<div class="text-sm text-gray-400 mb-1">
							{formatTime(currentTime)} / {formatTime(duration)}
						</div>
						<div class="w-full bg-gray-700 rounded-full h-2">
							<div 
								class="bg-blue-600 h-2 rounded-full transition-all duration-100"
								style="width: {duration > 0 ? (currentTime / duration) * 100 : 0}%"
							></div>
						</div>
					</div>
					
					<div class="text-sm text-gray-400">
						Beat: {currentBeatIndex >= 0 ? currentBeatIndex + 1 : '-'}
					</div>
				</div>
			</div>

			<!-- Beat Grid -->
			{#if currentSession.beats.length > 0}
				<BeatGrid 
					beats={currentSession.beats}
					tags={currentSession.tags}
					{currentBeatIndex}
					{currentTime}
					{bpm}
				/>
			{/if}

			<!-- Tag Manager -->
				<TagManager 
					tags={currentSession.tags}
					{armedTagId}
					on:tag-created={handleTagCreated}
					on:tag-deleted={handleTagDeleted}
					on:tag-armed={handleTagArmed}
				/>

			<!-- Keyboard Shortcuts Help -->
			<div class="bg-gray-800 rounded-lg p-4">
				<h3 class="text-sm font-semibold text-gray-300 mb-2">Keyboard Shortcuts</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-400">
					<div><kbd class="bg-gray-700 px-1 rounded">Space</kbd> {isArmedForTagging ? 'Tag current beat' : 'Play/Pause'}</div>
					<div><kbd class="bg-gray-700 px-1 rounded">←</kbd> Previous 8-beat boundary</div>
					<div><kbd class="bg-gray-700 px-1 rounded">→</kbd> Next 8-beat boundary</div>
				</div>
			</div>
		{/if}
	</div>
</main>

<style>
	kbd {
		font-family: monospace;
		font-size: 0.75rem;
	}

	.slider::-webkit-slider-thumb {
		appearance: none;
		height: 16px;
		width: 16px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1f2937;
	}

	.slider::-moz-range-thumb {
		height: 16px;
		width: 16px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1f2937;
	}
</style>
