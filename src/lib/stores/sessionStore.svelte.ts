import type { TrackSession, Annotation } from '$lib/types';
import type { AudioEngine } from '$lib/audio/AudioEngine';
import type { PersistenceService } from '$lib/persistence/PersistenceService';
import { getColorName, getGroupKey, parseAnnotationGroup } from '$lib/utils/colorNames';

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
  rowHeight = $state(96);
  autoFollow = $state(false);
  showBeatNumbers = $state(false);

  // Annotation state
  isAnnotationMode = $state(false);
  annotationTemplate = $state({
    name: '', // Empty = use color name automatically
    color: '#00ff00'
  });
  annotationCounter = $state(1); // Legacy, kept for compatibility
  annotationCounters = $state<Record<string, number>>({}); // Per-color counters: { green: 3, red: 1 }
  hiddenAnnotationGroups = $state<Set<string>>(new Set()); // Group keys that are hidden

  // UI state
  isDetectingBpm = $state(false);
  isSessionInitializing = $state(false);

  // Debounce timers
  private rowHeightDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

  // Rectangles Per Beat Management
  async updateRectsPerBeatMode(value: 'auto' | number) {
    if (!this.currentSession || !this.persistenceService) return;

    try {
      const updatedSession = await this.persistenceService.updateRectsPerBeatMode(
        this.currentSession.id,
        value
      );
      this.currentSession = updatedSession;
    } catch (error) {
      console.error('Failed to update rects per beat mode:', error);
    }
  }

  // Row Height Management
  updateRowHeight(value: number) {
    // Update local state immediately for responsive UI
    this.rowHeight = value;
    if (this.currentSession) {
      this.currentSession.rowHeight = value;
    }

    // Debounce persistence
    if (this.rowHeightDebounceTimer) {
      clearTimeout(this.rowHeightDebounceTimer);
    }

    this.rowHeightDebounceTimer = setTimeout(async () => {
      if (!this.currentSession || !this.persistenceService) return;

      try {
        await this.persistenceService.updateRowHeight(this.currentSession.id, value);
      } catch (error) {
        console.error('Failed to persist row height:', error);
      }
    }, 300);
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

  /**
   * Get the next counter value for a specific color (without incrementing)
   */
  getNextCounterForColor(color: string): number {
    const colorName = getColorName(color);
    return (this.annotationCounters[colorName] ?? 0) + 1;
  }

  /**
   * Increment the counter for a specific color
   */
  incrementCounterForColor(color: string): void {
    const colorName = getColorName(color);
    this.annotationCounters[colorName] = (this.annotationCounters[colorName] ?? 0) + 1;
  }

  /**
   * Reset all per-color counters
   */
  resetAnnotationCounters(): void {
    this.annotationCounters = {};
  }

  /**
   * Toggle visibility of a group by its group key
   */
  toggleGroupVisibility(groupKey: string): void {
    const newSet = new Set(this.hiddenAnnotationGroups);
    if (newSet.has(groupKey)) {
      newSet.delete(groupKey);
    } else {
      newSet.add(groupKey);
    }
    this.hiddenAnnotationGroups = newSet;
  }

  /**
   * Check if a group is visible
   */
  isGroupVisible(groupKey: string): boolean {
    return !this.hiddenAnnotationGroups.has(groupKey);
  }

  /**
   * Get visible annotations (filtered by hiddenAnnotationGroups)
   */
  get visibleAnnotations(): Annotation[] {
    if (!this.currentSession?.annotations) return [];
    if (this.hiddenAnnotationGroups.size === 0) return this.currentSession.annotations;

    return this.currentSession.annotations.filter((annotation) => {
      const groupKey = getGroupKey(annotation.label);
      return !this.hiddenAnnotationGroups.has(groupKey);
    });
  }

  /**
   * Clear all annotations for the current session and reset counter
   */
  async clearAllAnnotations() {
    if (!this.currentSession || !this.persistenceService) return;
    try {
      const updatedSession = await this.persistenceService.clearAllAnnotations(this.currentSession.id);
      this.currentSession = updatedSession;
      this.resetAnnotationCounter();
      this.resetAnnotationCounters();
      this.hiddenAnnotationGroups = new Set();
    } catch (error) {
      console.error('Failed to clear all annotations:', error);
    }
  }

  /**
   * Update all annotations in a group with a new color
   */
  async updateGroupColor(groupKey: string, newColor: string) {
    if (!this.currentSession || !this.persistenceService) return;
    try {
      const updatedSession = await this.persistenceService.updateAnnotationsBulk(
        this.currentSession.id,
        (annotation) => getGroupKey(annotation.label) === groupKey,
        { color: newColor }
      );
      this.currentSession = updatedSession;
    } catch (error) {
      console.error('Failed to update group color:', error);
    }
  }

  /**
   * Rename all annotations in a group to a new base name
   * Preserves the number suffix for each annotation
   */
  async renameGroup(groupKey: string, newBaseName: string) {
    if (!this.currentSession || !this.persistenceService) return;
    try {
      // We need to update each annotation individually to preserve its number
      const annotations = this.currentSession.annotations || [];
      const matchingAnnotations = annotations.filter(
        (a) => getGroupKey(a.label) === groupKey
      );

      for (const annotation of matchingAnnotations) {
        const { number } = parseAnnotationGroup(annotation.label);
        const newLabel = number !== null ? `${newBaseName} ${number}` : newBaseName;
        await this.persistenceService.updateAnnotation(
          this.currentSession.id,
          annotation.id,
          { label: newLabel }
        );
      }

      // Reload the session to get all updates
      const session = await this.persistenceService.loadSession(this.currentSession.id);
      if (session) {
        this.currentSession = session;
      }
    } catch (error) {
      console.error('Failed to rename group:', error);
    }
  }

  // Session Management
  setCurrentSession(session: TrackSession | null) {
    this.currentSession = session;
    if (session) {
      this.beatsPerLine = session.beatsPerLine || 8;
      this.rowHeight = session.rowHeight ?? 96;
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

  // Beat Numbers Display
  toggleShowBeatNumbers() {
    this.showBeatNumbers = !this.showBeatNumbers;
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