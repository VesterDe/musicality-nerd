# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Instructions
- Use `bun` as the package manager (NOT npm or pnpm)
- The app is already running, don't try to run it
- Make sure to check and understand the current implementation thoroughly before proceeding
- NEVER create files unless absolutely necessary - always prefer editing existing files
- NEVER create documentation files unless explicitly requested

## Development Commands
```bash
bun run dev          # Development server (already running)
bun run build        # Production build
bun run preview      # Preview production build
bun run check        # TypeScript type checking
bun run format       # Format code with Prettier
bun run lint         # Lint code
```

## Architecture Overview

**Music Nerd** is a SvelteKit application for music analysis and dance practice. Key technical stack:
- **Frontend**: Svelte 5 (uses new `$state`, `$effect`, `$props` APIs)
- **Audio**: Web Audio API + WaveSurfer.js + meyda + web-audio-beat-detector
- **Storage**: IndexedDB via idb-keyval
- **Styling**: Tailwind CSS v4

### Core Components

**Main Application** (`src/routes/+page.svelte`):
- Central hub managing audio playback, BPM detection, and visualization
- Handles drag & drop, keyboard shortcuts, and state management

**Audio System** (`src/lib/audio/`):
- `AudioEngine.ts`: Web Audio API wrapper for playback, looping, and time management
- `BpmDetector.ts`: Automatic BPM detection using web-audio-beat-detector

**Visualization** (`src/lib/components/`):
- `SpectrogramDisplay.svelte`: Chunked waveform display with beat grid overlay
- `BeatGrid.svelte`: Legacy component (unused)

**Persistence** (`src/lib/persistence/PersistenceService.ts`):
- Full session management with IndexedDB
- Stores audio blobs, BPM settings, and session metadata

## Key Implementation Details

1. **Audio Processing**: Uses AudioContext for precise timing and playback control
2. **Chunked Display**: Spectrogram splits audio into configurable beats-per-line chunks
3. **Beat Synchronization**: Manual beat offset adjustment with visual markers
4. **Keyboard Controls**: Space (play/pause), arrows (navigation)
5. **Loop Functionality**: Practice specific sections with chunk-based looping

## Current Feature Status

✅ Implemented:
- MP3 import via drag & drop
- Automatic BPM detection with manual override
- Chunked spectrogram visualization
- Beat grid overlay with offset adjustment
- Full persistence layer
- Loop controls for practice

🚧 Known limitations:
- Single track at a time
- MP3 format only
- Browser-based (no native app)