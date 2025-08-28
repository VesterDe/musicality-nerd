<script lang="ts">
	interface Props {
		isAnnotationMode: boolean;
		onToggle: () => void;
		annotationTemplate: {
			name: string;
			color: string;
		};
		onTemplateChange: (template: { name: string; color: string }) => void;
		annotationCount: number;
		horizontal?: boolean;
	}

	let { 
		isAnnotationMode, 
		onToggle, 
		annotationTemplate,
		onTemplateChange,
		annotationCount,
		horizontal = false
	}: Props = $props();

	const presetColors = [
		'#00ff00', // Green (default)
		'#ff0000', // Red
		'#0080ff', // Blue
		'#ffff00', // Yellow
		'#ff00ff', // Magenta
		'#00ffff', // Cyan
		'#ff8000', // Orange
		'#ff0080', // Pink
	];

	function handleNameChange(event: Event) {
		const target = event.target as HTMLInputElement;
		onTemplateChange({
			...annotationTemplate,
			name: target.value
		});
	}

	function handleColorChange(color: string) {
		onTemplateChange({
			...annotationTemplate,
			color
		});
	}

	function handleCustomColorChange(event: Event) {
		const target = event.target as HTMLInputElement;
		onTemplateChange({
			...annotationTemplate,
			color: target.value
		});
	}
</script>

{#if horizontal}
	<!-- Horizontal layout -->
	<div class="flex items-center gap-6">
		<div class="flex items-center gap-3">
			<h3 class="text-sm font-semibold text-gray-300">Annotation Mode</h3>
			<label class="flex items-center space-x-3 cursor-pointer select-none">
				<input 
					type="checkbox" 
					checked={isAnnotationMode}
					onchange={onToggle}
					class="sr-only"
				/>
				<div class="relative inline-block">
					<div class="w-11 h-6 bg-gray-600 rounded-full shadow-inner transition-all duration-200 ease-in-out {isAnnotationMode ? 'bg-green-600 shadow-green-500/25' : 'bg-gray-600'}"></div>
					<div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-md transform transition-all duration-200 ease-in-out {isAnnotationMode ? 'translate-x-5 bg-green-50' : 'translate-x-0'}"></div>
					{#if isAnnotationMode}
						<div class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full flex items-center justify-center">
							<div class="w-2 h-2 bg-green-600 rounded-full opacity-75"></div>
						</div>
					{/if}
				</div>
				<span class="text-xs {isAnnotationMode ? 'text-green-400' : 'text-gray-500'} transition-colors duration-200">
					{isAnnotationMode ? 'ON' : 'OFF'}
				</span>
			</label>
		</div>

		<div class="h-8 w-px bg-gray-700"></div>

		<div class="text-xs {isAnnotationMode ? 'text-green-400' : 'text-gray-500 opacity-60'}">
			Press 'A' while playing to annotate • 'M' to toggle mode
		</div>

		<div class="h-8 w-px bg-gray-700"></div>

		<div class="flex items-center gap-3 {isAnnotationMode ? '' : 'opacity-50'}">
			<label class="flex items-center gap-2">
				<span class="text-xs text-gray-400">Name Pattern:</span>
				<input
					type="text"
					value={annotationTemplate.name}
					oninput={handleNameChange}
					placeholder="e.g., Mark, Section, Beat"
					disabled={!isAnnotationMode}
					class="bg-gray-700 text-white text-sm px-3 py-1 rounded border border-gray-600 {isAnnotationMode ? 'focus:border-green-500' : 'cursor-not-allowed'} focus:outline-none w-32"
				/>
				<span class="text-xs text-gray-500">
					Next: {annotationTemplate.name} {annotationCount}
				</span>
			</label>
		</div>

		<div class="h-8 w-px bg-gray-700"></div>

		<div class="flex items-center gap-3 {isAnnotationMode ? '' : 'opacity-50'}">
			<span class="text-xs text-gray-400">Color:</span>
			<div class="flex items-center space-x-2">
				<div class="flex space-x-1">
					{#each presetColors as color}
						<button
							class="w-6 h-6 rounded border-2 transition-all {annotationTemplate.color === color ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'} {isAnnotationMode ? '' : 'cursor-not-allowed'}"
							style="background-color: {color}"
							onclick={() => isAnnotationMode && handleColorChange(color)}
							disabled={!isAnnotationMode}
							title={color}
							aria-label="Select color {color}"
						></button>
					{/each}
				</div>
				<input
					type="color"
					value={annotationTemplate.color}
					oninput={handleCustomColorChange}
					disabled={!isAnnotationMode}
					class="w-8 h-6 bg-gray-700 border border-gray-600 rounded {isAnnotationMode ? 'cursor-pointer' : 'cursor-not-allowed'}"
					title="Custom color"
				/>
			</div>
		</div>
	</div>
{:else}
	<!-- Vertical/compact layout -->
	<div class="{horizontal ? '' : 'bg-gray-800 rounded-lg p-4'} space-y-3">
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold text-gray-300">Annotation Mode</h3>
			<label class="flex items-center space-x-3 cursor-pointer select-none">
				<input 
					type="checkbox" 
					checked={isAnnotationMode}
					onchange={onToggle}
					class="sr-only"
				/>
				<div class="relative inline-block">
					<div class="w-11 h-6 bg-gray-600 rounded-full shadow-inner transition-all duration-200 ease-in-out {isAnnotationMode ? 'bg-green-600 shadow-green-500/25' : 'bg-gray-600'}"></div>
					<div class="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full shadow-md transform transition-all duration-200 ease-in-out {isAnnotationMode ? 'translate-x-5 bg-green-50' : 'translate-x-0'}"></div>
					{#if isAnnotationMode}
						<div class="absolute left-0.5 top-0.5 w-5 h-5 rounded-full flex items-center justify-center">
							<div class="w-2 h-2 bg-green-600 rounded-full opacity-75"></div>
						</div>
					{/if}
				</div>
				<span class="text-xs {isAnnotationMode ? 'text-green-400' : 'text-gray-500'} transition-colors duration-200">
					{isAnnotationMode ? 'ON' : 'OFF'}
				</span>
			</label>
		</div>

		{#if !horizontal}
			<div class="space-y-3 pt-2 border-t border-gray-700 {isAnnotationMode ? '' : 'opacity-50'}">
				<div class="text-xs {isAnnotationMode ? 'text-green-400' : 'text-gray-500'}">
					Press 'A' while playing to annotate • 'M' to toggle mode
				</div>

				<div class="space-y-2">
					<label class="block">
						<span class="text-xs text-gray-400">Name Pattern</span>
						<input
							type="text"
							value={annotationTemplate.name}
							oninput={handleNameChange}
							placeholder="e.g., Mark, Section, Beat"
							disabled={!isAnnotationMode}
							class="mt-1 w-full bg-gray-700 text-white text-sm px-3 py-1.5 rounded border border-gray-600 {isAnnotationMode ? 'focus:border-green-500' : 'cursor-not-allowed'} focus:outline-none"
						/>
						<span class="text-xs text-gray-500">
							Next: {annotationTemplate.name} {annotationCount}
						</span>
					</label>

					<div>
						<span class="text-xs text-gray-400 block mb-2">Color</span>
						<div class="flex items-center space-x-2">
							<div class="flex space-x-1">
								{#each presetColors as color}
									<button
										class="w-6 h-6 rounded border-2 transition-all {annotationTemplate.color === color ? 'border-white scale-110' : 'border-gray-600 hover:border-gray-400'} {isAnnotationMode ? '' : 'cursor-not-allowed'}"
										style="background-color: {color}"
										onclick={() => isAnnotationMode && handleColorChange(color)}
										disabled={!isAnnotationMode}
										title={color}
									/>
								{/each}
							</div>
							<input
								type="color"
								value={annotationTemplate.color}
								oninput={handleCustomColorChange}
								disabled={!isAnnotationMode}
								class="w-8 h-6 bg-gray-700 border border-gray-600 rounded {isAnnotationMode ? 'cursor-pointer' : 'cursor-not-allowed'}"
								title="Custom color"
							/>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>
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