/**
 * Canvas Waveform Utilities
 * Functions for drawing waveform visualizations on HTML5 Canvas
 */

import type { Annotation } from '../types';
import type { ChunkBounds, WaveformConfig, WaveformBar } from './svgWaveform';

/**
 * Cached hatch pattern source canvas (created once, reused)
 */
let hatchPatternSource: HTMLCanvasElement | null = null;

function getHatchPatternSource(): HTMLCanvasElement {
	if (!hatchPatternSource) {
		const patternSize = 12;
		hatchPatternSource = document.createElement('canvas');
		hatchPatternSource.width = patternSize;
		hatchPatternSource.height = patternSize;
		const patternCtx = hatchPatternSource.getContext('2d');
		if (patternCtx) {
			patternCtx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
			patternCtx.lineWidth = 1;

			patternCtx.beginPath();
			patternCtx.moveTo(0, patternSize);
			patternCtx.lineTo(patternSize, 0);
			patternCtx.stroke();

			patternCtx.beginPath();
			patternCtx.moveTo(-3, 3);
			patternCtx.lineTo(3, -3);
			patternCtx.stroke();

			patternCtx.beginPath();
			patternCtx.moveTo(9, 15);
			patternCtx.lineTo(15, 9);
			patternCtx.stroke();
		}
	}
	return hatchPatternSource;
}

/**
 * Draw diagonal hatching pattern for empty areas (chunk -1)
 */
export function drawDiagonalHatch(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number
): void {
	const source = getHatchPatternSource();
	const fillPattern = ctx.createPattern(source, 'repeat');
	if (fillPattern) {
		ctx.fillStyle = fillPattern;
		ctx.fillRect(x, y, width, height);
	}
}

/**
 * Draw beat grid lines (static/inactive style only).
 * Batches lines by type into single stroke calls to avoid per-line save/restore overhead.
 */
export function drawBeatGrid(
	ctx: CanvasRenderingContext2D,
	beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>,
	height: number
): void {
	// Batch lines by type for efficient drawing
	const quarterLines: number[] = [];
	const beatLineXs: number[] = [];
	const halfBeatLines: number[] = [];

	for (const line of beatLines) {
		switch (line.type) {
			case 'quarter':
				quarterLines.push(line.x);
				break;
			case 'beat':
				beatLineXs.push(line.x);
				break;
			default:
				halfBeatLines.push(line.x);
		}
	}

	// Draw half-beat lines (lightest)
	if (halfBeatLines.length > 0) {
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
		ctx.lineWidth = 0.5;
		ctx.beginPath();
		for (const x of halfBeatLines) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		ctx.stroke();
	}

	// Draw beat lines (medium)
	if (beatLineXs.length > 0) {
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (const x of beatLineXs) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		ctx.stroke();
	}

	// Draw quarter lines (brightest)
	if (quarterLines.length > 0) {
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		for (const x of quarterLines) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		ctx.stroke();
	}
}

/**
 * Draw active beat line flash highlights on an overlay canvas.
 * Only draws the lines that are currently active (flashing).
 */
export function drawActiveBeatFlash(
	ctx: CanvasRenderingContext2D,
	beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>,
	height: number,
	activeIndices: Set<number>
): void {
	if (activeIndices.size === 0) return;

	// Batch active lines by style (half-beat vs full beat)
	const activeHalfBeatXs: number[] = [];
	const activeBeatXs: number[] = [];

	for (const index of activeIndices) {
		const line = beatLines[index];
		if (!line) continue;
		if (line.type === 'half-beat') {
			activeHalfBeatXs.push(line.x);
		} else {
			activeBeatXs.push(line.x);
		}
	}

	// Draw active half-beat lines (subtle flash)
	if (activeHalfBeatXs.length > 0) {
		ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
		ctx.lineWidth = 0.8;
		ctx.beginPath();
		for (const x of activeHalfBeatXs) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		ctx.stroke();
	}

	// Draw active beat/quarter lines (bright flash with glow)
	if (activeBeatXs.length > 0) {
		ctx.save();
		ctx.strokeStyle = '#fbbf24';
		ctx.lineWidth = 3;
		ctx.shadowColor = 'rgba(251, 191, 36, 0.8)';
		ctx.shadowBlur = 4;
		ctx.beginPath();
		for (const x of activeBeatXs) {
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
		}
		ctx.stroke();
		ctx.restore();
	}
}

/**
 * Draw beat numbers (1-4 cycling) at the top-left of each beat area
 */
export function drawBeatNumbers(
	ctx: CanvasRenderingContext2D,
	beatsPerLine: number,
	width: number,
	height: number
): void {
	ctx.save();
	ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
	ctx.font = '10px monospace';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	
	const beatWidth = width / beatsPerLine;
	const padding = 2; // Small padding from top-left corner

	for (let i = 0; i < beatsPerLine; i++) {
		const beatNumber = (i % 4) + 1; // Cycle 1, 2, 3, 4
		const x = i * beatWidth + padding;
		const y = padding;

		ctx.fillText(String(beatNumber), x, y);
	}
	
	ctx.restore();
}

/**
 * Draw waveform bars
 */
export function drawWaveformBars(
	ctx: CanvasRenderingContext2D,
	bars: Array<WaveformBar>,
	stemBars?: Array<Array<WaveformBar>>,
	stemColors?: string[],
	stemEnabled?: boolean[]
): void {
	// If stem mode, draw overlayed stems
	if (stemBars && stemColors && stemEnabled) {
		stemBars.forEach((stemBarSet, stemIndex) => {
			if (!stemEnabled[stemIndex]) return;
			
			const color = stemColors[stemIndex] || '#3b82f6';
			ctx.fillStyle = color;
			ctx.globalAlpha = 0.25;
			
			stemBarSet.forEach(bar => {
				if (!bar.isEmpty) {
					ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
				}
			});
		});
		ctx.globalAlpha = 1.0;
	} else {
		// Single track mode
		bars.forEach(bar => {
			if (bar.isEmpty) return;
			
			if (bar.annotationColors && bar.annotationColors.length > 0) {
				// Draw annotation color sections
				bar.annotationColors.forEach(colorSection => {
					// Background tint
					ctx.fillStyle = colorSection.color;
					ctx.globalAlpha = 0.4;
					ctx.fillRect(bar.x, colorSection.startY, bar.width, colorSection.endY - colorSection.startY);
					
					// Overlay waveform bar portion
					const overlapY = Math.max(bar.y, colorSection.startY);
					const overlapHeight = Math.min(bar.y + bar.height, colorSection.endY) - overlapY;
					if (overlapHeight > 0) {
						ctx.fillStyle = colorSection.color;
						ctx.globalAlpha = 1.0;
						ctx.fillRect(bar.x, overlapY, bar.width, overlapHeight);
					}
				});
				ctx.globalAlpha = 1.0;
			} else {
				// Normal waveform bar
				ctx.fillStyle = '#3b82f6';
				ctx.globalAlpha = 0.8;
				ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
				ctx.globalAlpha = 1.0;
			}
		});
	}
}

/**
 * Draw active bar flash overlay
 */
export function drawActiveBarFlash(
	ctx: CanvasRenderingContext2D,
	bar: WaveformBar | null
): void {
	if (!bar) return;
	
	ctx.fillStyle = '#fbbf24';
	ctx.globalAlpha = 0.08;
	ctx.fillRect(bar.x, 0, bar.width, ctx.canvas.height);
	ctx.globalAlpha = 1.0;
}

/**
 * Draw song start marker line (for chunk -1)
 */
export function drawSongStartMarker(
	ctx: CanvasRenderingContext2D,
	x: number,
	height: number
): void {
	ctx.save();
	ctx.strokeStyle = '#fbbf24';
	ctx.lineWidth = 2;
	ctx.globalAlpha = 0.8;
	
	ctx.beginPath();
	ctx.moveTo(x, 0);
	ctx.lineTo(x, height);
	ctx.stroke();
	
	// Draw "Song Start" text
	ctx.fillStyle = '#fbbf24';
	ctx.font = '10px monospace';
	ctx.globalAlpha = 0.8;
	ctx.fillText('Song Start', x + 2, 15);
	
	ctx.restore();
}

/**
 * Draw annotation placeholder (for drag preview)
 */
export function drawAnnotationPlaceholder(
	ctx: CanvasRenderingContext2D,
	startX: number,
	endX: number,
	height: number,
	color: string,
	isPoint: boolean
): void {
	const width = isPoint ? 12 : Math.max(20, endX - startX);
	
	ctx.save();
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.3;
	ctx.fillRect(startX, 0, width, height);
	
	ctx.strokeStyle = color;
	ctx.lineWidth = 2;
	ctx.globalAlpha = 0.6;
	ctx.setLineDash([4, 4]);
	ctx.strokeRect(startX, 0, width, height);
	
	ctx.restore();
}

/**
 * Setup canvas for high DPI displays
 */
export function setupHighDPICanvas(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
	contextOptions?: CanvasRenderingContext2DSettings
): void {
	const dpr = 1;

	// Set actual size in memory (scaled for DPI)
	canvas.width = width * dpr;
	canvas.height = height * dpr;

	// Scale down using CSS
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;

	// Scale the drawing context so everything draws at the correct size
	// willReadFrequently: false hints to the browser to keep the canvas GPU-accelerated
	const mergedOptions = { willReadFrequently: false, ...contextOptions };
	const ctx = canvas.getContext('2d', mergedOptions);
	if (ctx) {
		ctx.scale(dpr, dpr);
	}
}

