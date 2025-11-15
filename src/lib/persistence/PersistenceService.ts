import { get, set, del, keys, clear } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';
import type { TrackSession, Annotation, Stem } from '../types';

const CURRENT_SESSION_KEY = 'current-session';
const SESSION_PREFIX = 'session-';

export class PersistenceService {
	/**
	 * Save a track session to IndexedDB
	 */
	async saveSession(session: TrackSession): Promise<void> {
		try {
			const sessionKey = `${SESSION_PREFIX}${session.id}`;
			await set(sessionKey, session);
			await set(CURRENT_SESSION_KEY, session.id);
		} catch (error) {
			throw new Error(`Failed to save session: ${error}`);
		}
	}

	/**
	 * Load a specific track session by ID
	 */
	async loadSession(sessionId: string): Promise<TrackSession | null> {
		try {
			const sessionKey = `${SESSION_PREFIX}${sessionId}`;
			const session = await get(sessionKey);
			return session || null;
		} catch (error) {
			console.error('Failed to load session:', error);
			return null;
		}
	}

	/**
	 * Load the most recently used session
	 */
	async loadCurrentSession(): Promise<TrackSession | null> {
		try {
			const currentSessionId = await get(CURRENT_SESSION_KEY);
			if (!currentSessionId) return null;
			
			return await this.loadSession(currentSessionId);
		} catch (error) {
			console.error('Failed to load current session:', error);
			return null;
		}
	}

	/**
	 * Set a session as the current active session
	 */
	async setCurrentSession(sessionId: string): Promise<void> {
		try {
			// Verify the session exists
			const session = await this.loadSession(sessionId);
			if (!session) {
				throw new Error('Session not found');
			}
			
			await set(CURRENT_SESSION_KEY, sessionId);
		} catch (error) {
			throw new Error(`Failed to set current session: ${error}`);
		}
	}

	/**
	 * Create a new track session from MP3 file
	 */
	async createSession(file: File): Promise<TrackSession> {
		const arrayBuffer = await file.arrayBuffer();
		
		const session: TrackSession = {
			id: uuidv4(),
			mp3Blob: arrayBuffer,
			filename: file.name,
			created: new Date().toISOString(),
			bpm: 0, // Default BPM
			beatOffset: 0, // Default offset in milliseconds
			manualBpm: false, // BPM not manually set initially
			beatsPerLine: 4, // Default beats per line
			beats: [],
			annotations: [], // Initialize empty annotations array
			targetBPM: 0, // Default target BPM (same as default BPM)
			rectsPerBeatMode: 'auto', // Default to auto mode
			mode: 'single' // Explicitly set single mode
		};

		await this.saveSession(session);
		return session;
	}

	/**
	 * Create a new stem session from multiple MP3 files
	 */
	async createStemSession(files: FileList): Promise<TrackSession> {
		if (files.length < 2) {
			throw new Error('Stem sessions require at least 2 audio files');
		}

		// Default colors for stems (can be customized later)
		const defaultColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
		
		const stems: Stem[] = await Promise.all(
			Array.from(files).map(async (file, index) => {
				const arrayBuffer = await file.arrayBuffer();
				return {
					id: uuidv4(),
					filename: file.name,
					mp3Blob: arrayBuffer,
					enabled: true, // All stems enabled by default
					color: defaultColors[index % defaultColors.length]
				};
			})
		);

		// Use the first file's name as the session filename (or generate a combined name)
		const sessionFilename = files.length === 1 
			? files[0].name 
			: `${files[0].name.replace(/\.[^/.]+$/, '')} (${files.length} stems)`;

		const session: TrackSession = {
			id: uuidv4(),
			filename: sessionFilename,
			created: new Date().toISOString(),
			bpm: 0, // Default BPM - will be detected from first stem
			beatOffset: 0, // Default offset in milliseconds
			manualBpm: false, // BPM not manually set initially
			beatsPerLine: 4, // Default beats per line
			beats: [],
			annotations: [], // Initialize empty annotations array
			targetBPM: 0, // Default target BPM (same as default BPM)
			rectsPerBeatMode: 'auto', // Default to auto mode
			mode: 'stem',
			stems: stems
		};

		await this.saveSession(session);
		return session;
	}

	/**
	 * Update a session with new data
	 */
	async updateSession(session: TrackSession): Promise<TrackSession> {
		// Load the existing session to preserve audio data
		const existingSession = await this.loadSession(session.id);
		if (!existingSession) {
			throw new Error('Session not found');
		}
		
		// Merge the new data with the existing session, preserving audio blobs based on mode
		const updatedSession: TrackSession = {
			...session,
		};
		
		if (existingSession.mode === 'stem' || session.mode === 'stem') {
			// For stem sessions, preserve stems array
			updatedSession.stems = existingSession.stems || session.stems;
		} else {
			// For single mode sessions, preserve mp3Blob
			updatedSession.mp3Blob = existingSession.mp3Blob || session.mp3Blob;
		}
		
		await this.saveSession(updatedSession);
		return updatedSession;
	}

	/**
	 * Update stem enabled state for a stem session
	 */
	async updateStemEnabled(sessionId: string, stemId: string, enabled: boolean): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		if (session.mode !== 'stem' || !session.stems) {
			throw new Error('Session is not a stem session');
		}

		const stem = session.stems.find(s => s.id === stemId);
		if (!stem) {
			throw new Error('Stem not found');
		}

		stem.enabled = enabled;
		await this.saveSession(session);
		return session;
	}
	
	/**
	 * Update target BPM for a session
	 */
	async updateSessionTargetBPM(sessionId: string, targetBPM: number): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}
		
		session.targetBPM = targetBPM;
		await this.saveSession(session);
		return session;
	}

	/**
	 * Update BPM for a session and regenerate beats
	 */
	async updateSessionBpm(sessionId: string, bpm: number, duration: number, isManual: boolean = false): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.bpm = bpm;
		session.manualBpm = isManual;
		
		// Regenerate beats array based on new BPM
		const beatInterval = 60 / bpm; // seconds per beat
		const offsetInSeconds = session.beatOffset / 1000; // Convert ms to seconds
		const totalBeats = Math.floor((duration - offsetInSeconds) / beatInterval);
		

		session.beats = [];
		for (let i = 0; i < totalBeats; i++) {
			session.beats.push({
				index: i,
				time: (i * beatInterval) + offsetInSeconds,
			});
		}

		await this.saveSession(session);
		return session;
	}

	/**
	 * Update beat offset for a session and regenerate beats
	 */
	async updateSessionOffset(sessionId: string, offsetMs: number, duration: number): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.beatOffset = Math.round(offsetMs);
		
		// Regenerate beats array with new offset
		const beatInterval = 60 / session.bpm; // seconds per beat
		const offsetInSeconds = session.beatOffset / 1000; // Convert ms to seconds
		const totalBeats = Math.floor((duration - offsetInSeconds) / beatInterval);
		

		session.beats = [];
		for (let i = 0; i < totalBeats; i++) {
			session.beats.push({
				index: i,
				time: (i * beatInterval) + offsetInSeconds,
			});
		}

		await this.saveSession(session);
		return session;
	}


	/**
	 * Update beats per line for a session
	 */
	async updateBeatsPerLine(sessionId: string, beatsPerLine: number): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.beatsPerLine = beatsPerLine;
		await this.saveSession(session);
		return session;
	}

	/**
	 * Update rectangles per beat mode (auto or manual value)
	 */
	async updateRectsPerBeatMode(sessionId: string, rectsPerBeatMode: 'auto' | number): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.rectsPerBeatMode = rectsPerBeatMode;
		await this.saveSession(session);
		return session;
	}

	/**
	 * Update session filename
	 */
	async updateSessionFilename(sessionId: string, filename: string): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.filename = filename;
		await this.saveSession(session);
		return session;
	}

	/**
	 * List all stored sessions (metadata only, no audio blobs)
	 */
	async listSessions(): Promise<Array<Omit<TrackSession, 'mp3Blob' | 'stems'> & { stemCount?: number; stemsEnabled?: number }>> {
		try {
			const allKeys = await keys();
			const sessionKeys = allKeys.filter(key => 
				typeof key === 'string' && key.startsWith(SESSION_PREFIX)
			);

			const sessions = await Promise.all(
				sessionKeys.map(async (key) => {
					const session = await get(key) as TrackSession;
					if (session) {
						// Return session metadata without the audio blobs
						const { mp3Blob, stems, ...metadata } = session;
						// For stem sessions, include stem count and enabled state in metadata
						if (session.mode === 'stem' && stems) {
							return {
								...metadata,
								stemCount: stems.length,
								stemsEnabled: stems.filter(s => s.enabled).length
							};
						}
						return metadata;
					}
					return null;
				})
			);

			return sessions
				.filter(session => session !== null)
				.sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());
		} catch (error) {
			console.error('Failed to list sessions:', error);
			return [];
		}
	}

	/**
	 * Delete a session
	 */
	async deleteSession(sessionId: string): Promise<void> {
		try {
			const sessionKey = `${SESSION_PREFIX}${sessionId}`;
			await del(sessionKey);

			// If this was the current session, clear the current session pointer
			const currentSessionId = await get(CURRENT_SESSION_KEY);
			if (currentSessionId === sessionId) {
				await del(CURRENT_SESSION_KEY);
			}
		} catch (error) {
			throw new Error(`Failed to delete session: ${error}`);
		}
	}

	/**
	 * Clear all stored data
	 */
	async clearAll(): Promise<void> {
		try {
			await clear();
		} catch (error) {
			throw new Error(`Failed to clear storage: ${error}`);
		}
	}

	/**
	 * Get storage usage estimate
	 */
	async getStorageUsage(): Promise<{ used: number; quota: number } | null> {
		if ('storage' in navigator && 'estimate' in navigator.storage) {
			try {
				const estimate = await navigator.storage.estimate();
				return {
					used: estimate.usage || 0,
					quota: estimate.quota || 0
				};
			} catch (error) {
				console.error('Failed to get storage estimate:', error);
			}
		}
		return null;
	}

	/**
	 * Check if storage quota is exceeded
	 */
	async isStorageQuotaExceeded(): Promise<boolean> {
		const usage = await this.getStorageUsage();
		if (!usage) return false;
		
		// Warn if using more than 80% of quota
		return usage.used / usage.quota > 0.8;
	}

	/**
	 * Add an annotation to a session
	 */
	async addAnnotation(sessionId: string, startTimeMs: number, endTimeMs: number, label: string, color: string, isPoint?: boolean): Promise<{ annotationId: string; session: TrackSession }> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		// Snap to 25ms increments
		const snappedStartTime = Math.round(startTimeMs / 25) * 25;
		const snappedEndTime = Math.round(endTimeMs / 25) * 25;

		const annotation: Annotation = {
			id: uuidv4(),
			startTimeMs: snappedStartTime,
			endTimeMs: snappedEndTime,
			label,
			color,
			isPoint
		};

		// Initialize annotations array if it doesn't exist (for backwards compatibility)
		if (!session.annotations) {
			session.annotations = [];
		}

		session.annotations.push(annotation);
		await this.saveSession(session);
		
		return { annotationId: annotation.id, session };
	}

	/**
	 * Update an existing annotation
	 */
	async updateAnnotation(sessionId: string, annotationId: string, updates: Partial<Omit<Annotation, 'id'>>): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		// Initialize annotations array if it doesn't exist (for backwards compatibility)
		if (!session.annotations) {
			session.annotations = [];
		}

		const annotation = session.annotations.find(a => a.id === annotationId);
		if (!annotation) {
			throw new Error('Annotation not found');
		}

		// Apply updates with snapping for time values
		if (updates.startTimeMs !== undefined) {
			annotation.startTimeMs = Math.round(updates.startTimeMs / 25) * 25;
		}
		if (updates.endTimeMs !== undefined) {
			annotation.endTimeMs = Math.round(updates.endTimeMs / 25) * 25;
		}
		if (updates.label !== undefined) {
			annotation.label = updates.label;
		}
		if (updates.color !== undefined) {
			annotation.color = updates.color;
		}
		if (updates.rowIndex !== undefined) {
			annotation.rowIndex = updates.rowIndex;
		}

		await this.saveSession(session);
		return session;
	}

	/**
	 * Remove an annotation from a session
	 */
	async removeAnnotation(sessionId: string, annotationId: string): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		// Initialize annotations array if it doesn't exist (for backwards compatibility)
		if (!session.annotations) {
			session.annotations = [];
		}

		const annotationIndex = session.annotations.findIndex(a => a.id === annotationId);
		if (annotationIndex < 0) {
			throw new Error('Annotation not found');
		}

		session.annotations.splice(annotationIndex, 1);
		await this.saveSession(session);
		return session;
	}

	/**
	 * Clear all annotations from a session
	 */
	async clearAllAnnotations(sessionId: string): Promise<TrackSession> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}
		session.annotations = [];
		await this.saveSession(session);
		return session;
	}
	
	/**
	 * Get all annotations for a session within a time range
	 */
	async getAnnotationsInRange(sessionId: string, startTimeMs: number, endTimeMs: number): Promise<Annotation[]> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		// Initialize annotations array if it doesn't exist (for backwards compatibility)
		if (!session.annotations) {
			return [];
		}

		return session.annotations.filter(annotation => 
			// Check if annotation overlaps with the requested range
			annotation.startTimeMs < endTimeMs && annotation.endTimeMs > startTimeMs
		);
	}
} 