import { get, set, del, keys, clear } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';
import type { TrackSession, Annotation } from '../types';

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
	 * Create a new track session from MP3 file
	 */
	async createSession(file: File): Promise<TrackSession> {
		const arrayBuffer = await file.arrayBuffer();
		
		const session: TrackSession = {
			id: uuidv4(),
			mp3Blob: arrayBuffer,
			filename: file.name,
			created: new Date().toISOString(),
			bpm: 120, // Default BPM
			beatOffset: 0, // Default offset in milliseconds
			manualBpm: false, // BPM not manually set initially
			beatsPerLine: 4, // Default beats per line
			beats: [],
			annotations: [] // Initialize empty annotations array
		};

		await this.saveSession(session);
		return session;
	}

	/**
	 * Update BPM for a session and regenerate beats
	 */
	async updateSessionBpm(sessionId: string, bpm: number, duration: number, isManual: boolean = false): Promise<void> {
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
	}

	/**
	 * Update beat offset for a session and regenerate beats
	 */
	async updateSessionOffset(sessionId: string, offsetMs: number, duration: number): Promise<void> {
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
	}


	/**
	 * Update beats per line for a session
	 */
	async updateBeatsPerLine(sessionId: string, beatsPerLine: number): Promise<void> {
		const session = await this.loadSession(sessionId);
		if (!session) {
			throw new Error('Session not found');
		}

		session.beatsPerLine = beatsPerLine;
		await this.saveSession(session);
	}

	/**
	 * List all stored sessions (metadata only, no audio blobs)
	 */
	async listSessions(): Promise<Array<Omit<TrackSession, 'mp3Blob'>>> {
		try {
			const allKeys = await keys();
			const sessionKeys = allKeys.filter(key => 
				typeof key === 'string' && key.startsWith(SESSION_PREFIX)
			);

			const sessions = await Promise.all(
				sessionKeys.map(async (key) => {
					const session = await get(key) as TrackSession;
					if (session) {
						// Return session metadata without the audio blob
						const { mp3Blob, ...metadata } = session;
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
	async addAnnotation(sessionId: string, startTimeMs: number, endTimeMs: number, label: string, color: string, isPoint?: boolean): Promise<string> {
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
		
		return annotation.id;
	}

	/**
	 * Update an existing annotation
	 */
	async updateAnnotation(sessionId: string, annotationId: string, updates: Partial<Omit<Annotation, 'id'>>): Promise<void> {
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
	}

	/**
	 * Remove an annotation from a session
	 */
	async removeAnnotation(sessionId: string, annotationId: string): Promise<void> {
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