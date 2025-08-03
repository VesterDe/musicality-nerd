<script lang="ts">
	import { onMount } from 'svelte';
	import { PersistenceService } from '$lib/persistence/PersistenceService';
	import type { TrackSession } from '$lib/types';

	interface Props {
		onSongSelected: (sessionId: string) => void;
		onFilesDrop: (files: FileList) => void;
	}

	let { onSongSelected, onFilesDrop }: Props = $props();

	let persistenceService = new PersistenceService();
	let songs: Array<Omit<TrackSession, 'mp3Blob'>> = $state([]);
	let isLoading = $state(true);
	let isDragOver = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	onMount(async () => {
		await loadSongs();
	});

	async function loadSongs() {
		try {
			isLoading = true;
			songs = await persistenceService.listSessions();
		} catch (error) {
			console.error('Failed to load songs:', error);
		} finally {
			isLoading = false;
		}
	}

	async function deleteSong(sessionId: string, filename: string) {
		if (!confirm(`Delete "${filename}"? This action cannot be undone.`)) {
			return;
		}

		try {
			await persistenceService.deleteSession(sessionId);
			await loadSongs(); // Refresh the list
		} catch (error) {
			console.error('Failed to delete song:', error);
			alert('Failed to delete song. Please try again.');
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

	function getBpmDisplayText(song: Omit<TrackSession, 'mp3Blob'>): string {
		return song.manualBpm ? `${song.bpm} BPM (manual)` : `${song.bpm} BPM (auto)`;
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
			onFilesDrop(event.dataTransfer.files);
		}
	}

	function handleDropZoneClick() {
		fileInput?.click();
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="text-center space-y-2">
		<h2 class="text-2xl font-bold text-white">Your Songs</h2>
		<p class="text-gray-400">Select a song to analyze or drop a new MP3 file</p>
	</div>

	<!-- Drop Zone -->
	<div 
		class="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center transition-colors
			{isDragOver ? 'border-blue-400 bg-blue-400/10' : 'hover:border-gray-500'}"
		role="button"
		tabindex="0"
		aria-label="Drop MP3 file here or click to browse"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		onclick={handleDropZoneClick}
		onkeydown={(e) => e.key === 'Enter' && handleDropZoneClick()}
	>
		<div class="space-y-3">
			<div class="text-3xl">🎵</div>
			<h3 class="text-lg font-semibold text-white">Add New Song</h3>
			<p class="text-gray-400 text-sm">
				Drop your MP3 file here or click to browse
			</p>
			<input 
				type="file" 
				accept="audio/*"
				class="hidden"
				bind:this={fileInput}
				onchange={(e) => {
					const target = e.target as HTMLInputElement;
					if (target.files) {
						onFilesDrop(target.files);
					}
				}}
			/>
		</div>
	</div>

	<!-- Loading State -->
	{#if isLoading}
		<div class="text-center py-8">
			<div class="text-gray-400">Loading songs...</div>
		</div>
	{:else if songs.length === 0}
		<!-- Empty State -->
		<div class="text-center py-12 space-y-4">
			<div class="text-6xl opacity-50">🎼</div>
			<h3 class="text-xl font-semibold text-gray-300">No songs yet</h3>
			<p class="text-gray-500">Drop an MP3 file above to get started with your first song</p>
		</div>
	{:else}
		<!-- Songs Grid -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each songs as song (song.id)}
				<div class="bg-gray-800 rounded-lg p-4 border border-gray-700 hover:border-gray-600 transition-colors">
					<!-- Song Header -->
					<div class="space-y-2 mb-4">
						<h3 class="font-semibold text-white truncate" title={song.filename}>
							{song.filename}
						</h3>
						<div class="text-sm text-gray-400 space-y-1">
							<div class="flex justify-between">
								<span>Duration:</span>
								<span>{formatTime(song.beats.length > 0 ? song.beats[song.beats.length - 1].time : 0)}</span>
							</div>
							<div class="flex justify-between">
								<span>BPM:</span>
								<span>{getBpmDisplayText(song)}</span>
							</div>
							<div class="flex justify-between">
								<span>Created:</span>
								<span>{formatDate(song.created)}</span>
							</div>
							<div class="flex justify-between">
								<span>Annotations:</span>
								<span>{song.annotations?.length || 0}</span>
							</div>
						</div>
					</div>

					<!-- Actions -->
					<div class="flex space-x-2">
						<button
							class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors"
							onclick={() => onSongSelected(song.id)}
						>
							Load Song
						</button>
						<button
							class="bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white px-3 py-2 rounded text-sm transition-colors"
							onclick={() => deleteSong(song.id, song.filename)}
							title="Delete song"
						>
							🗑️
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>