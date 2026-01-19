<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import { getGroupKey, parseAnnotationGroup, getColorForGroupKey, NAME_TO_COLOR_MAP } from '$lib/utils/colorNames';

	interface AnnotationGroup {
		groupKey: string;
		displayName: string;
		color: string | null;
		count: number;
	}

	// Derive groups from annotations
	let groups = $derived.by(() => {
		const annotations = sessionStore.currentSession?.annotations || [];
		if (annotations.length === 0) return [];

		const groupMap = new Map<string, AnnotationGroup>();

		for (const annotation of annotations) {
			const groupKey = getGroupKey(annotation.label);
			const { baseName } = parseAnnotationGroup(annotation.label);

			if (!groupMap.has(groupKey)) {
				// Try to get color from group key if it's a color name
				const colorFromKey = getColorForGroupKey(groupKey);
				groupMap.set(groupKey, {
					groupKey,
					displayName: baseName,
					color: colorFromKey || annotation.color,
					count: 0
				});
			}

			const group = groupMap.get(groupKey)!;
			group.count++;
		}

		// Sort by count descending, then alphabetically
		return Array.from(groupMap.values()).sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			return a.displayName.localeCompare(b.displayName);
		});
	});

	function handleColorBlobClick(group: AnnotationGroup) {
		// Set the annotation template to use this group's color and name
		const color = group.color || '#00ff00';
		// If it's a known color name, leave name empty so it auto-generates
		const isKnownColorName = group.groupKey in NAME_TO_COLOR_MAP;
		sessionStore.updateAnnotationTemplate({
			name: isKnownColorName ? '' : group.displayName,
			color
		});
		// Enable annotation mode if not already enabled
		if (!sessionStore.isAnnotationMode) {
			sessionStore.toggleAnnotationMode();
		}
	}

	function handleToggleVisibility(groupKey: string) {
		sessionStore.toggleGroupVisibility(groupKey);
	}
</script>

{#if groups.length > 0}
	<div class="space-y-2">
		<h4 class="text-xs font-medium text-gray-400 uppercase tracking-wide">Groups</h4>
		<div class="space-y-1">
			{#each groups as group}
				{@const isVisible = sessionStore.isGroupVisible(group.groupKey)}
				<div
					class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-gray-700/50 hover:bg-gray-700 transition-colors"
				>
					<button
						class="flex items-center gap-2 flex-1 min-w-0 text-left"
						onclick={() => handleColorBlobClick(group)}
						title="Click to use this color for new annotations"
					>
						<div
							class="w-4 h-4 rounded-sm border border-gray-500 flex-shrink-0 cursor-pointer hover:scale-110 transition-transform"
							style="background-color: {group.color || '#888'}"
						></div>
						<span class="text-sm text-gray-200 truncate">
							{group.displayName}
						</span>
						<span class="text-xs text-gray-500">({group.count})</span>
					</button>

					<button
						type="button"
						class="flex items-center cursor-pointer select-none flex-shrink-0"
						onclick={() => handleToggleVisibility(group.groupKey)}
						aria-pressed={isVisible}
						aria-label="Toggle {group.displayName} visibility"
					>
						<div class="relative inline-block">
							<div
								class="w-8 h-4 rounded-full shadow-inner transition-all duration-200 ease-in-out {isVisible
									? 'bg-green-600'
									: 'bg-gray-600'}"
							></div>
							<div
								class="absolute left-0.5 top-0.5 w-3 h-3 bg-white rounded-full shadow-md transform transition-all duration-200 ease-in-out {isVisible
									? 'translate-x-4'
									: 'translate-x-0'}"
							></div>
						</div>
					</button>
				</div>
			{/each}
		</div>
	</div>
{/if}
