<script lang="ts">
	import { sessionStore } from '$lib/stores/sessionStore.svelte';
	import { getGroupKey, parseAnnotationGroup, getColorForGroupKey, PRESET_COLORS } from '$lib/utils/colorNames';

	interface AnnotationGroup {
		groupKey: string;
		displayName: string;
		color: string | null;
		count: number;
	}

	const presetColors = PRESET_COLORS;

	// Track which group's color picker is open
	let colorPickerOpenFor = $state<string | null>(null);
	let colorPickerPosition = $state({ x: 0, y: 0 });
	// Track which group is being renamed
	let editingGroupKey = $state<string | null>(null);
	let editingName = $state('');

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

	function handleColorClick(group: AnnotationGroup, event: MouseEvent) {
		event.stopPropagation();
		// Toggle color picker for this group
		if (colorPickerOpenFor === group.groupKey) {
			colorPickerOpenFor = null;
		} else {
			// Get button position for fixed positioning
			const button = event.currentTarget as HTMLElement;
			const rect = button.getBoundingClientRect();
			colorPickerPosition = { x: rect.right + 4, y: rect.top };
			colorPickerOpenFor = group.groupKey;
			editingGroupKey = null; // Close name editor if open
		}
	}

	async function handleColorSelect(groupKey: string, color: string) {
		colorPickerOpenFor = null;
		await sessionStore.updateGroupColor(groupKey, color);
	}

	function handleNameClick(group: AnnotationGroup, event: MouseEvent) {
		event.stopPropagation();
		editingGroupKey = group.groupKey;
		editingName = group.displayName;
		colorPickerOpenFor = null; // Close color picker if open
	}

	async function handleNameSubmit(groupKey: string) {
		if (editingName.trim()) {
			await sessionStore.renameGroup(groupKey, editingName.trim());
		}
		editingGroupKey = null;
		editingName = '';
	}

	function handleNameKeydown(event: KeyboardEvent, groupKey: string) {
		if (event.key === 'Enter') {
			handleNameSubmit(groupKey);
		} else if (event.key === 'Escape') {
			editingGroupKey = null;
			editingName = '';
		}
	}

	function handleToggleVisibility(groupKey: string) {
		sessionStore.toggleGroupVisibility(groupKey);
	}

	// Close pickers when clicking outside
	function handleOutsideClick() {
		colorPickerOpenFor = null;
		if (editingGroupKey && editingName.trim()) {
			handleNameSubmit(editingGroupKey);
		}
	}
</script>

<svelte:window onclick={handleOutsideClick} />

{#if groups.length > 0}
	<div class="space-y-2">
		<h4 class="text-xs font-medium text-gray-400 uppercase tracking-wide">Groups</h4>
		<div class="space-y-1">
			{#each groups as group}
				{@const isVisible = sessionStore.isGroupVisible(group.groupKey)}
				<div
					class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-gray-700/50 hover:bg-gray-700 transition-colors"
					onclick={(e) => e.stopPropagation()}
				>
					<div class="flex items-center gap-2 flex-1 min-w-0">
						<!-- Color blob with picker -->
						<div class="relative">
							<button
								class="w-4 h-4 rounded-sm border border-gray-500 flex-shrink-0 cursor-pointer hover:scale-110 transition-transform hover:border-white"
								style="background-color: {group.color || '#888'}"
								onclick={(e) => handleColorClick(group, e)}
								title="Click to change group color"
							></button>

						</div>

						<!-- Editable name -->
						{#if editingGroupKey === group.groupKey}
							<input
								type="text"
								bind:value={editingName}
								onkeydown={(e) => handleNameKeydown(e, group.groupKey)}
								onblur={() => handleNameSubmit(group.groupKey)}
								onclick={(e) => e.stopPropagation()}
								class="flex-1 min-w-0 bg-gray-600 text-white text-sm px-1 py-0.5 rounded border border-gray-500 focus:border-green-500 focus:outline-none"
								autofocus
							/>
						{:else}
							<button
								class="text-sm text-gray-200 truncate text-left hover:text-white transition-colors"
								onclick={(e) => handleNameClick(group, e)}
								title="Click to rename group"
							>
								{group.displayName}
							</button>
						{/if}

						<span class="text-xs text-gray-500 flex-shrink-0">({group.count})</span>
					</div>

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

<!-- Fixed position color picker (outside scroll container) -->
{#if colorPickerOpenFor}
	{@const group = groups.find(g => g.groupKey === colorPickerOpenFor)}
	{#if group}
		<div
			class="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg p-2 shadow-xl"
			style="left: {colorPickerPosition.x}px; top: {colorPickerPosition.y}px; width: 120px;"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.key === 'Escape' && (colorPickerOpenFor = null)}
			role="dialog"
			aria-label="Color picker"
		>
			<div class="flex flex-wrap gap-1">
				{#each presetColors as color}
					<button
						class="rounded border-2 transition-all {group.color === color ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'}"
						style="width: 24px; height: 24px; background-color: {color};"
						onclick={() => handleColorSelect(group.groupKey, color)}
						title={color}
						aria-label="Select {color}"
					></button>
				{/each}
			</div>
			<div class="mt-2 pt-2 border-t border-gray-600">
				<input
					type="color"
					value={group.color || '#888888'}
					onchange={(e) => handleColorSelect(group.groupKey, e.currentTarget.value)}
					class="w-full h-6 bg-gray-700 border border-gray-600 rounded cursor-pointer"
					title="Custom color"
				/>
			</div>
		</div>
	{/if}
{/if}

<style>
	input[type="color"]::-webkit-color-swatch-wrapper {
		padding: 0;
	}
	input[type="color"]::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}
</style>
