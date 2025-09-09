import type { TrackSession, Annotation } from '$lib/types';
import type { AudioEngine } from '$lib/audio/AudioEngine';
import type { PersistenceService } from '$lib/persistence/PersistenceService';

export class SessionStore {
	// Core session data
	currentSession = $state<TrackSession | null>(null);
	
	// Audio state
	bpm = $state(120);
	targetBPM = $state(120);
	beatOffset = $state(0);
	sliderBeatOffset = $state(0);
	isPlaying = $state(false);
	currentTime = $state(0);
	duration = $state(0);
	currentBeatIndex = $state(-1);
	
	// Display settings
	beatsPerLine = $state(8);
	autoFollow = $state(false);
	
	// Annotation state
	isAnnotationMode = $state(false);
	annotationTemplate = $state({
		name: 'Mark',
		color: '#00ff00'
	});
	annotationCounter = $state(1);
	
	// UI state
	isDetectingBpm = $state(false);
	isSessionInitializing = $state(false);
	
	// Service references (set by main page)
	private audioEngine: AudioEngine | null = null;
	private persistenceService: PersistenceService | null = null;
	
	// Methods for service setup
	setServices(audioEngine: AudioEngine, persistenceService: PersistenceService) {
		this.audioEngine = audioEngine;
		this.persistenceService = persistenceService;
	}
	
	// BPM Management
	async updateBPM(value: number, isManual: boolean = false) {
		this.bpm = value;
		
		// Update target BPM to match if not manually set
		if (!isManual) {
			this.targetBPM = value;
		}
		
		// Update playback speed
		this.updatePlaybackSpeed();
		
		// Persist changes
		if (this.currentSession && this.persistenceService) {
			try {
				const updatedSession = await this.persistenceService.updateSessionBpm(
					this.currentSession.id, 
					value, 
					this.duration, 
					isManual
				);
				this.currentSession = updatedSession;
			} catch (error) {
				console.error('Failed to update BPM:', error);
			}
		}
	}
	
	// Target BPM Management
	updateTargetBPM(value: number) {
		this.targetBPM = value;
		this.updatePlaybackSpeed();
		this.updateSessionSpeed();
	}
	
	// Playback Speed
	updatePlaybackSpeed() {
		if (this.audioEngine && this.bpm > 0) {
			const rate = this.targetBPM / this.bpm;
			this.audioEngine.setPlaybackRate(rate);
		}
	}
	
	async updateSessionSpeed() {
		if (!this.currentSession || !this.persistenceService) return;
		
		// Update the session with new speed settings
		this.currentSession.targetBPM = this.targetBPM;
		
		try {
			await this.persistenceService.updateSessionTargetBPM(
				this.currentSession.id, 
				this.targetBPM
			);
		} catch (error) {
			console.error('Failed to save speed settings:', error);
		}
	}
	
	// Beat Offset Management
	async updateBeatOffset(value: number) {
		this.beatOffset = value;
		
		if (this.currentSession && this.persistenceService) {
			try {
				const updatedSession = await this.persistenceService.updateSessionOffset(
					this.currentSession.id, 
					value, 
					this.duration
				);
				this.currentSession = updatedSession;
			} catch (error) {
				console.error('Failed to update offset:', error);
			}
		}
	}
	
	// Beats Per Line Management
	async updateBeatsPerLine(value: number) {
		if (!this.currentSession || !this.persistenceService) return;
		
		try {
			const updatedSession = await this.persistenceService.updateBeatsPerLine(
				this.currentSession.id, 
				value
			);
			this.currentSession = updatedSession;
			this.beatsPerLine = value;
		} catch (error) {
			console.error('Failed to update beats per line:', error);
		}
	}
	
	// Annotation Management
	toggleAnnotationMode() {
		this.isAnnotationMode = !this.isAnnotationMode;
	}
	
	updateAnnotationTemplate(template: { name: string; color: string }) {
		this.annotationTemplate = template;
	}
	
	incrementAnnotationCounter() {
		this.annotationCounter++;
	}
	
	resetAnnotationCounter() {
		this.annotationCounter = 1;
	}
	
	// Session Management
	setCurrentSession(session: TrackSession | null) {
		this.currentSession = session;
		if (session) {
			this.beatsPerLine = session.beatsPerLine || 8;
		}
	}
	
	// Playback Control
	setIsPlaying(value: boolean) {
		this.isPlaying = value;
	}
	
	setCurrentTime(value: number) {
		this.currentTime = value;
	}
	
	setDuration(value: number) {
		this.duration = value;
	}
	
	// Auto-follow
	toggleAutoFollow() {
		this.autoFollow = !this.autoFollow;
	}
	
	setAutoFollow(value: boolean) {
		this.autoFollow = value;
	}
	
	// UI State
	setIsDetectingBpm(value: boolean) {
		this.isDetectingBpm = value;
	}
	
	setIsSessionInitializing(value: boolean) {
		this.isSessionInitializing = value;
	}
	
	// Beat tracking
	updateCurrentBeat() {
		if (!this.currentSession) {
			this.currentBeatIndex = -1;
			return;
		}
		
		// Find current beat based on time
		const beatIndex = this.currentSession.beats.findIndex((beat, index) => {
			const nextBeat = this.currentSession!.beats[index + 1];
			return this.currentTime >= beat.time && (!nextBeat || this.currentTime < nextBeat.time);
		});
		
		this.currentBeatIndex = beatIndex;
	}
	
	// Get computed values
	get playbackSpeedPercentage() {
		return this.bpm > 0 ? Math.round((this.targetBPM / this.bpm) * 100) : 100;
	}
	
	get maxBeatOffset() {
		return this.bpm > 0 ? (60 / this.bpm) * 500 : 500;
	}
}

// Create singleton instance
export const sessionStore = new SessionStore();