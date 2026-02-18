import { describe, it, expect } from 'vitest';
import {
	clampFraction,
	getEffectiveRange,
	getMarkerPosition,
	fractionRangeToTimeRange,
	type LoopMarkerPair
} from './loopMarkers';

describe('clampFraction', () => {
	it('clamps values below 0 to 0', () => {
		expect(clampFraction(-0.5)).toBe(0);
		expect(clampFraction(-100)).toBe(0);
	});

	it('clamps values above 1 to 1', () => {
		expect(clampFraction(1.5)).toBe(1);
		expect(clampFraction(100)).toBe(1);
	});

	it('passes through values in [0, 1]', () => {
		expect(clampFraction(0)).toBe(0);
		expect(clampFraction(0.5)).toBe(0.5);
		expect(clampFraction(1)).toBe(1);
	});
});

describe('getEffectiveRange', () => {
	it('returns start <= end when markerA < markerB', () => {
		const range = getEffectiveRange(0.2, 0.8);
		expect(range.start).toBe(0.2);
		expect(range.end).toBe(0.8);
	});

	it('normalizes when markers are crossed (markerA > markerB)', () => {
		const range = getEffectiveRange(0.7, 0.3);
		expect(range.start).toBe(0.3);
		expect(range.end).toBe(0.7);
	});

	it('handles markers at the same position', () => {
		const range = getEffectiveRange(0.5, 0.5);
		expect(range.start).toBe(0.5);
		expect(range.end).toBe(0.5);
	});

	it('clamps out-of-bound fractions', () => {
		const range = getEffectiveRange(-0.1, 1.2);
		expect(range.start).toBe(0);
		expect(range.end).toBe(1);
	});

	it('handles both markers at 0', () => {
		const range = getEffectiveRange(0, 0);
		expect(range.start).toBe(0);
		expect(range.end).toBe(0);
	});

	it('handles both markers at 1', () => {
		const range = getEffectiveRange(1, 1);
		expect(range.start).toBe(1);
		expect(range.end).toBe(1);
	});
});

describe('getMarkerPosition', () => {
	it('returns stored position when it exists', () => {
		const positions = new Map<number, LoopMarkerPair>();
		positions.set(3, { markerA: 0.2, markerB: 0.6 });
		const result = getMarkerPosition(3, positions);
		expect(result).toEqual({ markerA: 0.2, markerB: 0.6 });
	});

	it('returns default [0, 1] when no position stored', () => {
		const positions = new Map<number, LoopMarkerPair>();
		const result = getMarkerPosition(5, positions);
		expect(result).toEqual({ markerA: 0, markerB: 1 });
	});

	it('returns correct position for different chunk indices', () => {
		const positions = new Map<number, LoopMarkerPair>();
		positions.set(0, { markerA: 0.1, markerB: 0.9 });
		positions.set(1, { markerA: 0.3, markerB: 0.7 });
		expect(getMarkerPosition(0, positions)).toEqual({ markerA: 0.1, markerB: 0.9 });
		expect(getMarkerPosition(1, positions)).toEqual({ markerA: 0.3, markerB: 0.7 });
	});
});

describe('fractionRangeToTimeRange', () => {
	it('interpolates fractions to absolute seconds', () => {
		const range = { start: 0.25, end: 0.75 };
		const chunkTime = { startTime: 10, endTime: 20 };
		const result = fractionRangeToTimeRange(range, chunkTime);
		expect(result.start).toBe(12.5);
		expect(result.end).toBe(17.5);
	});

	it('returns full chunk range for [0, 1]', () => {
		const range = { start: 0, end: 1 };
		const chunkTime = { startTime: 5, endTime: 15 };
		const result = fractionRangeToTimeRange(range, chunkTime);
		expect(result.start).toBe(5);
		expect(result.end).toBe(15);
	});

	it('handles zero-width range (same start and end)', () => {
		const range = { start: 0.5, end: 0.5 };
		const chunkTime = { startTime: 0, endTime: 10 };
		const result = fractionRangeToTimeRange(range, chunkTime);
		expect(result.start).toBe(5);
		expect(result.end).toBe(5);
	});

	it('handles chunk starting at 0', () => {
		const range = { start: 0, end: 0.5 };
		const chunkTime = { startTime: 0, endTime: 8 };
		const result = fractionRangeToTimeRange(range, chunkTime);
		expect(result.start).toBe(0);
		expect(result.end).toBe(4);
	});
});
