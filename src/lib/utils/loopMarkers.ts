export interface LoopMarkerPair {
	markerA: number; // fraction 0-1
	markerB: number; // fraction 0-1
}

export interface EffectiveRange {
	start: number; // fraction, always <= end
	end: number; // fraction, always >= start
}

export interface TimeRange {
	startTime: number; // seconds
	endTime: number; // seconds
}

export function clampFraction(f: number): number {
	return Math.max(0, Math.min(1, f));
}

export function getEffectiveRange(markerA: number, markerB: number): EffectiveRange {
	const a = clampFraction(markerA);
	const b = clampFraction(markerB);
	return {
		start: Math.min(a, b),
		end: Math.max(a, b)
	};
}

export function getMarkerPosition(
	chunkIndex: number,
	positions: Map<number, LoopMarkerPair>
): LoopMarkerPair {
	return positions.get(chunkIndex) ?? { markerA: 0, markerB: 1 };
}

export function fractionRangeToTimeRange(
	range: EffectiveRange,
	chunkTime: TimeRange
): { start: number; end: number } {
	const duration = chunkTime.endTime - chunkTime.startTime;
	return {
		start: chunkTime.startTime + range.start * duration,
		end: chunkTime.startTime + range.end * duration
	};
}
