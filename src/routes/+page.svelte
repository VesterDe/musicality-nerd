<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { del } from 'idb-keyval';
	import { AudioEngine } from '$lib/audio/AudioEngine';
	import { BpmDetector } from '$lib/audio/BpmDetector';
	import { PersistenceService } from '$lib/persistence/PersistenceService';
	import SvgWaveformDisplay from '$lib/components/SvgWaveformDisplay.svelte';
	import SongList from '$lib/components/SongList.svelte';
	import AnnotationModePanel from '$lib/components/AnnotationModePanel.svelte';
	import type { TrackSession, Annotation } from '$lib/types';

	// Constants
	const CURRENT_SESSION_KEY = 'current-session';

	// Core services
	let audioEngine: AudioEngine = $state(new AudioEngine());
	let bpmDetector: BpmDetector = $state(new BpmDetector());
	let persistenceService: PersistenceService = $state(new PersistenceService());

	// Application state
	let currentSession: TrackSession | null = $state(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let bpm = $state(0);
	let beatOffset = $state(0); // in milliseconds
	let sliderBeatOffset = $state(0); // slider display value, decoupled from beatOffset
	let isSessionInitializing = $state(false);
	
	// Playback speed controls
	let targetBPM = $state(0); // Desired BPM for practice

	// UI state
	let currentBeatIndex = $state(-1);
	let isDetectingBpm = $state(false);
	let loopingChunkIndices = $state(new Set<number>());
	let autoFollow = $state(false);
	let isAnnotationModalOpen = $state(false);
	let offsetUpdateTimeout: number | null = $state(null);
	let isDraggingProgress = $state(false);
	
	// Annotation mode state
	let isAnnotationMode = $state(false);
	let activeAnnotationSession: { startTime: number; id: string } | null = $state(null);
	let annotationCounter = $state(1);
	let isAKeyPressed = $state(false); // Track physical key state
	let annotationTemplate = $state({
		name: 'Mark',
		color: '#00ff00'
	});
	let previewAnnotation: Annotation | null = $state(null);
	let previewTimeout: number | null = $state(null);
	
	onMount(async () => {
		// Initialize services
		audioEngine = new AudioEngine();
		bpmDetector = new BpmDetector();
		persistenceService = new PersistenceService();

		// Setup audio engine event handlers
		audioEngine.onTimeUpdate = (time) => {
			// Only update currentTime if user is not dragging the progress slider
			if (!isDraggingProgress) {
				currentTime = time;
			}
			updateCurrentBeat();
			// Keep UI state in sync with audio engine state
			isPlaying = audioEngine.playing;
		};

		audioEngine.onEnded = () => {
			isPlaying = false;
			// Clear any active annotation session and key state when playback ends
			activeAnnotationSession = null;
			isAKeyPressed = false;
		};

		// Setup BPM detector event handlers
		bpmDetector.onBpmChanged = (newBpm) => {
			// Only update if BPM wasn't manually set
			if (!currentSession?.manualBpm) {
				bpm = newBpm;
        updatePlaybackSpeed();
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
			document.addEventListener('keyup', handleKeyup);
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
			document.removeEventListener('keyup', handleKeyup);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('beforeunload', handleBeforeUnload);
		}
		audioEngine?.dispose();
	});

	async function loadLastSession() {
		try {
			isSessionInitializing = true;
			const lastSession = await persistenceService.loadCurrentSession();
			if (lastSession) {
				await loadSessionData(lastSession);
			}
		} catch (error) {
			console.error('Failed to load last session:', error);
		} finally {
			isSessionInitializing = false;
		}
	}

	async function loadSessionData(session: TrackSession): Promise<void> {
		// Ensure backwards compatibility for annotations
		if (!session.annotations) {
			session.annotations = [];
		}
		
		// Load audio first
		await audioEngine.loadTrack(session.mp3Blob);
		duration = audioEngine.getDuration();
		
		// Initialize local state from session
		let finalBpm = session.bpm;
		let finalBeatOffset = Math.round(session.beatOffset);
		
		// Initialize speed controls
		// Use saved targetBPM if it exists and is not 0, otherwise use the song's BPM
    console.log('session.targetBPM', session.targetBPM, finalBpm);
		targetBPM = (session.targetBPM && session.targetBPM > 0) ? session.targetBPM : finalBpm;
		updatePlaybackSpeed();
		
		// Run BPM detection if not manually set
		if (!session.manualBpm) {
			const audioBuffer = audioEngine.getAudioBuffer();
			if (audioBuffer) {
				try {
					isDetectingBpm = true;
					const detectedBpm = await bpmDetector.detectBpm(audioBuffer);
					finalBpm = detectedBpm;
				} catch (error) {
					console.error('Auto BPM detection failed:', error);
					// Keep existing BPM from session
				} finally {
					isDetectingBpm = false;
				}
			}
		}
		
		// Update session with final values if BPM changed
		if (finalBpm !== session.bpm) {
			const updatedSession = await persistenceService.updateSessionBpm(session.id, finalBpm, duration, false);
			session.bpm = updatedSession.bpm;
			session.beats = updatedSession.beats;
		}
		
		// Set all state at once after everything is ready
		bpm = finalBpm;
		beatOffset = finalBeatOffset;
		sliderBeatOffset = finalBeatOffset; // Keep slider in sync
		currentSession = session;
	}

	async function handleSongSelected(sessionId: string) {
		try {
			isSessionInitializing = true;
			
			// Set as current session and load it
			await persistenceService.setCurrentSession(sessionId);
			const session = await persistenceService.loadSession(sessionId);
			
			if (session) {
				await loadSessionData(session);
			}
		} catch (error) {
			console.error('Failed to load selected song:', error);
			alert('Failed to load song. Please try again.');
		} finally {
			isSessionInitializing = false;
		}
	}

	async function handleFilesDrop(files: FileList) {
		const file = files[0];
		if (!file || !file.type.startsWith('audio/')) {
			alert('Please drop an MP3 or other audio file');
			return;
		}

		try {
			isSessionInitializing = true;
			
			// Create new session
			const newSession = await persistenceService.createSession(file);
			
			// Load audio
			await audioEngine.loadTrack(newSession.mp3Blob);
			duration = audioEngine.getDuration();
			
			// Initialize local state
			let finalBpm = 120; // Default BPM
			let finalBeatOffset = 0; // Default offset
			
			// Run automatic BPM detection
			const audioBuffer = audioEngine.getAudioBuffer();
			if (audioBuffer) {
				try {
					isDetectingBpm = true;
					const detectedBpm = await bpmDetector.detectBpm(audioBuffer);
					finalBpm = detectedBpm;
				} catch (error) {
					console.error('Auto BPM detection failed:', error);
					// Use default BPM
					finalBpm = 120;
				} finally {
					isDetectingBpm = false;
				}
			}
			
			// Update session with final BPM and regenerate beats
			const updatedSession = await persistenceService.updateSessionBpm(newSession.id, finalBpm, duration, false);
			
			// Set all state at once after everything is ready
			bpm = finalBpm;
			beatOffset = finalBeatOffset;
			sliderBeatOffset = finalBeatOffset; // Keep slider in sync
			currentSession = updatedSession;
			
		} catch (error) {
			console.error('Failed to load track:', error);
			alert('Failed to load audio file. Please try another file.');
		} finally {
			isSessionInitializing = false;
		}
	}

	async function updateSessionBpm(isManual = false) {
		if (!currentSession) return;
		
		try {
			const updatedSession = await persistenceService.updateSessionBpm(currentSession.id, bpm, duration, isManual);
			currentSession = updatedSession;
			// When BPM changes, update target BPM to match if not manually set
			if (!isManual) {
				targetBPM = bpm;
			}
		} catch (error) {
			console.error('Failed to update BPM:', error);
		}
	}

	async function updateSessionOffset() {
		if (!currentSession) return;
		
		try {
			const updatedSession = await persistenceService.updateSessionOffset(currentSession.id, beatOffset, duration);
			currentSession = updatedSession;
		} catch (error) {
			console.error('Failed to update offset:', error);
		}
	}
	
	function updatePlaybackSpeed() {
		const rate = bpm > 0 ? targetBPM / bpm : 1;
    console.log('updatePlaybackSpeed', rate, bpm, targetBPM);
		audioEngine.setPlaybackRate(rate);
		
		// Save speed settings to session
		updateSessionSpeed();
	}
	
	async function updateSessionSpeed() {
		if (!currentSession) return;
		
		// Update the session with new speed settings
		currentSession.targetBPM = targetBPM;
		
		try {
			// Save only the targetBPM update
			await persistenceService.updateSessionTargetBPM(currentSession.id, targetBPM);
		} catch (error) {
			console.error('Failed to save speed settings:', error);
		}
	}

	function handleOffsetInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const rawValue = parseFloat(target.value);
		
		// Define snap zone (within 5ms of zero)
		const snapZone = 5;
		
		// Update slider display value immediately for smooth dragging
		if (Math.abs(rawValue) <= snapZone) {
			sliderBeatOffset = 0;
		} else {
			sliderBeatOffset = Math.round(rawValue);
		}
		
		// Debounce the actual state update and session save
		if (offsetUpdateTimeout) {
			clearTimeout(offsetUpdateTimeout);
		}
		
		offsetUpdateTimeout = setTimeout(async () => {
			// Update the actual beatOffset state (this triggers rerenders)
			beatOffset = sliderBeatOffset;
			await updateSessionOffset();
			offsetUpdateTimeout = null;
		}, 250);
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
        updatePlaybackSpeed();
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
				// Clear any active annotation session and key state when pausing
				activeAnnotationSession = null;
				isAKeyPressed = false;
				previewAnnotation = null;
				if (previewTimeout) {
					clearTimeout(previewTimeout);
					previewTimeout = null;
				}
			} else {
				await audioEngine.play();
				isPlaying = true;
			}
		} catch (error) {
			console.error('Playback error:', error);
		}
	}

	async function handleKeydown(event: KeyboardEvent) {
		// Don't handle shortcuts when annotation modal is open
		if (isAnnotationModalOpen) {
			return;
		}

		// Prevent default for our shortcuts
		if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'Enter' || event.code === 'KeyM' || (event.code === 'KeyA' && isAnnotationMode)) {
			event.preventDefault();
		}

		switch (event.code) {
			case 'Space':
				await togglePlayback();
				break;
				
			case 'ArrowLeft':
				await jumpToPreviousBoundary();
				break;
				
			case 'ArrowRight':
				await jumpToNextBoundary();
				break;
				
			case 'KeyM':
				// Toggle annotation mode
				isAnnotationMode = !isAnnotationMode;
				// Clear any active annotation session and key state when toggling off
				if (!isAnnotationMode) {
					activeAnnotationSession = null;
					isAKeyPressed = false;
					previewAnnotation = null;
					if (previewTimeout) {
						clearTimeout(previewTimeout);
						previewTimeout = null;
					}
				}
				break;
				
			case 'KeyA':
				// Handle annotation creation (only in annotation mode and while playing)
				// Check isAKeyPressed to ensure this is a fresh press, not a held key or repeat
				if (isAnnotationMode && isPlaying && !isAKeyPressed) {
					// Mark key as pressed
					isAKeyPressed = true;
					
					// Create a unique session ID for this keypress
					const sessionId = `${Date.now()}-${Math.random()}`;
					const startTimeMs = currentTime * 1000; // Convert to milliseconds
					activeAnnotationSession = {
						startTime: startTimeMs,
						id: sessionId
					};
					
					// Set timeout to show preview annotation after 150ms
					previewTimeout = setTimeout(() => {
						if (isAKeyPressed && activeAnnotationSession) {
							// Create preview annotation
							const snappedStartTime = Math.round(startTimeMs / 25) * 25;
							previewAnnotation = {
								id: `preview-${sessionId}`,
								startTimeMs: snappedStartTime,
								endTimeMs: snappedStartTime, // Will be updated by effect
								label: `${annotationTemplate.name} ${annotationCounter}`,
								color: annotationTemplate.color,
								isPoint: false
							};
						}
					}, 150);
				}
				break;
		}
	}
	
	async function handleKeyup(event: KeyboardEvent) {
		// Don't handle shortcuts when annotation modal is open
		if (isAnnotationModalOpen) {
			return;
		}
		
		// Handle 'A' key release for annotation creation
		if (event.code === 'KeyA' && isAnnotationMode) {
			event.preventDefault();
			
			// Clear the preview timeout if it hasn't fired yet
			if (previewTimeout) {
				clearTimeout(previewTimeout);
				previewTimeout = null;
			}
			
			// Only process if the key was actually pressed (prevents stray keyup events)
			if (isAKeyPressed && activeAnnotationSession) {
				const endTime = currentTime * 1000; // Convert to milliseconds
				const duration = endTime - activeAnnotationSession.startTime;
				
				// Determine if it's a point or range annotation
				const isPoint = duration < 150; // Match the preview timeout duration
				
				// Use existing preview annotation name if it exists, otherwise create new counter
				const annotationName = previewAnnotation 
					? previewAnnotation.label 
					: `${annotationTemplate.name} ${annotationCounter}`;
				
				// Always increment counter after using it
				annotationCounter++;
				
				if (currentSession) {
					// Use template color
					const annotationColor = annotationTemplate.color;
					
					// For point annotations, start and end time are the same
					const finalEndTime = isPoint ? activeAnnotationSession.startTime : endTime;
					
					// Snap times to 25ms increments (matching what persistence does)
					const snappedStartTime = Math.round(activeAnnotationSession.startTime / 25) * 25;
					const snappedEndTime = Math.round(finalEndTime / 25) * 25;
					
					// Create the final annotation object
					const newAnnotation: Annotation = {
						id: previewAnnotation ? previewAnnotation.id.replace('preview-', 'temp-') : `temp-${Date.now()}-${Math.random()}`,
						startTimeMs: snappedStartTime,
						endTimeMs: snappedEndTime,
						label: annotationName,
						color: annotationColor,
						isPoint
					};
					
					// Update UI immediately (optimistic update)
					if (!currentSession.annotations) {
						currentSession.annotations = [];
					}
					currentSession.annotations = [...currentSession.annotations, newAnnotation];
					
					// Save to IndexedDB in the background (don't await)
					persistenceService.addAnnotation(
						currentSession.id,
						activeAnnotationSession.startTime,
						finalEndTime,
						annotationName,
						annotationColor,
						isPoint
					).then(result => {
						// Replace temporary annotation with the saved one
						const tempIndex = currentSession!.annotations.findIndex(a => a.id === newAnnotation.id);
						if (tempIndex !== -1) {
							const savedAnnotation = result.session.annotations.find(a => 
								a.label === annotationName && 
								Math.abs(a.startTimeMs - snappedStartTime) < 50
							);
							if (savedAnnotation) {
								currentSession!.annotations[tempIndex] = savedAnnotation;
								currentSession = currentSession; // Trigger reactivity
							}
						}
					}).catch(error => {
						console.error('Failed to save annotation:', error);
						// Remove the failed annotation from UI
						currentSession!.annotations = currentSession!.annotations.filter(a => a.id !== newAnnotation.id);
					});
				}
				
				// Clear the active session and preview
				activeAnnotationSession = null;
				previewAnnotation = null;
			}
			
			// Always mark key as released and clear preview when we get a keyup event for 'A'
			isAKeyPressed = false;
			previewAnnotation = null;
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

	function handleAnnotationModalStateChange(isOpen: boolean) {
		isAnnotationModalOpen = isOpen;
	}

	function autoScrollToCurrentChunk() {
		if (!autoFollow || !currentSession) return;

		// Find the current chunk element using the class we added
		const currentChunkElement = document.querySelector('.current-chunk');
		
		// Scroll to the current chunk
		if (currentChunkElement) {
			currentChunkElement.scrollIntoView({
				behavior: 'smooth',
				block: 'center'
			});
		}
	}


	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	// Annotation handlers
	async function handleAnnotationCreated(event: CustomEvent<{ startTimeMs: number; endTimeMs: number; label: string; color: string }>) {
		if (!currentSession) return;
		
		const { startTimeMs, endTimeMs, label, color } = event.detail;
		try {
			const result = await persistenceService.addAnnotation(currentSession.id, startTimeMs, endTimeMs, label, color);
			currentSession = result.session;
		} catch (error) {
			console.error('Failed to create annotation:', error);
		}
	}

	async function handleAnnotationUpdated(id: string, updates: Partial<Annotation>) {
		if (!currentSession) return;
		
		// Always treat this as a real update request
		try {
			const updatedSession = await persistenceService.updateAnnotation(currentSession.id, id, updates);
			currentSession = updatedSession;
		} catch (error) {
			console.error('Failed to update annotation:', error);
		}
	}


	async function handleAnnotationDeleted(id: string) {
		if (!currentSession) return;
		
		try {
			const updatedSession = await persistenceService.removeAnnotation(currentSession.id, id);
			currentSession = updatedSession;
		} catch (error) {
			console.error('Failed to delete annotation:', error);
		}
	}
	
	async function clearAllAnnotations() {
		if (!currentSession) return;
		
		try {
			const updatedSession = await persistenceService.clearAllAnnotations(currentSession.id);
			currentSession = updatedSession;
			// Reset annotation counter when clearing all
			annotationCounter = 1;
		} catch (error) {
			console.error('Failed to clear all annotations:', error);
		}
	}


	async function handleAnnotationCreatedFromCanvas(startTimeMs: number, endTimeMs: number, label?: string, color?: string, isPoint?: boolean) {
		// Use provided label/color or defaults
		const finalLabel = label || `Annotation ${(currentSession?.annotations?.length || 0) + 1}`;
		const finalColor = color || '#ff5500';
		
		if (!currentSession) return;
		
		try {
			const result = await persistenceService.addAnnotation(currentSession.id, startTimeMs, endTimeMs, finalLabel, finalColor, isPoint);
			currentSession = result.session;
		} catch (error) {
			console.error('Failed to create annotation from canvas:', error);
		}
	}

	
	function handleProgressClick(event: MouseEvent) {
		if (!audioEngine || duration <= 0) return;
		
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const percentage = x / rect.width;
		const seekTime = percentage * duration;
		
		audioEngine.seekTo(Math.max(0, Math.min(duration, seekTime)));
	}

	function handleProgressInput(event: Event) {
		// Real-time visual feedback during drag - just update the UI
		const target = event.target as HTMLInputElement;
		const rawValue = parseFloat(target.value);
		
		// Apply snap-to-zero for visual feedback
		const snapZone = 0.5;
		if (rawValue <= snapZone) {
			currentTime = 0;
		} else {
			currentTime = rawValue;
		}
	}

	async function handleProgressChange(event: Event) {
		// Final seeking when drag/click completes
		if (!audioEngine || duration <= 0) return;
		
		const target = event.target as HTMLInputElement;
		const rawValue = parseFloat(target.value);
		
		// Apply snap-to-zero for actual seeking
		const snapZone = 0.5;
		let seekTime;
		if (rawValue <= snapZone) {
			seekTime = 0;
		} else {
			seekTime = rawValue;
		}
		
		const clampedTime = Math.max(0, Math.min(duration, seekTime));
		
		// Reset drag state BEFORE seeking to ensure time updates can resume
		isDraggingProgress = false;
		
		// Await the seek operation and immediately sync state
		await audioEngine.seekTo(clampedTime);
		
		// Force immediate state synchronization
		isPlaying = audioEngine.playing;
		currentTime = audioEngine.getCurrentTime();
	}

	// Helper function to manage loop chunks - allows any pieces to be looped
	function getUpdatedLoopRange(clickedChunk: number, existingChunks: Set<number>): Set<number> {
		// Check if clicked chunk is already in the loop
		if (existingChunks.has(clickedChunk)) {
			// Remove only this chunk from the loop
			const newChunks = new Set(existingChunks);
			newChunks.delete(clickedChunk);
			return newChunks;
		} else {
			// Add this chunk to the existing loop (regardless of adjacency)
			const newChunks = new Set(existingChunks);
			newChunks.add(clickedChunk);
			return newChunks;
		}
	}
	
	// Helper function to get current chunk index based on playhead position
	function getCurrentChunkIndex(): number {
		if (!currentSession) return 0;
		const beatsPerChunk = currentSession.beatsPerLine;
		const chunkDuration = beatsPerChunk * (60 / bpm);
		const offsetInSeconds = beatOffset / 1000;
		
		// Adjust currentTime based on offset to find which visual chunk contains the playhead
		if (beatOffset > 0) {
			// Positive offset: if currentTime < (chunkDuration - offsetInSeconds), we're in chunk -1
			if (currentTime < (chunkDuration - offsetInSeconds)) {
				return -1;
			} else {
				// We're in a regular chunk, calculate which one
				const adjustedTime = currentTime + offsetInSeconds;
				return Math.floor(adjustedTime / chunkDuration);
			}
		} else if (beatOffset < 0) {
			// Negative offset: if currentTime < Math.abs(offsetInSeconds), we're in chunk -1
			if (currentTime < Math.abs(offsetInSeconds)) {
				return -1;
			} else {
				// We're in a regular chunk
				const adjustedTime = currentTime + Math.abs(offsetInSeconds);
				return Math.floor(adjustedTime / chunkDuration);
			}
		} else {
			// No offset: simple calculation
			return Math.floor(currentTime / chunkDuration);
		}
	}
	
	// Helper function to calculate actual song time for a chunk index (matching SpectrogramDisplay logic)
	function getChunkSongTimes(chunkIndex: number): { startTime: number; endTime: number } {
		const beatsPerChunk = currentSession!.beatsPerLine;
		const chunkDuration = beatsPerChunk * (60 / bpm);
		const offsetInSeconds = beatOffset / 1000;
		
		let chunkStartTime: number;
		let chunkEndTime: number;
		
		if (chunkIndex === -1) {
			// Special chunk -1 handling
			if (beatOffset > 0) {
				// Positive offset: chunk -1 shows song from start
				chunkStartTime = 0;
				chunkEndTime = chunkDuration - offsetInSeconds;
			} else if (beatOffset < 0) {
				// Negative offset: chunk -1 shows small song portion  
				chunkStartTime = 0;
				chunkEndTime = Math.abs(offsetInSeconds);
			} else {
				// No offset, shouldn't have chunk -1
				chunkStartTime = 0;
				chunkEndTime = chunkDuration;
			}
		} else {
			// Regular chunks - use same logic as SpectrogramDisplay
			if (beatOffset > 0) {
				// When chunk -1 exists, regular chunks are shifted by the offset
				chunkStartTime = chunkDuration - offsetInSeconds + chunkIndex * chunkDuration;
				chunkEndTime = chunkDuration - offsetInSeconds + (chunkIndex + 1) * chunkDuration;
			} else if (beatOffset < 0) {
				// When negative offset, regular chunks are shifted forward by the offset amount
				chunkStartTime = chunkIndex * chunkDuration + Math.abs(offsetInSeconds);
				chunkEndTime = (chunkIndex + 1) * chunkDuration + Math.abs(offsetInSeconds);
			} else {
				// Normal chunk boundaries when no offset
				chunkStartTime = chunkIndex * chunkDuration;
				chunkEndTime = (chunkIndex + 1) * chunkDuration;
			}
		}
		
		return { startTime: chunkStartTime, endTime: chunkEndTime };
	}

	// Helper function to calculate loop segments from chunk indices (supports non-contiguous chunks)
	function calculateLoopSegments(chunkIndices: Set<number>): Array<{ start: number; end: number }> {
		if (chunkIndices.size === 0 || !currentSession) {
			return [];
		}
		
		const sortedIndices = Array.from(chunkIndices).sort((a, b) => a - b);
		
		// Create individual segments for each selected chunk
		return sortedIndices.map(chunkIndex => {
			const { startTime, endTime } = getChunkSongTimes(chunkIndex);
			return {
				start: Math.max(0, startTime),
				end: Math.min(endTime, duration)
			};
		});
	}

	function handleChunkLoop(chunkIndex: number, startTime: number, endTime: number) {
		if (!audioEngine || !currentSession) return;
		
		// Store scroll position before state change
		const spectrogramContainer = document.querySelector('.overflow-y-auto');
		const scrollTop = spectrogramContainer?.scrollTop || 0;
		
		// Update loop set - allows any chunks to be looped, individual deselection
		const newLoopIndices = getUpdatedLoopRange(chunkIndex, loopingChunkIndices);
		
		// Calculate loop segments from all selected chunks
		const loopSegments = calculateLoopSegments(newLoopIndices);
		
		// Update audio engine and state
		if (loopSegments.length > 0) {
			audioEngine.setLoopSegments(loopSegments);
		} else {
			// No segments remaining, clear the loop
			audioEngine.clearLoop();
		}
		loopingChunkIndices = newLoopIndices;
		
		// Restore scroll position after state change
		requestAnimationFrame(() => {
			if (spectrogramContainer) {
				spectrogramContainer.scrollTop = scrollTop;
			}
		});
		
		// Only seek if we have segments and we're not currently in any of them
		if (loopSegments.length > 0) {
			const currentPos = audioEngine.getCurrentTime();
			const isInAnySegment = loopSegments.some(seg => currentPos >= seg.start && currentPos <= seg.end);
			if (!isInAnySegment) {
				audioEngine.seekTo(loopSegments[0].start);
			}
		}
	}
	
	function handleClearLoop() {
		if (!audioEngine) return;
		
		// Store scroll position before state change
		const spectrogramContainer = document.querySelector('.overflow-y-auto');
		const scrollTop = spectrogramContainer?.scrollTop || 0;
		
		audioEngine.clearLoop();
		loopingChunkIndices = new Set<number>();
		
		// Restore scroll position after state change
		requestAnimationFrame(() => {
			if (spectrogramContainer) {
				spectrogramContainer.scrollTop = scrollTop;
			}
		});
	}

	async function updateBeatsPerLine(beatsPerLine: number) {
		if (!currentSession) return;
		
		try {
			const updatedSession = await persistenceService.updateBeatsPerLine(currentSession.id, beatsPerLine);
			currentSession = updatedSession;
		} catch (error) {
			console.error('Failed to update beats per line:', error);
		}
	}

	async function returnToSongList() {
		if (!currentSession) return;
		
		// Stop playback if playing
		if (isPlaying) {
			audioEngine.pause();
			isPlaying = false;
		}
		
		// Clear any active loops
		audioEngine?.clearLoop();
		loopingChunkIndices = new Set<number>();
		
		// Clear the current session pointer from persistence
		// This doesn't delete the session, just removes it as the "current" one
		await del(CURRENT_SESSION_KEY);
		
		// Reset all state
		currentSession = null;
		currentTime = 0;
		duration = 0;
		bpm = 120;
		beatOffset = 0;
		sliderBeatOffset = 0; // Keep slider in sync
		currentBeatIndex = -1;
		
		// Dispose of audio resources
		audioEngine?.dispose();
		audioEngine = new AudioEngine();
		
		// Re-setup audio engine event handlers
		audioEngine.onTimeUpdate = (time) => {
			// Only update currentTime if user is not dragging the progress slider
			if (!isDraggingProgress) {
				currentTime = time;
			}
			updateCurrentBeat();
			// Keep UI state in sync with audio engine state
			isPlaying = audioEngine.playing;
		};

		audioEngine.onEnded = () => {
			isPlaying = false;
			// Clear any active annotation session and key state when playback ends
			activeAnnotationSession = null;
			isAKeyPressed = false;
		};
	}

	// Auto-follow effect: scroll to current chunk when time changes and auto-follow is enabled
	let lastScrollTime = $state(0);
	let scrollThrottle = $state(false);

  $effect(() => {
      if (autoFollow && currentTime && !scrollThrottle) {
      // Throttle scrolling to avoid excessive calls during playback
      const now = Date.now();
      if (now - lastScrollTime > 200) { // Max once per 200ms
        scrollThrottle = true;
        lastScrollTime = now;
        
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          autoScrollToCurrentChunk();
          scrollThrottle = false;
        });
      }
    }
  })
  
  // Effect to update preview annotation end time in real-time
  $effect(() => {
    if (previewAnnotation && isPlaying && isAKeyPressed) {
      const currentTimeMs = currentTime * 1000;
      const snappedEndTime = Math.round(currentTimeMs / 25) * 25;
      previewAnnotation.endTimeMs = snappedEndTime;
    }
  })
</script>

<main class="min-h-screen bg-gray-900 text-white">
	<!-- Header -->
	<header class="bg-gray-800 border-b border-gray-700 p-4">
		<div class="max-w-7xl mx-auto">
			{#if currentSession}
				<div class="flex items-center justify-between">
					<button
						class="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
						onclick={returnToSongList}
					>
						← Song List
					</button>
					<h2 class="text-lg font-semibold flex-1 text-center">{currentSession.filename}</h2>
					<div class="text-sm text-gray-400">
						Duration: {formatTime(duration)} • Beats: {currentSession.beats.length}
					</div>
				</div>
			{:else}
				<div class="flex items-center justify-between">
					<div>
						<h1 class="text-2xl font-bold text-blue-400">Musicality Nerd</h1>
					</div>
				</div>
			{/if}
		</div>
	</header>

	<!-- Main Content -->
	<div class="max-w-7xl mx-auto p-4 space-y-6">
		
		{#if !currentSession}
			<!-- Song List -->
			<SongList 
				onSongSelected={handleSongSelected}
				onFilesDrop={handleFilesDrop}
			/>
		{:else}
			<!-- Playback Speed and Beat Offset Controls -->
			<div class="flex gap-4">
				<!-- Playback Speed Control -->
				<div class="flex-1 bg-gray-800 rounded-lg p-4">
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-semibold text-gray-300">Playback Speed</h3>
							<div class="flex items-center gap-2">
								<label class="text-xs text-gray-400" for="bpm">Song BPM:</label>
								<input 
									type="number" 
									bind:value={bpm}
									oninput={async () => await updateSessionBpm(true)}
									class="bg-gray-700 text-white px-2 py-1 rounded w-14 text-xs"
									min="60" 
									max="200"
								/>
								<button 
									class="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded text-xs transition-colors"
									onclick={recalculateBpmFromSong}
									disabled={isDetectingBpm}
									title="Recalculate BPM from audio"
								>
									{isDetectingBpm ? 'Calculating...' : 'Recalc'}
								</button>
							</div>
						</div>
						<div class="flex items-center gap-2">
							<label for="target-bpm" class="text-xs text-gray-400 w-20">Target BPM:</label>
							<button 
								class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
								onclick={() => { targetBPM = Math.max(20, targetBPM - 1); updatePlaybackSpeed(); }}
							>
								-1
							</button>
							<input 
								id="target-bpm"
								type="number"
								bind:value={targetBPM}
								oninput={updatePlaybackSpeed}
								class="bg-gray-700 text-white px-2 py-1 rounded w-16 text-sm text-center"
								min="40"
								max="300"
							/>
							<button 
								class="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs"
								onclick={() => { targetBPM = Math.min(300, targetBPM + 1); updatePlaybackSpeed(); }}
							>
								+1
							</button>
							<button 
								class="px-2 py-1 bg-amber-600 hover:bg-amber-700 rounded text-xs ml-2"
								onclick={() => { targetBPM = bpm; updatePlaybackSpeed(); }}
							>
								Reset
							</button>
						</div>
						<div class="text-xs text-gray-400">
							Playing at: {Math.round((targetBPM / bpm) * 100)}% speed
						</div>
					</div>
				</div>
				
				<!-- Beat Offset Control -->
				<div class="flex-1 bg-gray-800 rounded-lg p-4">
					<div class="space-y-2">
						<div class="flex justify-between items-center">
              <div class="text-sm font-semibold text-gray-300">Beat Offset (max ±½ beat): </div>
              <span class="text-xs text-gray-400 ml-2">
                {Math.round(beatOffset) > 0 ? '+' : ''}{Math.round(beatOffset)}ms
              </span>
            </div>
						<div class="space-y-2">
							<div class="relative">
								<input 
									type="range" 
									value={sliderBeatOffset}
									oninput={handleOffsetInput}
									min={-(60 / bpm) * 500}
									max={(60 / bpm) * 500}
									step="5"
									class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
								/>
								<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-500 pointer-events-none"></div>
							</div>
							<div class="flex justify-between text-xs text-gray-500">
								<span>-{Math.round((60 / bpm) * 500)}ms</span>
								<span>0</span>
								<span>+{Math.round((60 / bpm) * 500)}ms</span>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Transport Controls -->
			<div class="bg-gray-800 rounded-lg p-4 sticky top-0 z-10 shadow-lg border-b border-gray-700 backdrop-blur-sm">
				<div class="flex items-center space-x-4">
					<button 
						class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
						onclick={togglePlayback}
					>
						{isPlaying ? '⏸️' : '▶️'}
						{isPlaying ? 'Pause' : 'Play'}
					</button>
					
					<div class="flex-1">
						<div class="text-sm text-gray-400 mb-1">
							{formatTime(currentTime)} / {formatTime(duration)}
						</div>
						<input 
							type="range" 
							value={currentTime}
							oninput={handleProgressInput}
							onchange={handleProgressChange}
							onmousedown={() => isDraggingProgress = true}
							onmouseup={() => isDraggingProgress = false}
							ontouchstart={() => isDraggingProgress = true}
							ontouchend={() => isDraggingProgress = false}
							min="0"
							max={duration}
							step="0.1"
							class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
						/>
					</div>
					
					<div class="text-sm text-gray-400">
						Beat: {currentBeatIndex >= 0 ? currentBeatIndex + 1 : '-'}
					</div>
					
					<label class="text-sm text-gray-300 flex items-center space-x-3 cursor-pointer select-none">
						<span class="font-medium">Auto-follow:</span>
						<input 
							type="checkbox" 
							bind:checked={autoFollow}
							class="sr-only"
						/>
						<div class="relative inline-block">
							<div class="w-11 h-6 bg-gray-600 rounded-full shadow-inner transition-all duration-200 ease-in-out {autoFollow ? 'bg-blue-600 shadow-blue-500/25' : 'bg-gray-600'}"></div>
							<div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-md transform transition-all duration-200 ease-in-out {autoFollow ? 'translate-x-5 bg-blue-50' : 'translate-x-0'}"></div>
							{#if autoFollow}
								<div class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full flex items-center justify-center">
									<div class="w-2 h-2 bg-blue-600 rounded-full opacity-75"></div>
								</div>
							{/if}
						</div>
						<span class="text-xs {autoFollow ? 'text-blue-400' : 'text-gray-500'} transition-colors duration-200">
							{autoFollow ? 'ON' : 'OFF'}
						</span>
					</label>
					
					{#if currentSession?.annotations && currentSession.annotations.length > 0}
						<button
							class="bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg text-xs transition-colors"
							onclick={async () => {
								if (confirm('Are you sure you want to clear all annotations?')) {
									await clearAllAnnotations();
								}
							}}
							title="Clear all annotations"
						>
							Clear All ({currentSession.annotations.length})
						</button>
					{/if}
				</div>
			</div>

			<!-- Annotation Mode Panel -->
			<div class="bg-gray-800 rounded-lg p-4">
				<AnnotationModePanel
					{isAnnotationMode}
					onToggle={() => isAnnotationMode = !isAnnotationMode}
					{annotationTemplate}
					onTemplateChange={(template) => annotationTemplate = template}
					annotationCount={annotationCounter}
					horizontal={true}
				/>
			</div>

			<!-- Spectrogram Display -->
			{#if currentSession && !isSessionInitializing}
				<SvgWaveformDisplay
					{currentTime}
					{bpm}
					{targetBPM}
					{audioEngine}
					{beatOffset}
					beatsPerLine={currentSession.beatsPerLine}
					onChunkLoop={handleChunkLoop}
					onClearLoop={handleClearLoop}
					{loopingChunkIndices}
					onSeek={(time) => audioEngine.seekTo(time)}
					onBeatsPerLineChange={updateBeatsPerLine}
					annotations={previewAnnotation 
						? [...(currentSession.annotations || []), previewAnnotation]
						: (currentSession.annotations || [])}
					onAnnotationCreated={handleAnnotationCreatedFromCanvas}
					onAnnotationUpdated={handleAnnotationUpdated}
					onAnnotationDeleted={handleAnnotationDeleted}
					onAnnotationModalStateChange={handleAnnotationModalStateChange}
					filename={currentSession.filename.replace(/\.[^/.]+$/, "")}
				/>
			{:else if isSessionInitializing}
				<!-- Loading state for waveform -->
				<div class="bg-gray-800 rounded-lg p-8 text-center">
					<div class="text-gray-400">
						<div class="animate-pulse">Loading and analyzing audio...</div>
						{#if isDetectingBpm}
							<div class="text-sm mt-2">Detecting BPM...</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Beat Grid (Commented out temporarily) -->
			<!-- {#if currentSession.beats.length > 0}
				<BeatGrid 
					beats={currentSession.beats}
					{currentBeatIndex}
					{currentTime}
					{bpm}
				/>
			{/if} -->


			<!-- Keyboard Shortcuts Help -->
			<div class="bg-gray-800 rounded-lg p-4">
				<h3 class="text-sm font-semibold text-gray-300 mb-2">Keyboard Shortcuts</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-400">
					<div><kbd class="bg-gray-700 px-1 rounded">Space</kbd> Play/Pause</div>
					<div><kbd class="bg-gray-700 px-1 rounded">←</kbd> Jump back 8 beats</div>
					<div><kbd class="bg-gray-700 px-1 rounded">→</kbd> Jump forward 8 beats</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="bg-gray-800 rounded-lg p-4 text-center">
				<p class="text-sm text-gray-400">
					Made with ❤️ by <a href="https://vester.si/blog/me?utm_source=musicality-nerd" target="_blank" class="text-amber-500 hover:text-amber-400 transition-colors">Demjan</a>
				</p>
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
