<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import HtmlAnnotation from './HtmlAnnotation.svelte';
	import type { Annotation } from '../types';
	import type { ChunkBounds, WaveformConfig } from '../utils/svgWaveform';

	interface Props {
		chunkIndex: number;
		bounds: ChunkBounds;
		isSpecialChunk: boolean;
		waveformBars: Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean; annotationColors?: Array<{ color: string; startY: number; endY: number }> }>;
		waveformBarsPerStem?: Array<Array<{ x: number; y: number; width: number; height: number; isEmpty?: boolean }>>;
		stemColors?: string[];
		stemEnabled?: boolean[];
		beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>;
		headerInfo: string;
		startTime: number;
		endTime: number;
		annotations: Array<Annotation & { stackPosition: number }>;
		placeholderAnnotation: (Annotation & { stackPosition: number }) | null;
		isLooping: boolean;
		isActiveChunk: boolean;
		activeBeatLineIndices?: Set<number>;
		activeBarIndex: number;
		playheadVisible: boolean;
		playheadX: number;
		waveformConfig: WaveformConfig;
		chunkDuration: number;
		beatOffset: number;
		exportingChunk: boolean;
		onWaveformMouseDown: (event: MouseEvent, chunkIndex: number, bounds: ChunkBounds) => void;
		onWaveformTouchStart: (event: TouchEvent, chunkIndex: number, bounds: ChunkBounds) => void;
		onChunkExport: (chunkIndex: number, startTime: number, endTime: number) => void;
		onToggleChunkLoop: (chunkIndex: number, startTime: number, endTime: number) => void;
		onEditAnnotation: (annotation: Annotation) => void;
		onDeleteAnnotation: (annotationId: string) => void;
		onMoveAnnotation: (annotationId: string, newStartTimeMs: number, newEndTimeMs: number) => void;
		onDuplicateAnnotation: (annotation: Annotation) => void;
		onGroupExport?: () => void;
		showGroupExportButton?: boolean;
		loopingChunkCount?: number;
		registerPlayheadLayer?: (line: HTMLElement | null, topTriangle: HTMLElement | null, bottomTriangle: HTMLElement | null) => void;
		unregisterPlayheadLayer?: () => void;
	}

	let {
		chunkIndex,
		bounds,
		isSpecialChunk,
		waveformBars,
		waveformBarsPerStem,
		stemColors,
		stemEnabled,
		beatLines,
		headerInfo,
		startTime,
		endTime,
		annotations,
		placeholderAnnotation,
		isLooping,
		isActiveChunk,
		activeBeatLineIndices,
		activeBarIndex,
		playheadVisible,
		playheadX,
		waveformConfig,
		chunkDuration,
		beatOffset,
		exportingChunk,
		onWaveformMouseDown,
		onWaveformTouchStart,
		onChunkExport,
		onToggleChunkLoop,
		onEditAnnotation,
		onDeleteAnnotation,
		onMoveAnnotation,
		onDuplicateAnnotation,
		onGroupExport,
		showGroupExportButton = false,
		loopingChunkCount = 0,
		registerPlayheadLayer,
		unregisterPlayheadLayer
	}: Props = $props();

	// DOM references for playhead elements
	let playheadLine: SVGLineElement | null = $state(null);
	let playheadTopTriangle: HTMLDivElement | null = $state(null);
	let playheadBottomTriangle: HTMLDivElement | null = $state(null);

	// Playhead triangle positions (calculated once)
	const topY = 42; // 40px header + 2px padding
	const bottomY = topY + waveformConfig.height - 10;

	// Register/unregister playhead layer DOM elements when refs are available
	// Track only the DOM refs, not the function props
	$effect(() => {
		// Only track the DOM refs, not the function props
		const line = playheadLine;
		const top = playheadTopTriangle;
		const bottom = playheadBottomTriangle;
		
		if (line !== null && top !== null && bottom !== null) {
			// Use untrack to prevent tracking function references
			untrack(() => {
				if (registerPlayheadLayer) {
					console.debug('[Playhead] SingleLineWaveformDisplay registering', { chunkIndex, line: !!line, top: !!top, bottom: !!bottom });
					registerPlayheadLayer(line, top, bottom);
				} else {
					console.warn('[Playhead] registerPlayheadLayer callback not available', { chunkIndex });
				}
			});
		} else {
			console.debug('[Playhead] SingleLineWaveformDisplay refs not ready', { chunkIndex, line: !!playheadLine, top: !!playheadTopTriangle, bottom: !!playheadBottomTriangle });
		}
		
		return () => {
			untrack(() => {
				if (unregisterPlayheadLayer) {
					console.debug('[Playhead] SingleLineWaveformDisplay unregistering', { chunkIndex });
					unregisterPlayheadLayer();
				}
			});
		};
	});
</script>

<div class="relative mb-0 bg-gray-900 rounded-lg overflow-hidden {playheadVisible ? 'current-chunk' : ''}" data-chunk-index={chunkIndex}>
	<!-- Chunk Header -->
	<div class="px-3 py-2 bg-gray-800 text-sm text-gray-300 flex items-center justify-between">
		<div>{headerInfo}</div>
		<div class="flex items-center space-x-2">
			<!-- Show group download button only on the first looping chunk -->
			{#if showGroupExportButton && loopingChunkCount > 1}
				<button
					class="px-2 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs transition-colors"
					onclick={onGroupExport}
				>
					📦 ({loopingChunkCount})
				</button>
			{/if}
			<button
				class="px-2 py-1 rounded text-xs transition-colors {exportingChunk ? 'bg-gray-600 text-gray-400' : 'bg-green-600 hover:bg-green-700 text-white'}"
				onclick={() => onChunkExport(chunkIndex, startTime, endTime)}
				disabled={exportingChunk}
			>
				{exportingChunk ? '⏳' : '📥'}
			</button>
			<button
				class="px-2 py-1 rounded text-xs transition-colors {isLooping ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}"
				onclick={() => onToggleChunkLoop(chunkIndex, startTime, endTime)}
			>
				{isLooping ? '⏹️' : '🔁'}
			</button>
		</div>
	</div>

	<!-- SVG Waveform -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<svg
		width={waveformConfig.width}
		height={waveformConfig.height}
		viewBox="0 0 {waveformConfig.width} {waveformConfig.height}"
		class="block cursor-crosshair"
		onmousedown={(event) => onWaveformMouseDown(event, chunkIndex, bounds)}
		style:touch-action="none"
		ontouchstart={(event) => onWaveformTouchStart(event, chunkIndex, bounds)}
	>
		{#if isSpecialChunk}
			<!-- Special chunk -1 with diagonal hatching pattern -->
			<defs>
				<pattern id="diagonalHatch-{chunkIndex}" patternUnits="userSpaceOnUse" width="12" height="12">
					<rect width="12" height="12" fill="transparent"/>
					<path d="M0,12 L12,0" stroke="rgba(156, 163, 175, 0.4)" stroke-width="1"/>
					<path d="M-3,3 L3,-3" stroke="rgba(156, 163, 175, 0.4)" stroke-width="1"/>
					<path d="M9,15 L15,9" stroke="rgba(156, 163, 175, 0.4)" stroke-width="1"/>
				</pattern>
			</defs>
			
			<!-- Empty space area with diagonal pattern -->
			{@const offsetInSeconds = Math.abs(beatOffset) / 1000}
			{@const emptyAreaWidth = beatOffset > 0 
				? (offsetInSeconds / chunkDuration) * waveformConfig.width
				: ((chunkDuration - offsetInSeconds) / chunkDuration) * waveformConfig.width}
			{#if emptyAreaWidth > 0}
				<rect
					x="0"
					y="0"
					width={emptyAreaWidth}
					height={waveformConfig.height}
					fill="url(#diagonalHatch-{chunkIndex})"
					pointer-events="none"
				/>
			{/if}
			
			<!-- Render song waveform bars only -->
			{#if waveformBarsPerStem && waveformBarsPerStem.length > 0 && stemColors && stemEnabled}
				<!-- Stem mode: render overlayed stems -->
				{#each waveformBarsPerStem as stemBars, stemIndex}
					{#if stemEnabled[stemIndex]}
						{#each stemBars as bar}
							{#if !bar.isEmpty}
								<rect
									x={bar.x}
									y={bar.y}
									width={bar.width}
									height={bar.height}
									fill={stemColors[stemIndex] || '#3b82f6'}
									opacity="0.25"
								/>
							{/if}
						{/each}
					{/if}
				{/each}
			{:else}
				<!-- Single track mode -->
				{#each waveformBars as bar}
					{#if !bar.isEmpty}
						{#if bar.annotationColors && bar.annotationColors.length > 0}
							{#each bar.annotationColors as colorSection}
								<rect
									x={bar.x}
									y={colorSection.startY}
									width={bar.width}
									height={colorSection.endY - colorSection.startY}
									fill={colorSection.color}
									opacity="0.4"
								/>
								<rect
									x={bar.x}
									y={Math.max(bar.y, colorSection.startY)}
									width={bar.width}
									height={Math.min(bar.y + bar.height, colorSection.endY) - Math.max(bar.y, colorSection.startY)}
									fill={colorSection.color}
									opacity="1"
								/>
							{/each}
						{:else}
							<rect
								x={bar.x}
								y={bar.y}
								width={bar.width}
								height={bar.height}
								fill="#3b82f6"
								opacity="0.8"
							/>
						{/if}
					{/if}
				{/each}
			{/if}
			
			<!-- Song start marker line -->
			{@const songStartX = beatOffset > 0 
				? (offsetInSeconds / chunkDuration) * waveformConfig.width
				: ((chunkDuration - offsetInSeconds) / chunkDuration) * waveformConfig.width}
			<line
				x1={songStartX}
				y1="0"
				x2={songStartX}
				y2={waveformConfig.height}
				stroke="#fbbf24"
				stroke-width="2"
				opacity="0.8"
			/>
			<text
				x={songStartX + 2}
				y="15"
				fill="#fbbf24"
				font-size="10"
				font-family="monospace"
				opacity="0.8"
			>Song Start</text>
		{:else}
			<!-- Beat Grid Lines with flashing for active chunk -->
			{#each beatLines as line, beatIndex}
				{@const isActiveBeat = isActiveChunk && activeBeatLineIndices && activeBeatLineIndices.has(beatIndex)}
				{@const isHalfBeat = line.type === 'half-beat'}
				<line
					x1={line.x}
					y1="0"
					x2={line.x}
					y2={waveformConfig.height}
					stroke={isActiveBeat 
						? (isHalfBeat ? 'rgba(251, 191, 36, 0.3)' : '#fbbf24')
						: line.type === 'quarter' ? 'rgba(255, 255, 255, 0.5)' 
						: line.type === 'beat' ? 'rgba(255, 255, 255, 0.3)'
						: 'rgba(255, 255, 255, 0.15)'}
					stroke-width={isActiveBeat 
						? (isHalfBeat ? '0.8' : '3')
						: line.type === 'quarter' ? '1.5' : line.type === 'beat' ? '1' : '0.5'}
					class={isActiveBeat ? 'beat-active' : ''}
					style={isActiveBeat ? (isHalfBeat ? '' : 'filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.8));') : ''}
				/>
			{/each}

			<!-- Waveform Bars -->
			{#if waveformBarsPerStem && waveformBarsPerStem.length > 0 && stemColors && stemEnabled}
				<!-- Stem mode: render overlayed stems -->
				{#each waveformBarsPerStem as stemBars, stemIndex}
					{#if stemEnabled[stemIndex]}
						{#each stemBars as bar}
							{#if !bar.isEmpty}
								<rect
									x={bar.x}
									y={bar.y}
									width={bar.width}
									height={bar.height}
									fill={stemColors[stemIndex] || '#3b82f6'}
									opacity="0.25"
								/>
							{/if}
						{/each}
					{/if}
				{/each}
			{:else}
				<!-- Single track mode: render normal bars -->
				{#each waveformBars as bar}
					{#if bar.annotationColors && bar.annotationColors.length > 0}
						{#each bar.annotationColors as colorSection}
							<rect
								x={bar.x}
								y={colorSection.startY}
								width={bar.width}
								height={colorSection.endY - colorSection.startY}
								fill={colorSection.color}
								opacity="0.4"
							/>
							<rect
								x={bar.x}
								y={Math.max(bar.y, colorSection.startY)}
								width={bar.width}
								height={Math.min(bar.y + bar.height, colorSection.endY) - Math.max(bar.y, colorSection.startY)}
								fill={colorSection.color}
								opacity="1"
							/>
						{/each}
					{:else}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							fill="#3b82f6"
							opacity="0.8"
						/>
					{/if}
				{/each}
			{/if}

			<!-- Static playhead line (positioned via rAF, hidden by default) -->
			<line
				bind:this={playheadLine}
				x1="0"
				y1="0"
				x2="0"
				y2={waveformConfig.height}
				stroke="#fbbf24"
				stroke-width="1.5"
				opacity="0.3"
				pointer-events="none"
				style="display: none; transform-origin: 0 0;"
			/>

			<!-- Annotated bar flash overlay (only when bar has annotations) -->
			{#if isActiveChunk}
				{@const _activeIndex = activeBarIndex >= 0 && activeBarIndex < waveformBars.length ? activeBarIndex : -1}
				{@const _activeBar = _activeIndex >= 0 ? waveformBars[_activeIndex] : null}
				{#if _activeBar && _activeBar.annotationColors && _activeBar.annotationColors.length > 0}
					{#key activeBarIndex}
						<rect
							x={_activeBar.x}
							y="0"
							width={_activeBar.width}
							height={waveformConfig.height}
							fill="#fbbf24"
							opacity="0.08"
							class="annotation-bar-flash"
							pointer-events="none"
						/>
					{/key}
				{/if}
			{/if}
		{/if}
	</svg>

	<!-- Annotations for this chunk -->
	<div class="absolute pointer-events-none" style:top="40px" style:left="0px" style:width="{waveformConfig.width}px" style:height="{waveformConfig.height}px">
		{#each annotations as annotation (annotation.id)}
			<div class="pointer-events-auto">
				<HtmlAnnotation
					{annotation}
					chunkBounds={bounds}
					chunkWidth={waveformConfig.width}
					chunkHeight={waveformConfig.height}
					{chunkIndex}
					stackPosition={annotation.stackPosition || 0}
					onEdit={onEditAnnotation}
					onDelete={onDeleteAnnotation}
					onMove={onMoveAnnotation}
					onDuplicate={onDuplicateAnnotation}
				/>
			</div>
		{/each}

		<!-- Placeholder annotation if visible in this chunk -->
		{#if placeholderAnnotation}
			<div class="pointer-events-none opacity-60">
				<HtmlAnnotation
					annotation={placeholderAnnotation}
					chunkBounds={bounds}
					chunkWidth={waveformConfig.width}
					chunkHeight={waveformConfig.height}
					{chunkIndex}
					stackPosition={placeholderAnnotation.stackPosition || 0}
					isPlaceholder={true}
				/>
			</div>
		{/if}
	</div>

	<!-- Static playhead triangles (positioned via rAF, hidden by default) -->
	<!-- Top triangle pointing down -->
	<div
		bind:this={playheadTopTriangle}
		class="absolute pointer-events-none"
		style="display: none; left: 0px; top: {topY}px; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 8px solid #fbbf24; filter: drop-shadow(0 0 2px rgba(251, 191, 36, 0.8)); z-index: 20;"
	></div>
	
	<!-- Bottom triangle pointing up -->
	<div
		bind:this={playheadBottomTriangle}
		class="absolute pointer-events-none"
		style="display: none; left: 0px; top: {bottomY}px; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 8px solid #fbbf24; filter: drop-shadow(0 0 2px rgba(251, 191, 36, 0.8)); z-index: 20;"
	></div>
</div>

<style>
	/* Beat marker active state with smooth transitions */
	:global(.beat-active) {
		transition: stroke 0.05s ease-out, stroke-width 0.05s ease-out, filter 0.05s ease-out;
		animation: beatFlash 0.1s ease-out;
	}

	/* Quick flash animation for beat markers as playhead crosses them */
	@keyframes beatFlash {
		0% {
			opacity: 1;
			stroke-width: 3;
		}
		50% {
			opacity: 0.8;
			stroke-width: 4;
		}
		100% {
			opacity: 1;
			stroke-width: 3;
		}
	}

	/* Subtle flash animation for annotated bars as playhead crosses them */
	:global(.annotation-bar-flash) {
		transition: filter 0.05s ease-out;
		animation: annotationBarFlash 0.1s ease-out;
	}

	@keyframes annotationBarFlash {
		0% {
			filter: brightness(1.2);
		}
		50% {
			filter: brightness(1.25);
		}
		100% {
			filter: brightness(1.2);
		}
	}
</style>