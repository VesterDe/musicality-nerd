# Waveform Display Performance Optimization Plan

## Current Performance Issues

The `SvgWaveformDisplay.svelte` component experiences significant performance issues due to:

1. **Heavy re-renders**: Multiple `$derived` computations run frequently, especially `rawChunkData` and `chunkData`
2. **Large DOM updates**: Rendering 300+ SVG elements per chunk (bars, beat lines, annotations)
3. **Frequent recalculations**: Playhead position and active beat lines update on every animation frame
4. **Memory usage**: Full Float32Array audio data stored without optimization
5. **No virtualization**: All chunks render regardless of viewport visibility

## Optimization Strategies

### 1. Virtualization and Windowing

**Problem**: All chunks render simultaneously, creating hundreds of DOM nodes even for off-screen content.

**Solution**:
- Implement viewport-based rendering using Intersection Observer API
- Only render chunks within viewport + buffer zone (e.g., 2 chunks above/below)
- Replace off-screen chunks with lightweight placeholder divs maintaining height
- Dynamically load/unload chunk content as user scrolls

**Implementation Details**:
```javascript
// Use IntersectionObserver to track visible chunks
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      renderChunk(entry.target.dataset.chunkIndex);
    } else {
      unloadChunk(entry.target.dataset.chunkIndex);
    }
  });
}, { rootMargin: '200px' }); // Buffer zone for smooth scrolling
```

**Expected Impact**: 70-90% reduction in initial render time, 50% reduction in memory usage

### 2. Canvas-based Rendering

**Problem**: SVG rendering is CPU-intensive and creates many DOM nodes.

**Solution**:
- Replace SVG with HTML5 Canvas for waveform visualization
- Use OffscreenCanvas for pre-rendering static elements
- Implement WebGL renderer for GPU acceleration on complex visualizations

**Implementation Details**:
```javascript
// Pre-render static waveform to OffscreenCanvas
const offscreen = new OffscreenCanvas(width, height);
const ctx = offscreen.getContext('2d');
// Draw waveform bars once
drawWaveformBars(ctx, peaksData);
// Convert to ImageBitmap for fast blitting
const bitmap = await createImageBitmap(offscreen);

// Main render loop just draws the bitmap
mainCtx.drawImage(bitmap, 0, 0);
```

**WebGL Option**:
- Use WebGL for massive datasets (>10 minutes of audio)
- Implement GPU-based peak calculation
- Real-time zoom/pan with no CPU overhead

**Expected Impact**: 80% reduction in render time, 60% reduction in CPU usage during playback

### 3. Intelligent Caching System

**Problem**: Waveform data is recalculated on every render despite being static.

**Solution**:
- Cache downsampled peaks at multiple resolutions
- Store rendered chunks as ImageBitmap objects
- Implement LRU cache for memory management
- Use IndexedDB for persistent cache across sessions

**Implementation Details**:
```javascript
class WaveformCache {
  private cache = new Map<string, CachedChunk>();
  private lru = new Set<string>();
  
  async getChunk(chunkId: string, resolution: number) {
    const key = `${chunkId}_${resolution}`;
    
    if (this.cache.has(key)) {
      this.updateLRU(key);
      return this.cache.get(key);
    }
    
    // Generate and cache
    const chunk = await this.generateChunk(chunkId, resolution);
    this.cache.set(key, chunk);
    
    // Evict old entries if needed
    if (this.cache.size > MAX_CACHE_SIZE) {
      this.evictOldest();
    }
    
    return chunk;
  }
}
```

**Expected Impact**: 95% reduction in redundant calculations, instant chunk display on revisit

### 4. Optimized Reactive Dependencies

**Problem**: Svelte's fine-grained reactivity causes unnecessary recalculations.

**Solution**:
- Split monolithic `$derived` blocks into targeted computations
- Use stores with manual subscription for non-UI critical updates
- Implement dirty-checking for complex objects
- Batch updates using `tick()` or `requestAnimationFrame`

**Implementation Details**:
```javascript
// Instead of one large $derived
const rawChunkData = $derived.by(() => {
  // Heavy computation for ALL chunks
});

// Split into individual chunk computations
const chunkComputations = new Map();
function getChunkData(index) {
  if (!chunkComputations.has(index)) {
    chunkComputations.set(index, $derived.by(() => {
      // Compute only this chunk
    }));
  }
  return chunkComputations.get(index);
}
```

**Expected Impact**: 40% reduction in unnecessary re-renders

### 5. Web Workers for Heavy Processing

**Problem**: Audio processing blocks the main thread, causing UI jank.

**Solution**:
- Move peak extraction to Web Worker
- Implement progressive waveform generation
- Use SharedArrayBuffer for zero-copy data transfer
- Process chunks in parallel across multiple workers

**Implementation Details**:
```javascript
// waveform.worker.js
self.onmessage = async (e) => {
  const { audioData, startSample, endSample, targetBars } = e.data;
  
  // Heavy processing in worker thread
  const peaks = downsamplePeaks(audioData, startSample, endSample, targetBars);
  
  // Transfer result back without copying
  self.postMessage({ peaks }, [peaks.buffer]);
};

// Main thread
const worker = new Worker('waveform.worker.js');
worker.postMessage({ audioData, ...params }, [audioData.buffer]);
```

**Expected Impact**: Eliminates main thread blocking, enables smooth 60fps during processing

### 6. Progressive Enhancement Strategy

**Problem**: Users wait for full waveform generation before interaction.

**Solution**:
- Display low-resolution waveform immediately (50 samples)
- Progressively enhance to full resolution in background
- Prioritize visible chunks for enhancement
- Use requestIdleCallback for non-urgent processing

**Implementation Details**:
```javascript
class ProgressiveWaveform {
  async render(priority: 'immediate' | 'background') {
    if (priority === 'immediate') {
      // Quick, low-res render
      const lowRes = this.quickDownsample(50);
      this.displayWaveform(lowRes);
      
      // Schedule high-res enhancement
      requestIdleCallback(() => {
        const highRes = this.fullDownsample(300);
        this.updateWaveform(highRes);
      });
    }
  }
}
```

**Expected Impact**: Instant initial display, perceived performance improvement of 10x

### 7. SVG Optimization Techniques

**Problem**: Too many individual SVG elements cause DOM overhead.

**Solution**:
- Combine multiple bars into single Path elements
- Use CSS transforms for animations instead of attribute changes
- Implement virtual DOM diffing for SVG updates
- Batch DOM operations using DocumentFragment

**Implementation Details**:
```javascript
// Instead of individual rects
function generateBarsAsPaths(bars) {
  let pathData = '';
  bars.forEach(bar => {
    pathData += `M${bar.x},${bar.y} v${bar.height} h${bar.width} v${-bar.height} z `;
  });
  return `<path d="${pathData}" fill="#3b82f6" />`;
}

// Use CSS for animations
.playhead {
  transform: translateX(var(--playhead-position));
  transition: transform 0.1s linear;
}
```

**Expected Impact**: 50% reduction in DOM nodes, 30% improvement in animation smoothness

## Implementation Roadmap

### Phase 1: Quick Wins (1-2 days)
1. Implement viewport-based rendering
2. Add basic caching for waveform bars
3. Optimize reactive dependencies
4. Reduce console.log statements

### Phase 2: Medium Effort (3-5 days)
1. Implement comprehensive caching system
2. Add Web Worker for peak processing
3. Progressive waveform loading
4. SVG path optimization

### Phase 3: Major Refactor (1-2 weeks)
1. Canvas-based rendering system
2. WebGL renderer for large files
3. Advanced virtualization with dynamic chunk sizing
4. Complete architecture overhaul for performance

## Performance Metrics to Track

- Initial render time (target: <100ms)
- Time to interactive (target: <500ms)
- Frame rate during playback (target: 60fps)
- Memory usage (target: <100MB for 10min audio)
- Scroll performance (target: 60fps)
- CPU usage during idle (target: <5%)

## Alternative Approaches

### 1. Waveform Sprites
Pre-render entire waveform as image sprites, slice and display as needed.

### 2. Server-Side Rendering
Generate waveforms server-side, deliver as optimized images.

### 3. WebAssembly Processing
Use WASM for ultra-fast audio processing and peak extraction.

### 4. Third-Party Libraries
Consider specialized libraries like WaveSurfer.js or Peaks.js if custom implementation proves too complex.

## Testing Strategy

1. Performance profiling with Chrome DevTools
2. Automated performance regression tests
3. Real-world testing with various audio lengths (30s to 60min)
4. Cross-browser performance validation
5. Mobile device performance testing

## Success Criteria

- Smooth 60fps playback on 5-year-old devices
- <1 second load time for 10-minute audio files
- No visible jank during scroll or seek operations
- Memory usage remains stable during long sessions
- CPU usage <20% during active playback