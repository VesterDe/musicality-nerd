<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { del } from 'idb-keyval';
	import { AudioEngine } from '$lib/audio/AudioEngine';
	import { BpmDetector } from '$lib/audio/BpmDetector';
	import { PersistenceService } from '$lib/persistence/PersistenceService';
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import SvgWaveformDisplay from '$lib/components/SvgWaveformDisplay.svelte';
	import SongList from '$lib/components/SongList.svelte';
	import StemList from '$lib/components/StemList.svelte';
	import Sidebar from '$lib/components/sidebar/Sidebar.svelte';
	import { stemExtractor } from '$lib/utils/stemExtractor';
	import { detectBpmWithStemFallback } from '$lib/utils/bpmDetection';
	import type { TrackSession, Annotation } from '$lib/types';
	let { data } = $props();

	// Constants
	const CURRENT_SESSION_KEY = 'current-session';

	// Core services
	let audioEngine: AudioEngine = $state(new AudioEngine());
	let bpmDetector: BpmDetector = $state(new BpmDetector());
	let persistenceService: PersistenceService = $state(new PersistenceService());

	// UI-specific state (not in store)
	let loopingChunkIndices = $state(new Set<number>());
	let isAnnotationModalOpen = $state(false);
	let isDraggingProgress = $state(false);
	let selectedMode: 'normal' | 'stem' | null = $state(null); // Mode selector state
	let isEditingSessionName = $state(false);
	let editingSessionName = $state('');
	let isExtractingStems = $state(false);
	let stemExtractionProgress = $state<string>('');
	
	// Throttling for coarse time updates (~10Hz)
	let lastTimeUpdate = $state(0);
	const TIME_UPDATE_INTERVAL = 100; // 100ms = 10Hz
	
	// Annotation mode state (some in store, some local)
	let activeAnnotationSession: { startTime: number; id: string } | null = $state(null);
	let isAKeyPressed = $state(false); // Track physical key state
	let previewAnnotation: Annotation | null = $state(null);
	let previewTimeout: number | null = $state(null);
	
	onMount(async () => {
		// Initialize services
		audioEngine = new AudioEngine();
		bpmDetector = new BpmDetector();
		persistenceService = new PersistenceService();

		// Connect services to store
		sessionStore.setServices(audioEngine, persistenceService);
		
		// Setup audio engine event handlers
		audioEngine.onTimeUpdate = (time) => {
			// Only update currentTime if user is not dragging the progress slider
			if (!isDraggingProgress) {
				// Throttle store updates to ~10Hz for coarse UI (labels, progress bars)
				// The playhead position will be updated via rAF independently
				const now = Date.now();
				if (now - lastTimeUpdate >= TIME_UPDATE_INTERVAL) {
					sessionStore.setCurrentTime(time);
					lastTimeUpdate = now;
				}
			}
			sessionStore.updateCurrentBeat();
			// Keep UI state in sync with audio engine state
			sessionStore.setIsPlaying(audioEngine.playing);
		};

		audioEngine.onEnded = () => {
			sessionStore.setIsPlaying(false);
			// Clear any active annotation session and key state when playback ends
			activeAnnotationSession = null;
			isAKeyPressed = false;
		};

		// Setup BPM detector event handlers
		bpmDetector.onBpmChanged = (newBpm) => {
			// Only update if BPM wasn't manually set
			if (!sessionStore.currentSession?.manualBpm) {
				sessionStore.updateBPM(newBpm, false);
			}
		};

		bpmDetector.onDetectionError = (error) => {
			console.error('BPM detection failed:', error);
			// Don't show alert here - detectBpmWithStemFallback handles errors and only alerts if all stems fail
			// This callback is kept for logging purposes
		};

		// Setup keyboard shortcuts (browser only)
		if (typeof document !== 'undefined') {
			document.addEventListener('keydown', handleKeydown);
			document.addEventListener('keyup', handleKeyup);
		}


		// If layout detected an existing session, set initializing immediately and load it
		if (data?.hasCurrentSession) {
			// Ensure initializing is true before any async work so UI doesn't flash SongList
			sessionStore.setIsSessionInitializing(true);
			await loadLastSession();
		} else {
			// No existing session, ensure we don't show loading state unnecessarily
			sessionStore.setIsSessionInitializing(false);
		}

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
			sessionStore.setIsSessionInitializing(true);
			const lastSession = await persistenceService.loadCurrentSession();
			if (lastSession) {
				await loadSessionData(lastSession);
			}
		} catch (error) {
			console.error('Failed to load last session:', error);
		} finally {
			sessionStore.setIsSessionInitializing(false);
		}
	}


	async function loadSessionData(session: TrackSession): Promise<void> {
		// Use stem loader for stem sessions
		if (session.mode === 'stem') {
			await loadStemSessionData(session);
			return;
		}

		// Ensure backwards compatibility for annotations
		if (!session.annotations) {
			session.annotations = [];
		}

		// Set session early so the main UI can render without waiting for audio decode
		sessionStore.setCurrentSession(session);
		
		// Load audio first (single track mode)
		if (session.mp3Blob) {
			await audioEngine.loadTrack(session.mp3Blob);
		}
		const audioDuration = audioEngine.getDuration();
		sessionStore.setDuration(audioDuration);
		
		// Initialize local state from session
		let finalBpm = session.bpm;
		let finalBeatOffset = Math.round(session.beatOffset);
		
		// Initialize speed controls
		// Use saved targetBPM if it exists and is not 0, otherwise use the song's BPM
		console.log('session.targetBPM', session.targetBPM, finalBpm);
		const targetBPM = (session.targetBPM && session.targetBPM > 0) ? session.targetBPM : finalBpm;
		sessionStore.updateTargetBPM(targetBPM);
		
		// Run BPM detection if not manually set
		if (!session.manualBpm) {
			try {
				sessionStore.setIsDetectingBpm(true);
				const detectedBpm = await detectBpmWithStemFallback(audioEngine, bpmDetector);
				finalBpm = detectedBpm;
			} catch (error) {
				console.error('Auto BPM detection failed:', error);
				// Keep existing BPM from session
			} finally {
				sessionStore.setIsDetectingBpm(false);
			}
		}
		
		// Update session with final values if BPM changed
		if (finalBpm !== session.bpm) {
			const updatedSession = await persistenceService.updateSessionBpm(session.id, finalBpm, audioDuration, false);
			session.bpm = updatedSession.bpm;
			session.beats = updatedSession.beats;
		}
		
		// Set all state at once after everything is ready
		sessionStore.bpm = finalBpm;
		sessionStore.beatOffset = finalBeatOffset;
		sessionStore.sliderBeatOffset = finalBeatOffset; // Keep slider in sync
		// currentSession already set early
	}

	async function handleSongSelected(sessionId: string) {
		try {
			sessionStore.setIsSessionInitializing(true);
			
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
			sessionStore.setIsSessionInitializing(false);
		}
	}

	async function handleFilesDrop(files: FileList) {
		const file = files[0];
		if (!file) {
			alert('Please drop an audio file');
			return;
		}

		// Check if it's a VirtualDJ stems file
		if (file.name.toLowerCase().endsWith('.vdjstems') || file.name.toLowerCase().endsWith('.mp3.vdjstems')) {
			await handleVdjStemsDrop(file);
			return;
		}

		if (!file.type.startsWith('audio/')) {
			alert('Please drop an MP3 or other audio file');
			return;
		}

		try {
			sessionStore.setIsSessionInitializing(true);
			
			// Create new session
			const newSession = await persistenceService.createSession(file);
			
			// Load audio
			if (!newSession.mp3Blob) {
				throw new Error('Session missing audio data');
			}
			await audioEngine.loadTrack(newSession.mp3Blob);
			const audioDuration = audioEngine.getDuration();
			sessionStore.setDuration(audioDuration);
			
			// Initialize local state
			let finalBpm = 120; // Default BPM
			let finalBeatOffset = 0; // Default offset
			
			// Run automatic BPM detection
			try {
				sessionStore.setIsDetectingBpm(true);
				const detectedBpm = await detectBpmWithStemFallback(audioEngine, bpmDetector);
				finalBpm = detectedBpm;
			} catch (error) {
				console.error('Auto BPM detection failed:', error);
				// Use default BPM
				finalBpm = 120;
			} finally {
				sessionStore.setIsDetectingBpm(false);
			}
			
			// Update session with final BPM and regenerate beats
			const updatedSession = await persistenceService.updateSessionBpm(newSession.id, finalBpm, audioDuration, false);
			
			// Set all state at once after everything is ready
			sessionStore.bpm = finalBpm;
			sessionStore.beatOffset = finalBeatOffset;
			sessionStore.sliderBeatOffset = finalBeatOffset; // Keep slider in sync
			sessionStore.setCurrentSession(updatedSession);
			sessionStore.updateTargetBPM(finalBpm);
			
		} catch (error) {
			console.error('Failed to load track:', error);
			alert('Failed to load audio file. Please try another file.');
		} finally {
			sessionStore.setIsSessionInitializing(false);
		}
	}

	async function handleVdjStemsDrop(file: File) {
		try {
			sessionStore.setIsSessionInitializing(true);
			isExtractingStems = true;
			stemExtractionProgress = 'Initializing conversion engine...';

			// Extract stems using Mediabunny with progress updates
			const stemFiles = await stemExtractor.extractVirtualDjStems(file, (message) => {
				stemExtractionProgress = message;
			});
			
			if (stemFiles.length === 0) {
				throw new Error('No stems were extracted from the file');
			}

			stemExtractionProgress = `Extracted ${stemFiles.length} stems. Decoding audio...`;

			// Decode each stem into AudioBuffer and create File objects for session creation
			const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			const stemBlobs: Blob[] = [];
			const stemBuffers: ArrayBuffer[] = [];

			for (const stemFile of stemFiles) {
				// Convert Uint8Array to ArrayBuffer for session storage
				// Handle both ArrayBuffer and SharedArrayBuffer (if available)
				const buffer = stemFile.data.buffer;
				let arrayBuffer: ArrayBuffer;
				
				// Check if SharedArrayBuffer is available and if buffer is a SharedArrayBuffer
				if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
					// Convert SharedArrayBuffer to ArrayBuffer by copying
					const uint8View = new Uint8Array(buffer);
					const copy = new Uint8Array(uint8View.length);
					copy.set(uint8View);
					// Ensure we get a regular ArrayBuffer, not SharedArrayBuffer
					arrayBuffer = new ArrayBuffer(copy.length);
					new Uint8Array(arrayBuffer).set(copy);
				} else {
					// For regular ArrayBuffer, slice it
					const sliced = buffer.slice(
						stemFile.data.byteOffset,
						stemFile.data.byteOffset + stemFile.data.byteLength
					);
					// Ensure it's an ArrayBuffer (not SharedArrayBuffer) by creating a new one if needed
					if (sliced instanceof ArrayBuffer) {
						arrayBuffer = sliced;
					} else {
						// Fallback: copy to ensure we have a regular ArrayBuffer
						const uint8View = new Uint8Array(sliced);
						const copy = new Uint8Array(uint8View.length);
						copy.set(uint8View);
						arrayBuffer = copy.buffer;
					}
				}
				stemBuffers.push(arrayBuffer);
				stemBlobs.push(stemFile.blob);
			}

			// Create a stem session from the extracted stems
			// We need to create File objects from the blobs for createStemSession
			const stemFileObjects = stemFiles.map((stemFile, index) => {
				return new File([stemFile.blob], `${stemFile.name}.mp3`, { type: 'audio/mpeg' });
			});

			// Create a FileList-like object
			const fileList = Object.assign(stemFileObjects, {
				length: stemFileObjects.length,
				item: (index: number) => stemFileObjects[index] || null,
			}) as unknown as FileList;

			// Create stem session
			const newSession = await persistenceService.createStemSessionFromVdjStems(
				fileList,
				stemFiles.map(sf => sf.blob)
			);

			// Set session early so BPM detection can access stem metadata
			sessionStore.setCurrentSession(newSession);

			stemExtractionProgress = 'Loading stems into audio engine...';

			// Load all stems into audio engine
			await audioEngine.loadStems(stemBuffers);
			const audioDuration = audioEngine.getDuration();
			sessionStore.setDuration(audioDuration);

			// Initialize local state
			let finalBpm = 120; // Default BPM
			let finalBeatOffset = 0; // Default offset

			// Run automatic BPM detection with stem fallback
			try {
				sessionStore.setIsDetectingBpm(true);
				const detectedBpm = await detectBpmWithStemFallback(audioEngine, bpmDetector);
				finalBpm = detectedBpm;
			} catch (error) {
				console.error('Auto BPM detection failed:', error);
				finalBpm = 120;
			} finally {
				sessionStore.setIsDetectingBpm(false);
			}

			// Update session with final BPM and regenerate beats
			const updatedSession = await persistenceService.updateSessionBpm(newSession.id, finalBpm, audioDuration, false);

			// Set all state at once after everything is ready
			sessionStore.bpm = finalBpm;
			sessionStore.beatOffset = finalBeatOffset;
			sessionStore.sliderBeatOffset = finalBeatOffset;
			sessionStore.setCurrentSession(updatedSession);
			sessionStore.updateTargetBPM(finalBpm);

			// Switch to stem mode if not already
			selectedMode = 'stem';

		} catch (error) {
			console.error('Failed to extract stems:', error);
			alert(`Failed to extract stems from VirtualDJ file: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			isExtractingStems = false;
			stemExtractionProgress = '';
			sessionStore.setIsSessionInitializing(false);
		}
	}

	async function handleStemFilesDrop(files: FileList) {
		// Check if it's a single .vdjstems file
		if (files.length === 1) {
			const file = files[0];
			if (file.name.toLowerCase().endsWith('.vdjstems') || file.name.toLowerCase().endsWith('.mp3.vdjstems')) {
				await handleVdjStemsDrop(file);
				return;
			}
		}

		// Validate files
		const audioFiles = Array.from(files).filter(file => file.type.startsWith('audio/'));
		if (audioFiles.length < 2) {
			alert('Stem mode requires at least 2 audio files');
			return;
		}

		try {
			console.time('handleStemFilesDrop');
			sessionStore.setIsSessionInitializing(true);
			
			console.time('createStemSession');
			// Create new stem session
			const newSession = await persistenceService.createStemSession(files as unknown as FileList);
			console.timeEnd('createStemSession');
			
			console.time('loadStems');
			// Load all stems
			const stemBuffers = newSession.stems!.map(stem => stem.mp3Blob);
			await audioEngine.loadStems(stemBuffers);
			const audioDuration = audioEngine.getDuration();
			sessionStore.setDuration(audioDuration);
			console.timeEnd('loadStems');
			
			// Initialize local state
			let finalBpm = 120; // Default BPM
			let finalBeatOffset = 0; // Default offset
			
			// Run automatic BPM detection with stem fallback
			console.time('BPM detection');
			try {
				sessionStore.setIsDetectingBpm(true);
				const detectedBpm = await detectBpmWithStemFallback(audioEngine, bpmDetector);
				finalBpm = detectedBpm;
			} catch (error) {
				console.error('Auto BPM detection failed:', error);
				// Use default BPM
				finalBpm = 120;
			} finally {
				sessionStore.setIsDetectingBpm(false);
			}
			console.timeEnd('BPM detection');
			
			console.time('updateSessionBpm');
			// Update session with final BPM and regenerate beats
			const updatedSession = await persistenceService.updateSessionBpm(newSession.id, finalBpm, audioDuration, false);
			console.timeEnd('updateSessionBpm');
			
			console.time('setState');
			// Set all state at once after everything is ready
			sessionStore.bpm = finalBpm;
			sessionStore.beatOffset = finalBeatOffset;
			sessionStore.sliderBeatOffset = finalBeatOffset; // Keep slider in sync
			sessionStore.setCurrentSession(updatedSession);
			sessionStore.updateTargetBPM(finalBpm);
			console.timeEnd('setState');
			
			console.timeEnd('handleStemFilesDrop');
		} catch (error) {
			console.error('Failed to load stems:', error);
			alert('Failed to load stem files. Please try again.');
		} finally {
			sessionStore.setIsSessionInitializing(false);
		}
	}

	async function loadStemSessionData(session: TrackSession): Promise<void> {
		// Ensure backwards compatibility for annotations
		if (!session.annotations) {
			session.annotations = [];
		}

		// Set session early so the main UI can render without waiting for audio decode
		sessionStore.setCurrentSession(session);
		
		// Load all stems
		if (session.mode === 'stem' && session.stems) {
			const stemBuffers = session.stems.map(stem => stem.mp3Blob);
			await audioEngine.loadStems(stemBuffers);
			
			// Set initial enabled state for stems
			session.stems.forEach((stem, index) => {
				audioEngine.setStemEnabled(index, stem.enabled);
			});
		} else {
			// Fallback to single track loading
			if (session.mp3Blob) {
				await audioEngine.loadTrack(session.mp3Blob);
			}
		}
		
		const audioDuration = audioEngine.getDuration();
		sessionStore.setDuration(audioDuration);
		
		// Initialize local state from session
		let finalBpm = session.bpm;
		let finalBeatOffset = Math.round(session.beatOffset);
		
		// Initialize speed controls
		const targetBPM = (session.targetBPM && session.targetBPM > 0) ? session.targetBPM : finalBpm;
		sessionStore.updateTargetBPM(targetBPM);
		
		// Run BPM detection if not manually set
		if (!session.manualBpm) {
			try {
				sessionStore.setIsDetectingBpm(true);
				const detectedBpm = await detectBpmWithStemFallback(audioEngine, bpmDetector);
				finalBpm = detectedBpm;
			} catch (error) {
				console.error('Auto BPM detection failed:', error);
				// Keep existing BPM from session
			} finally {
				sessionStore.setIsDetectingBpm(false);
			}
		}
		
		// Update session with final values if BPM changed
		if (finalBpm !== session.bpm) {
			const updatedSession = await persistenceService.updateSessionBpm(session.id, finalBpm, audioDuration, false);
			session.bpm = updatedSession.bpm;
			session.beats = updatedSession.beats;
		}
		
		// Set all state at once after everything is ready
		sessionStore.bpm = finalBpm;
		sessionStore.beatOffset = finalBeatOffset;
		sessionStore.sliderBeatOffset = finalBeatOffset; // Keep slider in sync
		// currentSession already set early
	}

	// These functions are no longer needed as they're now in the store
	// Keeping updateCurrentBeat inline since it's called from audio engine callback

	async function togglePlayback() {
		if (!audioEngine || !sessionStore.currentSession) return;

		try {
			if (sessionStore.isPlaying) {
				audioEngine.pause();
				// Force immediate time sync after pause (bypass throttling)
				const pausedTime = audioEngine.getCurrentTime();
				sessionStore.setCurrentTime(pausedTime);
				lastTimeUpdate = Date.now(); // Reset throttle timer
				sessionStore.setIsPlaying(false);
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
				sessionStore.setIsPlaying(true);
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

		// Don't handle shortcuts when editing session name
		if (isEditingSessionName) {
			return;
		}

		// Prevent default for our shortcuts
		if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'Enter' || event.code === 'KeyM' || (event.code === 'KeyA' && sessionStore.isAnnotationMode)) {
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
				sessionStore.toggleAnnotationMode();
				// Clear any active annotation session and key state when toggling off
				if (!sessionStore.isAnnotationMode) {
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
				if (sessionStore.isAnnotationMode && sessionStore.isPlaying && !isAKeyPressed) {
					// Mark key as pressed
					isAKeyPressed = true;
					
					// Create a unique session ID for this keypress
					const sessionId = `${Date.now()}-${Math.random()}`;
					const startTimeMs = sessionStore.currentTime * 1000; // Convert to milliseconds
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
								label: `${sessionStore.annotationTemplate.name} ${sessionStore.annotationCounter}`,
								color: sessionStore.annotationTemplate.color,
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

		// Don't handle shortcuts when editing session name
		if (isEditingSessionName) {
			return;
		}
		
		// Handle 'A' key release for annotation creation
		if (event.code === 'KeyA' && sessionStore.isAnnotationMode) {
			event.preventDefault();
			
			// Clear the preview timeout if it hasn't fired yet
			if (previewTimeout) {
				clearTimeout(previewTimeout);
				previewTimeout = null;
			}
			
			// Only process if the key was actually pressed (prevents stray keyup events)
			if (isAKeyPressed && activeAnnotationSession) {
				const endTime = sessionStore.currentTime * 1000; // Convert to milliseconds
				const duration = endTime - activeAnnotationSession.startTime;
				
				// Determine if it's a point or range annotation
				const isPoint = duration < 150; // Match the preview timeout duration
				
				// Use existing preview annotation name if it exists, otherwise create new counter
				const annotationName = previewAnnotation 
					? previewAnnotation.label 
					: `${sessionStore.annotationTemplate.name} ${sessionStore.annotationCounter}`;
				
				// Always increment counter after using it
				sessionStore.incrementAnnotationCounter();
				
				if (sessionStore.currentSession) {
					// Use template color
					const annotationColor = sessionStore.annotationTemplate.color;
					
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
					const currentAnnotations = sessionStore.currentSession.annotations || [];
					sessionStore.setCurrentSession({
						...sessionStore.currentSession,
						annotations: [...currentAnnotations, newAnnotation]
					});
					
					// Save to IndexedDB in the background (don't await)
					persistenceService.addAnnotation(
						sessionStore.currentSession.id,
						activeAnnotationSession.startTime,
						finalEndTime,
						annotationName,
						annotationColor,
						isPoint
					).then(result => {
						// Replace temporary annotation with the saved one
						sessionStore.setCurrentSession(result.session);
					}).catch(error => {
						console.error('Failed to save annotation:', error);
						// Remove the failed annotation from UI
						if (sessionStore.currentSession && sessionStore.currentSession.annotations) {
							const filteredAnnotations = sessionStore.currentSession.annotations.filter(a => a.id !== newAnnotation.id);
							sessionStore.setCurrentSession({
								...sessionStore.currentSession,
								annotations: filteredAnnotations
							});
						}
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
		if (!sessionStore.currentSession) return;
		
		// Jump to previous 8-beat boundary
		const offsetInSeconds = sessionStore.beatOffset / 1000;
		const adjustedTime = sessionStore.currentTime - offsetInSeconds;
		const currentBeat = Math.floor(adjustedTime / (60 / sessionStore.bpm));
		const targetBeat = Math.max(0, Math.floor(currentBeat / 8) * 8 - 8);
		const targetTime = (targetBeat * (60 / sessionStore.bpm)) + offsetInSeconds;
		
		await audioEngine.seekTo(targetTime);
		// Force immediate time sync after seek (bypass throttling)
		const seekTime = audioEngine.getCurrentTime();
		sessionStore.setCurrentTime(seekTime);
		lastTimeUpdate = Date.now();
	}

	async function jumpToNextBoundary() {
		if (!sessionStore.currentSession) return;
		
		// Jump to next 8-beat boundary
		const offsetInSeconds = sessionStore.beatOffset / 1000;
		const adjustedTime = sessionStore.currentTime - offsetInSeconds;
		const currentBeat = Math.floor(adjustedTime / (60 / sessionStore.bpm));
		const targetBeat = Math.ceil((currentBeat + 1) / 8) * 8;
		const targetTime = Math.min((targetBeat * (60 / sessionStore.bpm)) + offsetInSeconds, sessionStore.duration);
		
		await audioEngine.seekTo(targetTime);
		// Force immediate time sync after seek (bypass throttling)
		const seekTime = audioEngine.getCurrentTime();
		sessionStore.setCurrentTime(seekTime);
		lastTimeUpdate = Date.now();
	}

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		// Add unsaved changes warning if needed
		// For now, we auto-save everything, so this is just a placeholder
		return;
	}

	function handleAnnotationModalStateChange(isOpen: boolean) {
		isAnnotationModalOpen = isOpen;
	}

	async function handleSessionNameClick() {
		if (!sessionStore.currentSession) return;
		isEditingSessionName = true;
		editingSessionName = sessionStore.currentSession.filename;
		// Focus the input after it's rendered
		requestAnimationFrame(() => {
			const input = document.querySelector('.session-name-input') as HTMLInputElement;
			if (input) {
				input.focus();
				input.select();
			}
		});
	}

	async function handleSessionNameSave() {
		if (!sessionStore.currentSession || !editingSessionName.trim()) {
			isEditingSessionName = false;
			return;
		}

		try {
			const updatedSession = await persistenceService.updateSessionFilename(
				sessionStore.currentSession.id,
				editingSessionName.trim()
			);
			sessionStore.setCurrentSession(updatedSession);
			isEditingSessionName = false;
		} catch (error) {
			console.error('Failed to update session name:', error);
			alert('Failed to update session name. Please try again.');
		}
	}

	function handleSessionNameCancel() {
		isEditingSessionName = false;
		editingSessionName = '';
	}

	function handleSessionNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			handleSessionNameSave();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			handleSessionNameCancel();
		}
	}

	function autoScrollToCurrentChunk() {
		if (!sessionStore.autoFollow || !sessionStore.currentSession) return;

		// Compute the current chunk index regardless of render state
		const chunkIndex = getCurrentChunkIndex();

		// Prefer targeting the chunk container (works with virtualization placeholders)
		const targetElement = document.querySelector(`[data-chunk-index="${chunkIndex}"]`) 
			|| document.querySelector('.current-chunk');

		if (targetElement) {
			targetElement.scrollIntoView({
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
		if (!sessionStore.currentSession) return;
		
		const { startTimeMs, endTimeMs, label, color } = event.detail;
		try {
			const result = await persistenceService.addAnnotation(sessionStore.currentSession.id, startTimeMs, endTimeMs, label, color);
			sessionStore.setCurrentSession(result.session);
		} catch (error) {
			console.error('Failed to create annotation:', error);
		}
	}

	async function handleAnnotationUpdated(id: string, updates: Partial<Annotation>) {
		if (!sessionStore.currentSession) return;
		
		// Always treat this as a real update request
		try {
			const updatedSession = await persistenceService.updateAnnotation(sessionStore.currentSession.id, id, updates);
			sessionStore.setCurrentSession(updatedSession);
		} catch (error) {
			console.error('Failed to update annotation:', error);
		}
	}


	async function handleAnnotationDeleted(id: string) {
		if (!sessionStore.currentSession) return;
		
		try {
			const updatedSession = await persistenceService.removeAnnotation(sessionStore.currentSession.id, id);
			sessionStore.setCurrentSession(updatedSession);
		} catch (error) {
			console.error('Failed to delete annotation:', error);
		}
	}
	
	async function clearAllAnnotations() {
		if (!sessionStore.currentSession) return;
		
		try {
			const updatedSession = await persistenceService.clearAllAnnotations(sessionStore.currentSession.id);
			sessionStore.setCurrentSession(updatedSession);
			// Reset annotation counter when clearing all
			sessionStore.resetAnnotationCounter();
		} catch (error) {
			console.error('Failed to clear all annotations:', error);
		}
	}


	async function handleAnnotationCreatedFromCanvas(startTimeMs: number, endTimeMs: number, label?: string, color?: string, isPoint?: boolean) {
		// Use provided label/color or defaults
		const finalLabel = label || `Annotation ${(sessionStore.currentSession?.annotations?.length || 0) + 1}`;
		const finalColor = color || '#ff5500';
		
		if (!sessionStore.currentSession) return;
		
		try {
			const result = await persistenceService.addAnnotation(sessionStore.currentSession.id, startTimeMs, endTimeMs, finalLabel, finalColor, isPoint);
			sessionStore.setCurrentSession(result.session);
		} catch (error) {
			console.error('Failed to create annotation from canvas:', error);
		}
	}

	
	function handleProgressClick(event: MouseEvent) {
		if (!audioEngine || sessionStore.duration <= 0) return;
		
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const percentage = x / rect.width;
		const seekTime = percentage * sessionStore.duration;
		
		audioEngine.seekTo(Math.max(0, Math.min(sessionStore.duration, seekTime)));
	}

	function handleProgressInput(event: Event) {
		// Real-time visual feedback during drag - just update the UI
		const target = event.target as HTMLInputElement;
		const rawValue = parseFloat(target.value);
		
		// Apply snap-to-zero for visual feedback
		const snapZone = 0.5;
		if (rawValue <= snapZone) {
			sessionStore.setCurrentTime(0);
		} else {
			sessionStore.setCurrentTime(rawValue);
		}
	}

	async function handleProgressChange(event: Event) {
		// Final seeking when drag/click completes
		if (!audioEngine || sessionStore.duration <= 0) return;
		
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
		
		const clampedTime = Math.max(0, Math.min(sessionStore.duration, seekTime));
		
		// Reset drag state BEFORE seeking to ensure time updates can resume
		isDraggingProgress = false;
		
		// Await the seek operation and immediately sync state
		await audioEngine.seekTo(clampedTime);
		
		// Force immediate state synchronization (bypass throttling)
		const syncedTime = audioEngine.getCurrentTime();
		sessionStore.setIsPlaying(audioEngine.playing);
		sessionStore.setCurrentTime(syncedTime);
		lastTimeUpdate = Date.now(); // Reset throttle timer
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
		if (!sessionStore.currentSession) return 0;
		const beatsPerChunk = sessionStore.currentSession.beatsPerLine;
		const chunkDuration = beatsPerChunk * (60 / sessionStore.bpm);
		const offsetInSeconds = sessionStore.beatOffset / 1000;
		
		// Adjust currentTime based on offset to find which visual chunk contains the playhead
		if (sessionStore.beatOffset > 0) {
			// Positive offset: if currentTime < (chunkDuration - offsetInSeconds), we're in chunk -1
			if (sessionStore.currentTime < (chunkDuration - offsetInSeconds)) {
				return -1;
			} else {
				// We're in a regular chunk, calculate which one
				const adjustedTime = sessionStore.currentTime + offsetInSeconds;
				return Math.floor(adjustedTime / chunkDuration);
			}
		} else if (sessionStore.beatOffset < 0) {
			// Negative offset: if currentTime < Math.abs(offsetInSeconds), we're in chunk -1
			if (sessionStore.currentTime < Math.abs(offsetInSeconds)) {
				return -1;
			} else {
				// We're in a regular chunk
				const adjustedTime = sessionStore.currentTime + Math.abs(offsetInSeconds);
				return Math.floor(adjustedTime / chunkDuration);
			}
		} else {
			// No offset: simple calculation
			return Math.floor(sessionStore.currentTime / chunkDuration);
		}
	}
	
	// Helper function to calculate actual song time for a chunk index (matching SpectrogramDisplay logic)
	function getChunkSongTimes(chunkIndex: number): { startTime: number; endTime: number } {
		const beatsPerChunk = sessionStore.currentSession!.beatsPerLine;
		const chunkDuration = beatsPerChunk * (60 / sessionStore.bpm);
		const offsetInSeconds = sessionStore.beatOffset / 1000;
		
		let chunkStartTime: number;
		let chunkEndTime: number;
		
		if (chunkIndex === -1) {
			// Special chunk -1 handling
			if (sessionStore.beatOffset > 0) {
				// Positive offset: chunk -1 shows song from start
				chunkStartTime = 0;
				chunkEndTime = chunkDuration - offsetInSeconds;
			} else if (sessionStore.beatOffset < 0) {
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
			if (sessionStore.beatOffset > 0) {
				// When chunk -1 exists, regular chunks are shifted by the offset
				chunkStartTime = chunkDuration - offsetInSeconds + chunkIndex * chunkDuration;
				chunkEndTime = chunkDuration - offsetInSeconds + (chunkIndex + 1) * chunkDuration;
			} else if (sessionStore.beatOffset < 0) {
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
		if (chunkIndices.size === 0 || !sessionStore.currentSession) {
			return [];
		}
		
		const sortedIndices = Array.from(chunkIndices).sort((a, b) => a - b);
		
		// Create individual segments for each selected chunk
		return sortedIndices.map(chunkIndex => {
			const { startTime, endTime } = getChunkSongTimes(chunkIndex);
			return {
				start: Math.max(0, startTime),
				end: Math.min(endTime, sessionStore.duration)
			};
		});
	}

	function handleChunkLoop(chunkIndex: number, startTime: number, endTime: number) {
		if (!audioEngine || !sessionStore.currentSession) return;
		
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



	async function returnToSongList() {
		if (!sessionStore.currentSession) return;
		
		// Stop playback if playing
		if (sessionStore.isPlaying) {
			audioEngine.pause();
			sessionStore.setIsPlaying(false);
		}
		
		// Clear any active loops
		audioEngine?.clearLoop();
		loopingChunkIndices = new Set<number>();
		
		// Clear the current session pointer from persistence
		// This doesn't delete the session, just removes it as the "current" one
		await del(CURRENT_SESSION_KEY);
		
		// Reset all state
		sessionStore.setCurrentSession(null);
		sessionStore.setCurrentTime(0);
		sessionStore.setDuration(0);
		sessionStore.bpm = 120;
		sessionStore.beatOffset = 0;
		sessionStore.sliderBeatOffset = 0;
		sessionStore.currentBeatIndex = -1;
		selectedMode = null; // Reset mode selector
		
		// Dispose of audio resources
		audioEngine?.dispose();
		audioEngine = new AudioEngine();
		
		// Re-connect services
		sessionStore.setServices(audioEngine, persistenceService);
		
		// Re-setup audio engine event handlers
		audioEngine.onTimeUpdate = (time) => {
			// Only update currentTime if user is not dragging the progress slider
			if (!isDraggingProgress) {
				sessionStore.setCurrentTime(time);
			}
			sessionStore.updateCurrentBeat();
			// Keep UI state in sync with audio engine state
			sessionStore.setIsPlaying(audioEngine.playing);
		};

		audioEngine.onEnded = () => {
			sessionStore.setIsPlaying(false);
			// Clear any active annotation session and key state when playback ends
			activeAnnotationSession = null;
			isAKeyPressed = false;
		};
	}

	// Auto-follow effect: scroll to current chunk when time changes and auto-follow is enabled
	let lastScrollTime = $state(0);
	let scrollThrottle = $state(false);

  $effect(() => {
      if (sessionStore.autoFollow && sessionStore.currentTime && !scrollThrottle) {
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
    if (previewAnnotation && sessionStore.isPlaying && isAKeyPressed) {
      const currentTimeMs = sessionStore.currentTime * 1000;
      const snappedEndTime = Math.round(currentTimeMs / 25) * 25;
      previewAnnotation.endTimeMs = snappedEndTime;
    }
  })
</script>

<main class="min-h-screen bg-gray-900 text-white">
	<!-- Header -->
	<header class="bg-gray-800 border-b border-gray-700 px-4 py-2.5">
		<div class="w-full">
			{#if sessionStore.currentSession}
				<div class="flex items-center justify-between">
					<button
						class="bg-gray-700 hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
						onclick={returnToSongList}
					>
						← Song List
					</button>
					<div class="flex-1 mx-6 flex items-center justify-center">
						{#if isEditingSessionName}
							<input
								type="text"
								class="session-name-input bg-gray-700 text-lg font-semibold text-center px-3 py-1 rounded border-2 border-blue-500 focus:outline-none focus:border-blue-400 w-full max-w-md"
								bind:value={editingSessionName}
								onkeydown={handleSessionNameKeydown}
								onblur={handleSessionNameSave}
								autofocus
							/>
						{:else}
							<h2 
								class="text-lg font-semibold truncate text-center cursor-pointer hover:text-blue-400 transition-colors"
								onclick={handleSessionNameClick}
								title="Click to rename"
							>
								{sessionStore.currentSession.filename}
							</h2>
						{/if}
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
	<div class="{sessionStore.currentSession ? 'flex h-[calc(100vh-4rem)]' : 'max-w-7xl mx-auto p-4'}">
		<!-- Main content area -->
		<div class="{sessionStore.currentSession ? 'flex-1 p-4 space-y-6 overflow-y-auto' : 'space-y-6'}">
		
		{#if sessionStore.currentSession}
			<!-- Transport Controls -->
			<div class="bg-gray-800 rounded-lg px-4 py-1.5 sticky top-0 z-10 shadow-lg border-b border-gray-700 backdrop-blur-sm">
				<div class="flex items-center gap-2.5">
					<button 
						class="bg-blue-600 hover:bg-blue-700 p-1 rounded-full transition-colors flex-shrink-0 w-7 h-7 flex items-center justify-center"
						title={sessionStore.isPlaying ? 'Pause' : 'Play'}
						aria-label={sessionStore.isPlaying ? 'Pause' : 'Play'}
						onclick={togglePlayback}
					>
						<span class="text-xs leading-none">{sessionStore.isPlaying ? '⏸' : '▶'}</span>
					</button>
					
					<div class="text-xs text-gray-400 whitespace-nowrap flex-shrink-0 min-w-[90px]">
						{formatTime(sessionStore.currentTime)} / {formatTime(sessionStore.duration)}
					</div>
					
					<div class="flex-1 min-w-0">
						<input 
							type="range" 
							value={sessionStore.currentTime}
							oninput={handleProgressInput}
							onchange={handleProgressChange}
							onmousedown={() => isDraggingProgress = true}
							onmouseup={() => isDraggingProgress = false}
							ontouchstart={() => isDraggingProgress = true}
							ontouchend={() => isDraggingProgress = false}
							min="0"
							max={sessionStore.duration}
							step="0.1"
							class="w-full h-2.5 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
						/>
					</div>
					
					<div class="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
						Beat: {sessionStore.currentBeatIndex >= 0 ? sessionStore.currentBeatIndex + 1 : '-'}
					</div>
				</div>
			</div>

			<!-- Spectrogram Display -->
			{#if sessionStore.currentSession && !sessionStore.isSessionInitializing}
					<SvgWaveformDisplay
					currentTime={sessionStore.currentTime}
					bpm={sessionStore.bpm}
					targetBPM={sessionStore.targetBPM}
					{audioEngine}
					beatOffset={sessionStore.beatOffset}
					beatsPerLine={sessionStore.currentSession.beatsPerLine}
					isPlaying={sessionStore.isPlaying}
					rectsPerBeatMode={sessionStore.currentSession.rectsPerBeatMode ?? 'auto'}
					onChunkLoop={handleChunkLoop}
					onClearLoop={handleClearLoop}
					{loopingChunkIndices}
					onSeek={(time) => audioEngine.seekTo(time)}
					isAnnotationMode={sessionStore.isAnnotationMode}
					annotations={previewAnnotation 
						? [...(sessionStore.currentSession.annotations || []), previewAnnotation]
						: (sessionStore.currentSession.annotations || [])}
					onAnnotationCreated={handleAnnotationCreatedFromCanvas}
					onAnnotationUpdated={handleAnnotationUpdated}
					onAnnotationDeleted={handleAnnotationDeleted}
					onAnnotationModalStateChange={handleAnnotationModalStateChange}
					filename={sessionStore.currentSession.filename.replace(/\.[^/.]+$/, "")}
					currentSession={sessionStore.currentSession}
				/>
			{:else if sessionStore.isSessionInitializing}
				<!-- Loading state for waveform -->
				<div class="bg-gray-800 rounded-lg p-8 text-center">
					<div class="text-gray-400">
						<div class="animate-pulse">
							{isExtractingStems ? 'Extracting stems from VirtualDJ file...' : 'Loading and analyzing audio...'}
						</div>
						{#if isExtractingStems}
							<div class="mt-4 p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg max-w-md mx-auto">
								<p class="text-sm text-blue-300 mb-2">
									<strong>Stem extraction in progress</strong>
								</p>
								{#if stemExtractionProgress}
									<p class="text-xs text-blue-400">{stemExtractionProgress}</p>
								{:else}
									<p class="text-xs text-blue-400">This may take 30-60 seconds...</p>
								{/if}
							</div>
						{:else if sessionStore.isDetectingBpm}
							<div class="text-sm mt-2">Detecting BPM...</div>
						{/if}
					</div>
				</div>
			{/if}



		{:else if sessionStore.isSessionInitializing}
			<!-- Loading state while checking for previous session or extracting stems -->
			<div class="bg-gray-800 rounded-lg p-8 text-center">
				<div class="text-gray-400">
					{#if isExtractingStems}
						<div class="animate-pulse">
							Extracting stems from VirtualDJ file...
						</div>
						<div class="mt-4 p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg max-w-md mx-auto">
							<p class="text-sm text-blue-300 mb-2">
								<strong>Stem extraction in progress</strong>
							</p>
							{#if stemExtractionProgress}
								<p class="text-xs text-blue-400">{stemExtractionProgress}</p>
							{:else}
								<p class="text-xs text-blue-400">This may take 30-60 seconds...</p>
							{/if}
						</div>
					{:else}
						<div class="animate-pulse">Loading previous session...</div>
					{/if}
				</div>
			</div>
		{:else if selectedMode === null}
			<!-- Mode Selector -->
			<div class="space-y-6">
				<div class="text-center space-y-2">
					<h2 class="text-2xl font-bold text-white">Choose Mode</h2>
					<p class="text-gray-400">Select how you want to work with audio</p>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<!-- Normal Mode -->
					<button
						class="bg-gray-800 hover:bg-gray-700 border-2 border-gray-700 hover:border-blue-500 rounded-lg p-8 text-center transition-all cursor-pointer"
						onclick={() => selectedMode = 'normal'}
					>
						<div class="space-y-3">
							<div class="text-4xl">🎵</div>
							<h3 class="text-xl font-semibold text-white">Normal Mode</h3>
							<p class="text-gray-400 text-sm">Single audio track analysis</p>
						</div>
					</button>
					<!-- Stem Mode -->
					<button
						class="bg-gray-800 hover:bg-gray-700 border-2 border-gray-700 hover:border-blue-500 rounded-lg p-8 text-center transition-all cursor-pointer"
						onclick={() => selectedMode = 'stem'}
					>
						<div class="space-y-3">
							<div class="text-4xl">🎛️</div>
							<h3 class="text-xl font-semibold text-white">Stem Mode</h3>
							<p class="text-gray-400 text-sm">Multiple audio tracks together</p>
						</div>
					</button>
				</div>
			</div>
		{:else if selectedMode === 'normal'}
			<!-- Normal Mode Song List -->
			<SongList 
				onSongSelected={handleSongSelected}
				onFilesDrop={handleFilesDrop}
			/>
		{:else if selectedMode === 'stem'}
			<!-- Stem Mode List -->
			<StemList 
				onStemSessionSelected={handleSongSelected}
				onFilesDrop={handleStemFilesDrop}
			/>
		{/if}
		</div>
		
		<!-- Sidebar -->
		{#if sessionStore.currentSession}
			<Sidebar {audioEngine} {bpmDetector} {persistenceService} />
		{/if}
	</div>
	
	<!-- Footer -->
	<footer class="bg-gray-800 border-t border-gray-700 px-4 py-3 text-center">
		<p class="text-sm text-gray-400">
			Made with ❤️ by <a href="https://vester.si/blog/me?utm_source=musicality-nerd" target="_blank" class="text-amber-500 hover:text-amber-400 transition-colors">Demjan</a>
		</p>
	</footer>
</main>


<style>
	kbd {
		font-family: monospace;
		font-size: 0.75rem;
	}

	.slider::-webkit-slider-thumb {
		appearance: none;
		height: 12px;
		width: 12px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1f2937;
	}

	.slider::-moz-range-thumb {
		height: 12px;
		width: 12px;
		border-radius: 50%;
		background: #3b82f6;
		cursor: pointer;
		border: 2px solid #1f2937;
	}
</style>
