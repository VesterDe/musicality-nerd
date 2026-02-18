export interface LoopSelectionState {
	loopingChunks: Set<number>;
	lastActivatedChunk: number | null;
	lastDeactivatedChunk: number | null;
}

export function createInitialState(): LoopSelectionState {
	return {
		loopingChunks: new Set(),
		lastActivatedChunk: null,
		lastDeactivatedChunk: null
	};
}

export function handleLoopToggle(
	state: LoopSelectionState,
	clickedChunk: number,
	shiftKey: boolean
): LoopSelectionState {
	const isCurrentlyActive = state.loopingChunks.has(clickedChunk);
	const newChunks = new Set(state.loopingChunks);

	if (shiftKey) {
		if (!isCurrentlyActive) {
			// Shift+click to activate: use lastActivatedChunk as anchor
			const anchor = state.lastActivatedChunk;
			if (anchor !== null && state.loopingChunks.has(anchor)) {
				// Fill range between anchor and clicked chunk
				const min = Math.min(anchor, clickedChunk);
				const max = Math.max(anchor, clickedChunk);
				for (let i = min; i <= max; i++) {
					newChunks.add(i);
				}
				return {
					loopingChunks: newChunks,
					lastActivatedChunk: clickedChunk,
					lastDeactivatedChunk: state.lastDeactivatedChunk
				};
			}
			// No valid anchor — fall through to single toggle
		} else {
			// Shift+click to deactivate: use lastDeactivatedChunk as anchor
			const anchor = state.lastDeactivatedChunk;
			if (anchor !== null && !state.loopingChunks.has(anchor)) {
				// Remove range between anchor and clicked chunk
				const min = Math.min(anchor, clickedChunk);
				const max = Math.max(anchor, clickedChunk);
				for (let i = min; i <= max; i++) {
					newChunks.delete(i);
				}
				return {
					loopingChunks: newChunks,
					lastDeactivatedChunk: clickedChunk,
					lastActivatedChunk: state.lastActivatedChunk
				};
			}
			// No valid anchor — fall through to single toggle
		}
	}

	// Normal click (or shift with no valid anchor): toggle single chunk
	if (isCurrentlyActive) {
		newChunks.delete(clickedChunk);
		return {
			loopingChunks: newChunks,
			lastDeactivatedChunk: clickedChunk,
			lastActivatedChunk: state.lastActivatedChunk
		};
	} else {
		newChunks.add(clickedChunk);
		return {
			loopingChunks: newChunks,
			lastActivatedChunk: clickedChunk,
			lastDeactivatedChunk: state.lastDeactivatedChunk
		};
	}
}
