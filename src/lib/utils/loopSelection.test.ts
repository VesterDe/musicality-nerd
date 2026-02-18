import { describe, it, expect } from 'vitest';
import { handleLoopToggle, createInitialState, type LoopSelectionState } from './loopSelection';

function stateWith(
	chunks: number[],
	lastActivated: number | null = null,
	lastDeactivated: number | null = null
): LoopSelectionState {
	return {
		loopingChunks: new Set(chunks),
		lastActivatedChunk: lastActivated,
		lastDeactivatedChunk: lastDeactivated
	};
}

function activeChunks(state: LoopSelectionState): number[] {
	return Array.from(state.loopingChunks).sort((a, b) => a - b);
}

describe('handleLoopToggle', () => {
	describe('basic toggle (no shift)', () => {
		it('adds a chunk when clicking an inactive chunk', () => {
			const state = createInitialState();
			const result = handleLoopToggle(state, 3, false);
			expect(activeChunks(result)).toEqual([3]);
			expect(result.lastActivatedChunk).toBe(3);
		});

		it('removes a chunk when clicking an active chunk', () => {
			const state = stateWith([3], 3);
			const result = handleLoopToggle(state, 3, false);
			expect(activeChunks(result)).toEqual([]);
			expect(result.lastDeactivatedChunk).toBe(3);
		});

		it('adds multiple chunks individually', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 1, false);
			state = handleLoopToggle(state, 5, false);
			state = handleLoopToggle(state, 3, false);
			expect(activeChunks(state)).toEqual([1, 3, 5]);
		});
	});

	describe('shift+activate range', () => {
		it('fills range from last activated to clicked chunk', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 1, false); // activate 1
			state = handleLoopToggle(state, 5, true); // shift+activate 5 → fill 1-5
			expect(activeChunks(state)).toEqual([1, 2, 3, 4, 5]);
			expect(state.lastActivatedChunk).toBe(5);
		});

		it('fills range in reverse direction', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 5, false); // activate 5
			state = handleLoopToggle(state, 1, true); // shift+activate 1 → fill 1-5
			expect(activeChunks(state)).toEqual([1, 2, 3, 4, 5]);
			expect(state.lastActivatedChunk).toBe(1);
		});

		it('uses last activated chunk as anchor (not any active chunk)', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 7, false); // activate 7
			state = handleLoopToggle(state, 5, false); // activate 5 (now last activated)
			state = handleLoopToggle(state, 1, true); // shift+activate 1 → anchor is 5
			expect(activeChunks(state)).toEqual([1, 2, 3, 4, 5, 7]);
		});

		it('preserves existing chunks outside the range', () => {
			let state = stateWith([10], 10);
			state = handleLoopToggle(state, 3, false); // activate 3
			state = handleLoopToggle(state, 6, true); // shift+activate 6 → fill 3-6
			expect(activeChunks(state)).toEqual([3, 4, 5, 6, 10]);
		});
	});

	describe('shift+deactivate range', () => {
		it('removes range from last deactivated to clicked chunk', () => {
			let state = stateWith([1, 2, 3, 4, 5]);
			state = handleLoopToggle(state, 5, false); // deactivate 5
			state = handleLoopToggle(state, 2, true); // shift+deactivate 2 → remove 2-5
			expect(activeChunks(state)).toEqual([1]);
			expect(state.lastDeactivatedChunk).toBe(2);
		});

		it('removes range in reverse direction', () => {
			let state = stateWith([1, 2, 3, 4, 5]);
			state = handleLoopToggle(state, 1, false); // deactivate 1
			state = handleLoopToggle(state, 4, true); // shift+deactivate 4 → remove 1-4
			expect(activeChunks(state)).toEqual([5]);
		});

		it('only removes chunks in range, preserves others', () => {
			let state = stateWith([1, 2, 3, 4, 5, 8, 9]);
			state = handleLoopToggle(state, 2, false); // deactivate 2
			state = handleLoopToggle(state, 4, true); // shift+deactivate 4 → remove 2-4
			expect(activeChunks(state)).toEqual([1, 5, 8, 9]);
		});
	});

	describe('shift with no valid anchor', () => {
		it('falls back to single toggle when no anchor exists', () => {
			const state = createInitialState();
			const result = handleLoopToggle(state, 5, true);
			expect(activeChunks(result)).toEqual([5]);
			expect(result.lastActivatedChunk).toBe(5);
		});

		it('falls back when activate anchor was deactivated', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 3, false); // activate 3
			state = handleLoopToggle(state, 3, false); // deactivate 3 (anchor 3 no longer active)
			state = handleLoopToggle(state, 5, true); // shift+activate 5 → no valid anchor
			expect(activeChunks(state)).toEqual([5]);
			expect(state.lastActivatedChunk).toBe(5);
		});

		it('falls back when deactivate anchor was reactivated', () => {
			let state = stateWith([1, 2, 3, 4, 5]);
			state = handleLoopToggle(state, 3, false); // deactivate 3
			state = handleLoopToggle(state, 3, false); // reactivate 3 (deactivate anchor 3 no longer inactive)
			state = handleLoopToggle(state, 5, false); // deactivate 5
			// Now deactivate anchor is 5, shift+deactivate 2 should work
			state = handleLoopToggle(state, 2, true); // shift+deactivate from 5 to 2
			expect(activeChunks(state)).toEqual([1]);
		});
	});

	describe('mixed sequences', () => {
		it('tracks activate and deactivate anchors independently', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 1, false); // activate 1
			state = handleLoopToggle(state, 3, false); // activate 3
			expect(state.lastActivatedChunk).toBe(3);
			expect(state.lastDeactivatedChunk).toBeNull();

			state = handleLoopToggle(state, 1, false); // deactivate 1
			expect(state.lastActivatedChunk).toBe(3); // unchanged
			expect(state.lastDeactivatedChunk).toBe(1);
		});

		it('shift+activate then shift+deactivate in sequence', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 1, false); // activate 1
			state = handleLoopToggle(state, 5, true); // shift+activate 5 → 1-5 active
			expect(activeChunks(state)).toEqual([1, 2, 3, 4, 5]);

			state = handleLoopToggle(state, 5, false); // deactivate 5
			state = handleLoopToggle(state, 3, true); // shift+deactivate 3 → remove 3-5
			expect(activeChunks(state)).toEqual([1, 2]);
		});

		it('chained shift+activate extends from new anchor', () => {
			let state = createInitialState();
			state = handleLoopToggle(state, 1, false); // activate 1
			state = handleLoopToggle(state, 3, true); // shift+activate → 1-3
			expect(activeChunks(state)).toEqual([1, 2, 3]);
			expect(state.lastActivatedChunk).toBe(3);

			state = handleLoopToggle(state, 6, true); // shift+activate → 3-6
			expect(activeChunks(state)).toEqual([1, 2, 3, 4, 5, 6]);
		});
	});
});
