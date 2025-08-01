# Music Nerd

> A browser-based tool for dancers to visually analyze music structure, practice hearing beats, and annotate tracks for dance practice.

## Features

### Core Features (MVP v1.0)
- 🎵 **Drag & Drop MP3 Import** - Load audio files directly from your computer
- 🎯 **Manual BPM Tapping** - Tap along to determine the track's tempo
- 🎵 **Real-time Playback** - Control playback with keyboard shortcuts
- 💾 **Offline Storage** - Sessions saved locally in your browser
- ⌨️ **Keyboard Shortcuts** - Efficient navigation and control

### Planned Features (Roadmap)
- 📊 **Visual Spectrogram** - See frequency analysis overlaid with beat grid
- 🏷️ **Beat Tagging System** - Mark instruments, breaks, and musical events
- 🎛️ **Beat Grid Visualization** - Visual representation of track structure
- 🔄 **Auto-BPM Detection** - Lightweight beat detection suggestions
- 📱 **Responsive Design** - Works on tablets and mobile devices

## Quick Start

1. **Clone and Setup**
   ```bash
   git clone <repo-url>
   cd music-nerd
   pnpm install
   ```

2. **Development**
   ```bash
   pnpm run dev
   ```

3. **Open** http://localhost:5173

4. **Use the App**
   - Drag an MP3 file onto the drop zone
   - Tap spacebar to determine BPM
   - Press Enter to lock in the tempo
   - Use arrow keys to navigate by 8-beat segments

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause (or tap BPM when in tapping mode) |
| `Enter` | Lock in BPM after tapping |
| `←` | Jump to previous 8-beat boundary |
| `→` | Jump to next 8-beat boundary |

## Technical Architecture

### Stack
- **Frontend**: Svelte 5 + TypeScript
- **Styling**: Tailwind CSS
- **Audio**: Web Audio API
- **Storage**: IndexedDB (via idb-keyval)
- **Build**: Vite

### Module Structure
```
src/lib/
├── types.ts              # TypeScript interfaces
├── audio/
│   ├── AudioEngine.ts    # Web Audio API wrapper
│   └── BpmTapper.ts      # Beat detection via manual tapping
└── persistence/
    └── PersistenceService.ts  # IndexedDB storage layer
```

## Browser Support

- **Chrome/Edge**: Full support
- **Firefox**: Full support  
- **Safari**: Full support (requires user interaction for audio)

## Development Roadmap

### Milestone 0.1 ✅ Boilerplate
- [x] Project scaffolding with Svelte + TypeScript
- [x] Tailwind CSS setup
- [x] Drag-and-drop MP3 import
- [x] Basic audio playback

### Milestone 0.2 🚧 Spectrogram (In Progress)
- [ ] FFT-based spectrogram rendering
- [ ] Canvas-based visualization
- [ ] Detail slider for FFT window adjustment

### Milestone 0.3 📋 BPM & Grid
- [x] Manual BPM tapping
- [ ] Beat grid overlay visualization
- [ ] Group-by-4 beat compression option

### Milestone 0.4 📋 Tagging System
- [ ] Tag creation with color picker
- [ ] Beat-by-beat tag assignment
- [ ] Tag badge visualization

### Milestone 1.0 📋 MVP Release
- [ ] Complete IndexedDB persistence
- [ ] Unsaved changes warning
- [ ] Error handling and user feedback
- [ ] Performance optimization

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## User Content

Users are responsible for the copyright of imported MP3 files. This tool is designed for personal practice and analysis only. No audio content is transmitted or stored on external servers.

## Support

- 🐛 **Issues**: [GitHub Issues](./issues)
- 💬 **Discussions**: [GitHub Discussions](./discussions)
- 📧 **Contact**: [Your contact info]
