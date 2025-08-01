# Music Nerd – MVP Spec (v 1.0)

> **Purpose**  Provide a browser‑only tool that lets an individual dancer visually dissect a track, practise hearing its structure, and annotate instruments/events beat‑by‑beat.

---

## 1 · Product Overview

|                  | Description                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Audience**     | Individual dancers (self‑practice).                                                                                                  |
| **Problem**      | It’s hard to *feel* and predict musical structure on the dance floor.                                                                |
| **Solution**     | Drag‑and‑drop an MP3, tap the tempo, see a colour heat‑map spectrogram split into beats/bars, and tag where instruments or FX occur. |
| **Scope**        | Desktop, offline‑capable (once loaded), browser‑only—no back‑end.                                                                    |
| **Out of scope** | Cloud sync, community sharing, machine‑learning analysis, teaching modes, DJ features.                                               |

---

## 2 · Core Feature List (MVP)

1. **File Import**

   * Drag‑and‑drop local MP3. (Other formats may be accepted implicitly via browser decoding but MP3 is the target.)
2. **Spectrogram Renderer**

   * Heat‑map colour palette ("viridis"‑like default).
   * Detail slider – adjusts FFT window length & overlap.
   * Full‑width view (no zoom) for v 1.0.
3. **Beat Grid**

   * Automatic BPM detection using web-audio-beat-detector library.
   * Live BPM display (fractional allowed, integer rounds in UI).
   * Manual override option with tap‑to‑tempo (space‑bar) if needed.
   * Vertical grid lines every beat; thicker at 4, 8, 16, 32‑beat intervals.
   * *Group‑by‑4* toggle compresses spacing between groups of four beats.
4. **Tagging System**

   * User creates free‑text tag + colour (native colour picker).
   * While a tag is selected, pressing **space** during playback toggles that tag on the current beat.
   * Tag badges render above affected beat columns.
5. **Playback & Navigation**

   * Space – play/pause when *no tag is armed*.
   * ← / → – hop to previous/next 8‑beat boundary.
   * Basic transport bar (current time, total duration).
6. **Persistence**

   * Track, BPM, grid, tags, and **binary MP3 blob** stored in IndexedDB.
   * On reopen, last‑used session auto‑restores.
   * Unsaved‑changes warning on tab close if persistence fails.
7. **Keyboard Shortcuts Framework**

   * Centralised registry; new features auto‑added.
   * (Cheat‑sheet modal deferred to v 2.)

---

## 3 · Deferred Features (Road‑map)

| Idea                         | Notes                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Snap‑length configuration    | User can customise ←/→ hop size.                                     |
| Looping / A‑B segment        | Repeat a chosen bar range for drilling.                              |
| Tag solo/mute playback       | Play only beats that contain a tag, or everything *except* that tag. |
| Sub‑beat or range tagging    | Drag selection < 1 beat or multi‑beat.                               |
| Zoom & Scroll                | Horizontal zoom and mouse‑wheel scroll.                              |
| Practice (“prediction”) mode | Hide future bars, reveal after user predicts.                        |
| ML‑based tag suggestions     | Auto‑detect kick, snare, synth stabs, etc.                           |
| Community gallery            | Share annotated tracks publicly.                                     |

---

## 4 · Technical Architecture

### 4.1 Stack

* **Svelte + TypeScript** (Vite).
* **Tailwind CSS** – utility‑first styling.
* **Web Audio API** – decoding & playback.
* **WASM FFT / meyda** – real‑time spectrogram data.
* **Canvas 2D** – spectrogram rendering & grid overlay.
* **IndexedDB** via `idb-keyval` – persistence layer.
* **web-audio-beat-detector** – automatic BPM detection from audio.

### 4.2 Module Breakdown

| Module                 | Responsibilities                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| **AppShell**           | Routing, theming, global shortcut handler.                                                   |
| **AudioEngine**        | Decode MP3, schedule playback, expose analyser data.                                         |
| **Spectrogram**        | Stream FFT → canvas; apply colour map; respond to Detail slider.                             |
| **BpmDetector**        | Use web-audio-beat-detector to analyze audio and detect BPM; fire `bpmChanged` event.        |
| **BeatGrid**           | Calculate beat timestamps from BPM & track length; draw grid; manage group‑by‑4 compression. |
| **TagManager**         | CRUD for tags; colour picker; persistence.                                                   |
| **AnnotationLayer**    | Render tag badges above beats; hit‑test for click removal.                                   |
| **PersistenceService** | Serialize/deserialize TrackSession; store/retrieve from IndexedDB.                           |
| **UIComponents**       | Transport bar, sliders, dialogs.                                                             |

### 4.3 Data Model (JSON, persisted)

```jsonc
{
  "id": "uuid",
  "mp3Blob": "ArrayBuffer",
  "filename": "song.mp3",
  "created": "2025-06-02T10:15:00Z",
  "bpm": 128.0,
  "beats": [ // one per beat
    { "index": 0, "time": 0.000, "tags": ["perc"] },
    { "index": 1, "time": 0.469, "tags": [] },
    ...
  ],
  "tags": {
    "perc": { "label": "Percussion", "color": "#ff5500" },
    "fx":   { "label": "Riser FX",  "color": "#00baff" }
  }
}
```

---

## 5 · UX Flows

### 5.1 Import & Analyse

1. **Drop MP3 →** decode → render spectrogram (default detail).
2. Auto‑detect BPM runs using web-audio-beat-detector; result shown immediately.
3. User may override with manual tap (press **space** ≥ 8 times → BPM locks when **Enter** pressed).
4. Grid draws; user may toggle *Group‑by‑4*.

### 5.2 Tag Creation & Placement

1. Click **➕ New Tag** → modal: name + colour picker.
2. Tag appears in sidebar & becomes *armed*.
3. Press **Play**; while armed, each **space** toggles tag on current beat.
4. Tag badges render above grid.

### 5.3 Navigation & Editing

* **← / →** jump to prior/next 8‑beat boundary.
* Click beat badge × icon to remove tag.
* Detail slider re‑renders spectrogram in real‑time.

---

## 6 · Non‑Functional Requirements

* **Performance**  ≤ 120 ms spectrogram redraw on slider move (desktop i5‑2018 baseline).
* **Browser Support**  Latest Chrome, Edge, Firefox, Safari (ES2021).
* **Accessibility**  All controls keyboard‑navigable; WCAG 2.1 colour contrast for badge text.
* **Error Handling**  Graceful fallback if BPM auto‑detect fails; IndexedDB quota exceeded warning.

---

## 7 · Project Setup & Licensing

* **Repo Scaffolding**  `pnpm create svelte@latest music‑nerd` with TS, ESLint, Prettier.
* **License**  MIT for source code.
* **User Content**  Users are responsible for copyright of imported MP3s; no external distribution.
* **Readme**  Quick‑start, feature list, screenshots, roadmap table.

---

## 8 · Milestones

| Milestone             | Deliverables                                               |
| --------------------- | ---------------------------------------------------------- |
| **0.1** – Boilerplate | Repo scaffold, Tailwind theme, drag‑and‑drop MP3 playback. |
| **0.2** – Spectrogram | FFT render, Detail slider.                                 |
| **0.3** – BPM Tapper  | Manual tap, beat grid overlay.                             |
| **0.4** – Tagging     | Tag CRUD, badges, persistence.                             |
| **1.0** – MVP Release | IndexedDB storage, unsaved warning, polished UI.           |
| **>1.0**              | Road‑map items (snap config, looping, etc.).               |

---

> **Next step**  Begin implementation with Milestone 0.1 scaffold.
