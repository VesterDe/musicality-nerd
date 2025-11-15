/**
 * Canvas Waveform Utilities
 * Functions for drawing waveform visualizations on HTML5 Canvas
 */

import type { Annotation } from '../types';
import type { ChunkBounds, WaveformConfig, WaveformBar } from './svgWaveform';

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
	const patternSize = 12;
	const pattern = document.createElement('canvas');
	pattern.width = patternSize;
	pattern.height = patternSize;
	const patternCtx = pattern.getContext('2d');
	if (!patternCtx) return;

	// Draw diagonal lines
	patternCtx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
	patternCtx.lineWidth = 1;
	
	// Main diagonal
	patternCtx.beginPath();
	patternCtx.moveTo(0, patternSize);
	patternCtx.lineTo(patternSize, 0);
	patternCtx.stroke();
	
	// Additional diagonals for density
	patternCtx.beginPath();
	patternCtx.moveTo(-3, 3);
	patternCtx.lineTo(3, -3);
	patternCtx.stroke();
	
	patternCtx.beginPath();
	patternCtx.moveTo(9, 15);
	patternCtx.lineTo(15, 9);
	patternCtx.stroke();

	const fillPattern = ctx.createPattern(pattern, 'repeat');
	if (fillPattern) {
		ctx.fillStyle = fillPattern;
		ctx.fillRect(x, y, width, height);
	}
}

/**
 * Draw beat grid lines
 */
export function drawBeatGrid(
	ctx: CanvasRenderingContext2D,
	beatLines: Array<{ x: number; type: 'quarter' | 'beat' | 'half-beat' }>,
	height: number,
	activeBeatLineIndices?: Set<number>
): void {
	beatLines.forEach((line, index) => {
		const isActive = activeBeatLineIndices?.has(index) ?? false;
		const isHalfBeat = line.type === 'half-beat';
		
		ctx.save();
		
		if (isActive) {
			ctx.strokeStyle = isHalfBeat ? 'rgba(251, 191, 36, 0.3)' : '#fbbf24';
			ctx.lineWidth = isHalfBeat ? 0.8 : 3;
			if (!isHalfBeat) {
				ctx.shadowColor = 'rgba(251, 191, 36, 0.8)';
				ctx.shadowBlur = 4;
			}
		} else {
			switch (line.type) {
				case 'quarter':
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
					ctx.lineWidth = 1.5;
					break;
				case 'beat':
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
					ctx.lineWidth = 1;
					break;
				default:
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
					ctx.lineWidth = 0.5;
			}
		}
		
		ctx.beginPath();
		ctx.moveTo(line.x, 0);
		ctx.lineTo(line.x, height);
		ctx.stroke();
		
		ctx.restore();
	});
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
export function setupHighDPICanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
	const dpr = window.devicePixelRatio || 1;
	
	// Set actual size in memory (scaled for DPI)
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	
	// Scale down using CSS
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	
	// Scale the drawing context so everything draws at the correct size
	const ctx = canvas.getContext('2d');
	if (ctx) {
		ctx.scale(dpr, dpr);
	}
}

