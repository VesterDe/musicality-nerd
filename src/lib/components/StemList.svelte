<script lang="ts">
	import { onMount } from 'svelte';
	import { PersistenceService } from '$lib/persistence/PersistenceService';
	import type { TrackSession } from '$lib/types';

	interface Props {
		onStemSessionSelected: (sessionId: string) => void;
		onFilesDrop: (files: FileList) => void;
	}

	let { onStemSessionSelected, onFilesDrop }: Props = $props();

	let persistenceService = new PersistenceService();
	let stemSessions: Array<Omit<TrackSession, 'mp3Blob' | 'stems'> & { stemCount?: number; stemsEnabled?: number }> = $state([]);
	let isLoading = $state(true);
	let isDragOver = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	onMount(async () => {
		await loadStemSessions();
	});

	async function loadStemSessions() {
		try {
			isLoading = true;
			const allSessions = await persistenceService.listSessions();
			// Filter to only stem sessions
			stemSessions = allSessions.filter(session => session.mode === 'stem');
		} catch (error) {
			console.error('Failed to load stem sessions:', error);
		} finally {
			isLoading = false;
		}
	}

	async function deleteStemSession(sessionId: string, filename: string) {
		if (!confirm(`Delete "${filename}"? This action cannot be undone.`)) {
			return;
		}

		try {
			await persistenceService.deleteSession(sessionId);
			await loadStemSessions(); // Refresh the list
		} catch (error) {
			console.error('Failed to delete stem session:', error);
			alert('Failed to delete stem session. Please try again.');
		}
	}

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}

	function formatDate(dateString: string): string {
		const date = new Date(dateString);
		const now = new Date();
		const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

		if (diffInHours < 1) {
			return 'Just now';
		} else if (diffInHours < 24) {
			return `${Math.floor(diffInHours)} hours ago`;
		} else if (diffInHours < 24 * 7) {
			return `${Math.floor(diffInHours / 24)} days ago`;
		} else {
			return date.toLocaleDateString();
		}
	}

	function getBpmDisplayText(session: Omit<TrackSession, 'mp3Blob' | 'stems'> & { stemCount?: number; stemsEnabled?: number }): string {
		return session.manualBpm ? `${session.bpm} BPM (manual)` : `${session.bpm} BPM (auto)`;
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
			const files = event.dataTransfer.files;
			// Check if it's a single .vdjstems file
			if (files.length === 1) {
				const file = files[0];
				if (file.name.toLowerCase().endsWith('.vdjstems') || file.name.toLowerCase().endsWith('.mp3.vdjstems')) {
					// Handle as .vdjstems file - pass to parent handler
					onFilesDrop(files);
					return;
				}
			}
			// Otherwise, handle as regular stem files
			onFilesDrop(files);
		}
	}

	function handleDropZoneClick() {
		fileInput?.click();
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="text-center space-y-2">
		<h2 class="text-2xl font-bold text-white">Stem Sessions</h2>
		<p class="text-gray-400">Select a stem session or drop multiple MP3 files</p>
	</div>

	<!-- Drop Zone -->
	<div 
		class="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center transition-colors cursor-pointer
			{isDragOver ? 'border-blue-400 bg-blue-400/10' : 'hover:border-gray-500'}"
		role="button"
		tabindex="0"
		aria-label="Drop multiple MP3 files here or click to browse"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		onclick={handleDropZoneClick}
		onkeydown={(e) => e.key === 'Enter' && handleDropZoneClick()}
	>
		<div class="space-y-3">
			<div class="text-3xl">🎛️</div>
			<h3 class="text-lg font-semibold text-white">Add New Stem Session</h3>
			<p class="text-gray-400 text-sm">
				Drop 2+ MP3 files or a VirtualDJ .vdjstems file here or click to browse
			</p>
			<div class="mt-4 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
				<p class="text-xs text-amber-300">
					<strong>Note:</strong> Extracting stems from .vdjstems files may take 30-60 seconds. 
					Processing happens entirely in your browser.
				</p>
			</div>
			<input 
				type="file" 
				accept="audio/*,audio/mpeg,audio/mp3,audio/mp4,audio/m4a,audio/ogg,audio/wav,audio/webm,.mp3,.wav,.vdjstems"
				multiple
				class="hidden"
				bind:this={fileInput}
				onchange={(e) => {
					const target = e.target as HTMLInputElement;
					if (target.files) {
						// Check if it's a single .vdjstems file
						if (target.files.length === 1) {
							const file = target.files[0];
							if (file.name.toLowerCase().endsWith('.vdjstems') || file.name.toLowerCase().endsWith('.mp3.vdjstems')) {
								onFilesDrop(target.files);
								return;
							}
						}
						// Otherwise, require at least 2 files
						if (target.files.length >= 2) {
							onFilesDrop(target.files);
						} else {
							alert('Stem mode requires at least 2 audio files or a VirtualDJ .vdjstems file');
						}
					}
				}}
			/>
		</div>
	</div>

	<!-- Loading State -->
	{#if isLoading}
		<div class="text-center py-8">
			<div class="text-gray-400">Loading stem sessions...</div>
		</div>
	{:else if stemSessions.length === 0}
		<!-- Empty State -->
		<div class="text-center py-12 space-y-4">
			<div class="text-6xl opacity-50">🎚️</div>
			<h3 class="text-xl font-semibold text-gray-300">No stem sessions yet</h3>
			<p class="text-gray-500">Drop 2+ MP3 files above to create your first stem session</p>
		</div>
	{:else}
		<!-- Stem Sessions Grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each stemSessions as session (session.id)}
				<div class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors">
					<!-- Session Header -->
					<div class="space-y-2 mb-4">
						<h3 class="font-semibold text-white truncate" title={session.filename}>
							{session.filename}
						</h3>
						<div class="text-sm text-gray-400 space-y-1">
							<div class="flex justify-between">
								<span>Stems:</span>
								<span>{session.stemCount || 0}</span>
							</div>
							<div class="flex justify-between">
								<span>Duration:</span>
								<span>{formatTime(session.beats.length > 0 ? session.beats[session.beats.length - 1].time : 0)}</span>
							</div>
							<div class="flex justify-between">
								<span>BPM:</span>
								<span>{getBpmDisplayText(session)}</span>
							</div>
							<div class="flex justify-between">
								<span>Created:</span>
								<span>{formatDate(session.created)}</span>
							</div>
							<div class="flex justify-between">
								<span>Annotations:</span>
								<span>{session.annotations?.length || 0}</span>
							</div>
						</div>
					</div>

					<!-- Actions -->
					<div class="flex space-x-2">
						<button
							class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors cursor-pointer"
							onclick={() => onStemSessionSelected(session.id)}
						>
							Load Session
						</button>
						<button
							class="bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white px-3 py-2 rounded text-sm transition-colors cursor-pointer"
							onclick={() => deleteStemSession(session.id, session.filename)}
							title="Delete session"
						>
							🗑️
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

