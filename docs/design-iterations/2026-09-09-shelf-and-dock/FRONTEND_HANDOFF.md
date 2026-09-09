# Leaf — Frontend Design Specification & Developer Handoff

> **Document Version:** 2.1.0 (Production Handoff & Design Systems Audit Verified)  
> **Target Audience:** Frontend Engineers / UI Developers  
> **Scope:** Strictly scoped to **Requirement 1 (Library Main Shelf Design)** and **Requirement 2 (Reader View Pill & Dock System)**.  
> **Design Philosophy:** Editorial Fine-Press, Solid Flat Minimalism, Zero live page blur, Zero gradients/glows, Monochromatic neutral palette, Strict single-page pagination.  
> **Reference Prototype Implementations:** `/home/shrey/leaf-design/index.html` (Library View) and `/home/shrey/leaf-design/reader.html` (Reader View).

---

## 1. Cohesive Design System Tokens

To eliminate visual contradictions between resting and opened states, the dock system and library components share **the exact same solid flat material surfaces and visual language across all states** (both resting pill elements and expanded floating pods).

```css
:root {
  /* Typography Tokens */
  --leaf-font-ui: 'Source Sans 3', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --leaf-font-body: 'EB Garamond', Garamond, Georgia, serif;
  --leaf-font-display: 'Fraunces', Georgia, serif;
  --leaf-font-mono: 'JetBrains Mono', monospace;

  /* Elevation (Pure Flat Minimal, Zero Glows, Minimal Shadow) */
  --leaf-shadow-flat: 0 2px 8px rgba(0, 0, 0, 0.12);
  --leaf-shadow-card: 0 2px 6px rgba(0, 0, 0, 0.06);
  --leaf-shadow-card-hover: 0 6px 16px rgba(0, 0, 0, 0.12);

  /* Animation Timings */
  --leaf-ease-out: cubic-bezier(0.22, 0.61, 0.36, 1);
  --leaf-transition-fast: 180ms cubic-bezier(0.22, 0.61, 0.36, 1);
  --leaf-transition-normal: 240ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* ==========================================================================
   Light / Sepia Theme (Warm Fine-Press Laid Paper + Solid Charcoal Dock)
   ========================================================================== */
[data-theme="sepia"], [data-theme="day"] {
  /* Canvas Surfaces */
  --leaf-bg-paper: #f2ece0;          /* Surrounding canvas */
  --leaf-bg-page: #f8f4eb;           /* Book card & page canvas */
  --leaf-ink-primary: #1f1a16;       /* Primary text & headlines */
  --leaf-ink-mid: #685b4d;           /* Subtitles, authors, secondary info */
  --leaf-ink-faint: #8a7c6d;         /* Metadata, timestamps, page ratios */
  --leaf-rule: #dcd3c0;              /* Hairlines, borders, dividers */

  /* Cohesive Dock System (100% unified across resting dock AND expanded pods) */
  --leaf-dock-bg: #1f1a16;           /* Solid flat dark charcoal */
  --leaf-dock-border: #352d26;       /* 1px crisp border */
  --leaf-dock-text: #f2ece0;         /* Crisp bone-white text / active fills */
  --leaf-dock-text-muted: #9c8e7e;   /* Secondary / muted text */
  --leaf-dock-track: #352d26;        /* 3px hairline inactive track */
  --leaf-dock-hover: #2a231e;        /* Subtle hover surface */
  --leaf-slider-track: #120e0b;      /* Theme switch groove */
  --leaf-slider-thumb: #f2ece0;      /* Theme switch thumb */

  color-scheme: light;
}

/* ==========================================================================
   Dark / Night Theme (Flat Matte Carbon + Solid Matte Black Dock)
   ========================================================================== */
[data-theme="night"] {
  /* Canvas Surfaces */
  --leaf-bg-paper: #12100e;          /* Dark canvas */
  --leaf-bg-page: #191613;           /* Dark page surface */
  --leaf-ink-primary: #e4dac5;       /* Sand primary text */
  --leaf-ink-mid: #9c8f7d;           /* Muted sand secondary */
  --leaf-ink-faint: #736758;         /* Faint sand metadata */
  --leaf-rule: #2a231d;              /* Dark hairline border */

  /* Cohesive Dock System (100% unified across resting dock AND expanded pods) */
  --leaf-dock-bg: #1c1713;           /* Solid flat matte black */
  --leaf-dock-border: #302821;       /* 1px crisp dark border */
  --leaf-dock-text: #e4dac5;         /* Sand text / active fills */
  --leaf-dock-text-muted: #8a7c6b;   /* Muted sand secondary text */
  --leaf-dock-track: #302821;        /* 3px hairline inactive track */
  --leaf-dock-hover: #241e19;        /* Subtle hover surface */
  --leaf-slider-track: #0d0b09;      /* Theme switch groove */
  --leaf-slider-thumb: #e4dac5;      /* Theme switch thumb */

  color-scheme: dark;
}
```

---

## 2. Requirement 1: Library Main Shelf Design

### 2.1 Visual Hierarchy & Architectural Wireframe

The Library view organizes the user's reading collection into two primary sections:
1. **Hero Spotlight ("Currently Reading"):** Spotlight for the single most recently read book at top of shelf.
2. **Responsive Shelf Grid ("All Books"):** Clean grid of remaining library books adapting seamlessly to screen size.

```
+-----------------------------------------------------------------------------------+
|  HEADER: [ LEAF · FINE PRESS ]                                [ DAY | SEPIA | NIGHT ]
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [HERO SPOTLIGHT: CURRENTLY READING]                                              |
|  +-----------------------------------------------------------------------------+  |
|  |  +---------+   CONTINUE READING                                             |  |
|  |  | [Spine] |   Frankenstein; or, The Modern Prometheus                      |  |
|  |  |  Cover  |   Mary Wollstonecraft Shelley                                  |  |
|  |  |  Image  |   Chapter 4 · The Creation            74% complete · ~18m left |  |
|  |  | (12px)  |   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈┈┈┈┈┈┈┈                 |  |
|  |  +---------+   [ Continue Reading → ]                                       |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  ALL BOOKS (4 Columns Desktop / 3 Columns Tablet / 2 Columns Mobile)             |
|  +----------------+  +----------------+  +----------------+  +----------------+   |
|  | +------------+ |  | +------------+ |  | +------------+ |  | +------------+ |   |
|  | | [Spine]    | |  | | [Spine]    | |  | | [Spine]    | |  | | [Spine]    | |   |
|  | | Dracula    | |  | | Wizard of Oz| |  | | Time Machine | |  | | Pride & Pre| |   |
|  | +------------+ |  | +------------+ |  | +------------+ |  | +------------+ |   |
|  | Dracula        |  | Wonderful Oz   |  | The Time Mach. |  | Pride & Prej.  |   |
|  | Bram Stoker    |  | L. Frank Baum  |  | H.G. Wells     |  | Jane Austen    |   |
|  | 35% READ       |  | COMPLETED      |  | 12% READ       |  | UNREAD         |   |
|  +----------------+  +----------------+  +----------------+  +----------------+   |
+-----------------------------------------------------------------------------------+
```

---

### 2.2 Component Specification: 'Currently Reading' Hero Card

#### Key Architectural Requirements:
- **Spotlight Placement:** Pinned at top of reading shelf.
- **Tactile Book Cover:** Aspect ratio `3/4` (`width: 130px`) with **12px left spine indentation crease** rendered via a `::before` pseudo-element gradient shadow.
- **Typography:**
  - Eyebrow Tag: `JetBrains Mono` (`0.68rem`, `letter-spacing: 0.22em`, uppercase, `color: var(--leaf-ink-mid)`).
  - Title: `Fraunces` serif display (`1.65rem`, `font-weight: 500`, `line-height: 1.2`, `color: var(--leaf-ink-primary)`).
  - Author: `Source Sans 3` (`0.95rem`, `color: var(--leaf-ink-mid)`).
- **Progress Track:** Clean flat 4px track (`var(--leaf-rule)`) with active fill (`var(--leaf-ink-primary)`).
- **Primary CTA:** Minimal pill button `[ Continue Reading → ]`.

#### DOM Markup Snippet
```html
<section class="hero-card" aria-label="Currently Reading">
  <!-- Tactile Book Cover with 12px Left Spine Crease -->
  <div class="hero-cover" aria-hidden="true">
    <span class="hero-cover-genre">Classics</span>
    <div class="hero-cover-center">
      <div class="hero-cover-title">Frankenstein</div>
      <div class="hero-cover-author">Mary Shelley</div>
    </div>
    <span class="hero-cover-year">1818</span>
  </div>

  <!-- Book Information & Progress -->
  <div class="hero-content">
    <span class="hero-eyebrow">Continue Reading</span>
    <h2 class="hero-title">Frankenstein; or, The Modern Prometheus</h2>
    <p class="hero-author">Mary Wollstonecraft Shelley</p>

    <div class="hero-meta">
      <span class="hero-chapter-label">Chapter 4 · The Creation</span>
      <span class="hero-stats-label">74% complete · ~18 min remaining</span>
    </div>

    <!-- Clean Flat 4px Progress Bar Track -->
    <div class="hero-progress-track" role="progressbar" aria-valuenow="74" aria-valuemin="0" aria-valuemax="100">
      <div class="hero-progress-fill" style="width: 74%;"></div>
    </div>

    <!-- Action Link CTA -->
    <a href="reader.html?book=frankenstein" class="hero-continue-btn">
      <span>Continue Reading</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
      </svg>
    </a>
  </div>
</section>
```

#### Exact CSS Implementation
```css
/* Hero Spotlight Container */
.hero-card {
  position: relative;
  background: var(--leaf-bg-page);
  border: 1px solid var(--leaf-rule);
  border-radius: 8px;
  padding: 1.75rem;
  box-shadow: var(--leaf-shadow-card);
  display: flex;
  flex-direction: row;
  gap: 1.75rem;
  align-items: center;
  overflow: hidden;
  transition: transform var(--leaf-transition-normal), box-shadow var(--leaf-transition-normal);
}

.hero-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--leaf-shadow-card-hover);
}

/* Tactile Cover with Left Spine Crease */
.hero-cover {
  width: 130px;
  aspect-ratio: 3/4;
  background: #2b2218;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  color: #ede2cb;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 12px Left Spine Indentation Crease */
.hero-cover::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 12px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.4) 0%, rgba(0, 0, 0, 0.1) 60%, transparent 100%);
  pointer-events: none;
}

.hero-cover-genre {
  font-family: var(--leaf-font-mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  opacity: 0.7;
}

.hero-cover-title {
  font-family: var(--leaf-font-display);
  font-size: 1.1rem;
  line-height: 1.15;
  font-weight: 500;
}

.hero-cover-author {
  font-family: var(--leaf-font-ui);
  font-size: 0.65rem;
  opacity: 0.8;
  margin-top: 4px;
}

.hero-cover-year {
  font-family: var(--leaf-font-mono);
  font-size: 0.5rem;
  letter-spacing: 0.1em;
  opacity: 0.6;
}

/* Content Area */
.hero-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}

.hero-eyebrow {
  font-family: var(--leaf-font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--leaf-ink-mid);
  font-weight: 600;
}

.hero-title {
  font-family: var(--leaf-font-display);
  font-size: 1.65rem;
  line-height: 1.2;
  color: var(--leaf-ink-primary);
  font-weight: 500;
  margin: 0;
}

.hero-author {
  font-family: var(--leaf-font-ui);
  font-size: 0.95rem;
  color: var(--leaf-ink-mid);
  margin: 0;
}

.hero-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--leaf-font-mono);
  font-size: 0.75rem;
  color: var(--leaf-ink-faint);
  gap: 8px;
  flex-wrap: wrap;
}

/* Flat Minimal 4px Progress Bar */
.hero-progress-track {
  width: 100%;
  height: 4px;
  background: var(--leaf-rule);
  border-radius: 999px;
  overflow: hidden;
  margin: 0.15rem 0;
}

.hero-progress-fill {
  height: 100%;
  background: var(--leaf-ink-primary);
  border-radius: 999px;
  transition: width 0.4s var(--leaf-ease-out);
}

/* Minimal Flat Button */
.hero-continue-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--leaf-ink-primary);
  color: var(--leaf-bg-page);
  padding: 0.65rem 1.4rem;
  border-radius: 4px;
  font-family: var(--leaf-font-ui);
  font-size: 0.88rem;
  font-weight: 600;
  text-decoration: none;
  transition: opacity var(--leaf-transition-fast), transform var(--leaf-transition-fast);
}

.hero-continue-btn:hover {
  opacity: 0.92;
  transform: translateX(2px);
}
```

---

### 2.3 Component Specification: Responsive Shelf Grid

#### Key Architectural Requirements:
- **Desktop/Tablet Layout:** 3-4 auto-filling columns (`repeat(auto-fill, minmax(160px, 1fr))`).
- **Mobile Graceful Collapse (< 640px):** Hero card stacks vertically, shelf collapses cleanly to 2 columns.
- **Shelf Covers:** 10px spine crease, Fraunces serif titles, muted metadata.

#### DOM Markup Snippet
```html
<section class="shelf-section" aria-label="Library Shelf">
  <div class="shelf-header">
    <h3 class="shelf-title">All Books</h3>
    <span class="shelf-count">4 volumes</span>
  </div>

  <div class="shelf-grid">
    <!-- Book Card 1 -->
    <a href="reader.html?book=dracula" class="book-card">
      <div class="card-cover cover-dracula">
        <span class="card-cover-genre">Gothic</span>
        <div class="card-cover-title">Dracula</div>
        <span class="card-cover-author">Bram Stoker</span>
      </div>
      <div class="card-info">
        <h4 class="card-title">Dracula</h4>
        <p class="card-author">Bram Stoker</p>
        <span class="card-progress">35% read</span>
      </div>
    </a>

    <!-- Book Card 2 -->
    <a href="reader.html?book=oz" class="book-card">
      <div class="card-cover cover-oz">
        <span class="card-cover-genre">Fantasy</span>
        <div class="card-cover-title">The Wonderful Wizard of Oz</div>
        <span class="card-cover-author">L. Frank Baum</span>
      </div>
      <div class="card-info">
        <h4 class="card-title">The Wonderful Wizard of Oz</h4>
        <p class="card-author">L. Frank Baum</p>
        <span class="card-progress">Completed</span>
      </div>
    </a>

    <!-- Book Card 3 -->
    <a href="reader.html?book=timemachine" class="book-card">
      <div class="card-cover cover-timemachine">
        <span class="card-cover-genre">Sci-Fi</span>
        <div class="card-cover-title">The Time Machine</div>
        <span class="card-cover-author">H.G. Wells</span>
      </div>
      <div class="card-info">
        <h4 class="card-title">The Time Machine</h4>
        <p class="card-author">H.G. Wells</p>
        <span class="card-progress">12% read</span>
      </div>
    </a>

    <!-- Book Card 4 -->
    <a href="reader.html?book=pride" class="book-card">
      <div class="card-cover cover-pride">
        <span class="card-cover-genre">Romance</span>
        <div class="card-cover-title">Pride and Prejudice</div>
        <span class="card-cover-author">Jane Austen</span>
      </div>
      <div class="card-info">
        <h4 class="card-title">Pride and Prejudice</h4>
        <p class="card-author">Jane Austen</p>
        <span class="card-progress">Unread</span>
      </div>
    </a>
  </div>
</section>
```

#### Exact CSS Implementation & Breakpoints
```css
.shelf-section {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.shelf-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-bottom: 1px solid var(--leaf-rule);
  padding-bottom: 0.5rem;
}

.shelf-title {
  font-family: var(--leaf-font-display);
  font-size: 1.35rem;
  color: var(--leaf-ink-primary);
  font-weight: 500;
  margin: 0;
}

.shelf-count {
  font-family: var(--leaf-font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--leaf-ink-faint);
}

/* Responsive Grid (Desktop 3-4 Columns) */
.shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1.75rem;
}

/* Individual Book Card */
.book-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  text-decoration: none;
  color: inherit;
  padding: 0.5rem;
  border-radius: 6px;
  transition: transform var(--leaf-transition-fast), background var(--leaf-transition-fast);
  position: relative;
}

.book-card:hover {
  transform: translateY(-3px);
  background: rgba(0, 0, 0, 0.02);
}

/* Shelf Book Cover with 10px Left Spine Crease */
.card-cover {
  aspect-ratio: 3/4;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
  box-shadow: var(--leaf-shadow-card);
  border: 1px solid var(--leaf-rule);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  text-align: center;
}

.card-cover::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 10px;
  background: linear-gradient(90deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.08) 60%, transparent 100%);
  pointer-events: none;
}

/* Cover Palette Variants */
.cover-dracula { background: #3b1816; color: #ede2cb; }
.cover-oz { background: #1b3824; color: #e4d8be; }
.cover-timemachine { background: #1c2738; color: #f1ebdc; }
.cover-pride { background: #4a3424; color: #ede2cb; }

.card-cover-genre {
  font-family: var(--leaf-font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  opacity: 0.7;
}

.card-cover-title {
  font-family: var(--leaf-font-display);
  font-size: 0.95rem;
  line-height: 1.2;
  font-weight: 500;
}

.card-cover-author {
  font-family: var(--leaf-font-ui);
  font-size: 0.65rem;
  opacity: 0.8;
}

.card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-title {
  font-family: var(--leaf-font-display);
  font-size: 0.98rem;
  line-height: 1.25;
  color: var(--leaf-ink-primary);
  font-weight: 500;
  margin: 0;
}

.card-author {
  font-family: var(--leaf-font-ui);
  font-size: 0.8rem;
  color: var(--leaf-ink-mid);
  margin: 0;
}

.card-progress {
  font-family: var(--leaf-font-mono);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--leaf-ink-faint);
  margin-top: 2px;
}

/* Mobile Responsive Breakpoint (< 640px) */
@media (max-width: 640px) {
  .hero-card {
    flex-direction: column;
    text-align: center;
    padding: 1.25rem;
    gap: 1.25rem;
  }

  .hero-cover {
    width: 110px;
  }

  .hero-meta {
    justify-content: center;
    flex-direction: column;
    gap: 4px;
  }

  .hero-continue-btn {
    align-self: center;
    width: 100%;
    justify-content: center;
  }

  .shelf-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }
}
```

---

## 3. Requirement 2: Reader View Pill & Dock System

### 3.1 Architecture Overview & Rules

The Reader interface is designed with editorial precision:
1. **Strict Single-Page Pagination:** `html, body` and `.page-frame` use `overflow: hidden`. The reading text terminates safely **above the bottom margin safe zone** with zero overlap.
2. **Zero Live Page Blur:** **Never apply `backdrop-filter: blur(...)` to reading prose or controls.** Opening docks, scrubbing progress, and adjusting font sizes leaves the underlying page text 100% sharp and readable.
3. **Cohesive Solid Flat Material:** Both the persistent dock and opened split pods share the **exact same flat dark charcoal surface (`#1f1a16`)** in light/sepia mode and **matte black (`#1c1713`)** in dark/night mode.
4. **Dock System States:**
   - **State 1: Persistent Resting Dock (3+1 Horizontal Elements):** Chapter badge, flat hairline progress bar, percent badge, and 2-slider adjustment vector settings button.
   - **State 2: Expanded Two-Tier Split Pod Dock:** Tier 1 progress island + Tier 2 split pods (Theme Slider, Font Stepper, Table of Contents, Close).

```
+-----------------------------------------------------------------------------------+
| TOP BAR:  [ ← LIBRARY ]                                                [ LEAF ]   |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|                              Chapter 4 · The Creation                             |
|                                                                                   |
|       I   t was on a dreary night of November that I beheld the accomplishment    |
|           of my toils. With an anxiety that almost amounted to agony, I           |
|       collected the instruments of life around me, that I might infuse a spark    |
|       of being into the lifeless thing that lay at my feet...                     |
|                                                                                   |
| [TEXT TERMINATES SAFELY ABOVE BOTTOM MARGIN — ZERO OVERLAP — ZERO LIVE PAGE BLUR]  |
+-----------------------------------------------------------------------------------+
| BOTTOM MARGIN SAFE ZONE (Holds Persistent Dock or Expanded Split Pods)            |
|                                                                                   |
| STATE A: PERSISTENT RESTING DOCK (Solid Surface #1f1a16 / #1c1713)                |
|          [ Ch. 4 ]       [ ━━━━━━━━━━━━━┈┈┈┈┈ ]       [ 74% ]     [ 🎛️ Settings ] |
|                                                                                   |
| STATE B: EXPANDED TWO-TIER CONTROL DECK (On Tap / Click / Keydown)                |
|   Tier 1: [ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ ]          |
|           Chapter 4 · The Creation                     Page 42 of 180 · 14m left  |
|                                                                                   |
|   Tier 2: [ ☼ ── ☾ ]        [ A- | A+ ]         [ ≡ ]               [ ✕ ]         |
|           Theme Slider     Font Stepper        Contents            Close          |
+-----------------------------------------------------------------------------------+
```

---

### 3.2 Persistent Resting Dock (3+1 Elements)

#### Specifications:
- **Element 1:** Chapter Badge `[ Ch. 4 ]` (Monospace, pill shape).
- **Element 2:** Center Hairline Progress Pill `[ ━━━━━━┈┈┈ ]` (`height: 22px; width: 130px;` containing a 3px hairline track).
- **Element 3:** Percent Badge `[ 74% ]` (Monospace, pill shape).
- **Element 4:** Settings Trigger Button `[ 🎛️ ]` (`22px` circle with a clean 2-slider vector line SVG).

#### DOM Markup Snippet
```html
<div class="persistent-dock-system" id="restingDock" onclick="LeafReader.expandDock()" role="button" tabindex="0" aria-label="Reading progress. Tap to open reading controls">
  <!-- 1. Chapter Badge -->
  <div class="dock-badge" id="persistentChapterBadge">Ch. 4</div>

  <!-- 2. Flat Hairline Progress Bar Container -->
  <div class="dock-progress-bar-container">
    <div class="dock-progress-bar-track">
      <div class="dock-progress-bar-fill" id="persistentFill" style="width: 74%;"></div>
    </div>
  </div>

  <!-- 3. Percentage Badge -->
  <div class="dock-badge" id="persistentPctBadge">74%</div>

  <!-- 4. Settings Trigger Button (2-Slider Adjustment Vector Line SVG) -->
  <div class="dock-settings-btn" title="Reading Controls" aria-hidden="true">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="4" y1="7" x2="20" y2="7"></line>
      <line x1="4" y1="17" x2="20" y2="17"></line>
      <circle cx="8" cy="7" r="2.5" fill="currentColor"></circle>
      <circle cx="16" cy="17" r="2.5" fill="currentColor"></circle>
    </svg>
  </div>
</div>
```

#### Exact CSS Implementation
```css
/* Persistent Dock Container */
.persistent-dock-system {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 26px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  transition: opacity var(--leaf-transition-fast), transform var(--leaf-transition-fast);
}

.persistent-dock-system:hover {
  opacity: 0.95;
  transform: translateY(-1px);
}

/* Badge 1 & Badge 2 (Chapter & Percent) */
.dock-badge {
  background: var(--leaf-dock-bg);
  color: var(--leaf-dock-text);
  border: 1px solid var(--leaf-dock-border);
  border-radius: 999px;
  padding: 3px 10px;
  font-family: var(--leaf-font-mono);
  font-size: 0.68rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  white-space: nowrap;
  box-shadow: var(--leaf-shadow-flat);
  transition: border-color var(--leaf-transition-fast), background var(--leaf-transition-fast);
}

/* Center Progress Bar Container */
.dock-progress-bar-container {
  background: var(--leaf-dock-bg);
  border: 1px solid var(--leaf-dock-border);
  border-radius: 999px;
  height: 22px;
  width: 130px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  box-shadow: var(--leaf-shadow-flat);
  transition: border-color var(--leaf-transition-fast), background var(--leaf-transition-fast);
}

.dock-progress-bar-track {
  width: 100%;
  height: 3px;
  background: var(--leaf-dock-track);
  border-radius: 999px;
  position: relative;
  overflow: hidden;
}

.dock-progress-bar-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 74%;
  background: var(--leaf-dock-text);
  border-radius: 999px;
  transition: width 120ms linear;
}

/* Element 4: Settings Button */
.dock-settings-btn {
  background: var(--leaf-dock-bg);
  color: var(--leaf-dock-text);
  border: 1px solid var(--leaf-dock-border);
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--leaf-shadow-flat);
  transition: background var(--leaf-transition-fast), color var(--leaf-transition-fast), transform var(--leaf-transition-fast);
}

.persistent-dock-system:hover .dock-settings-btn {
  background: var(--leaf-dock-hover);
  transform: scale(1.05);
}
```

---

### 3.3 Expanded Two-Tier Split Pod Dock

> [!IMPORTANT]
> **Bookmark Button Status:** The bookmark button has been **100% removed** from the opened dock. Tier 2 contains strictly 4 pods: Theme Slider, Font Stepper, Table of Contents, and Close.

#### Specifications:
- **Tier 1 (Progress Island):**
  - Seekable 3px flat hairline track supporting pointer drag (touch + mouse) and keyboard scrubbing.
  - Left: Chapter Title in `Fraunces` serif (`0.84rem`, `font-weight: 500`).
  - Right: Page ratio & remaining reading time in `JetBrains Mono` (`0.68rem`).
- **Tier 2 (Split Pods Row — 4 Pods Only):**
  1. **2-State Sliding Theme Toggle:** `62px × 32px` track with flat line vector SVG Sun and Moon icons (no emojis) and `26px` smooth sliding thumb.
  2. **Typography Stepper:** Segmented `[ A- | A+ ]` pill with 1px hairline divider for real-time font size adjustment without live page blur.
  3. **Table of Contents:** `32px` circular pod triggering popover chapter drawer directly above.
  4. **Close Button:** `32px` circular pod with minimal `✕` vector icon collapsing deck back to resting dock.

#### DOM Markup Snippet
```html
<div class="expanded-dock-container" id="expandedDock" role="region" aria-label="Reading Controls Deck">
  
  <!-- Tier 1: Flat Progress Island -->
  <div class="dock-pod progress-island-dock">
    <!-- Seekable 3px Progress Track -->
    <div class="progress-track-wrapper" id="progressTrack" role="slider" aria-label="Seek Progress" aria-valuenow="74" aria-valuemin="0" aria-valuemax="100" tabindex="0">
      <div class="progress-flat-groove">
        <div class="progress-flat-fill" id="progressFill" style="width: 74%;"></div>
      </div>
    </div>
    
    <!-- Chapter Highlight & Time Metrics -->
    <div class="progress-meta-row">
      <span class="progress-chapter-highlight" id="scrubChapter">Chapter 4 · The Creation</span>
      <span class="progress-stats-highlight" id="scrubStats">Page 42 of 180 · 14m left</span>
    </div>
  </div>

  <!-- Tier 2: Split Floating Pods Row (4 Pods Only) -->
  <div class="split-pods-row">
    
    <!-- Pod 1: 2-State Sliding Theme Toggle (Sun & Moon Vector Line SVGs, NO Emojis) -->
    <div class="dock-pod pod-slider" id="themeSwitch" role="switch" aria-checked="false" aria-label="Toggle Night Mode" tabindex="0" onclick="LeafReader.toggleSlidingTheme()">
      <div class="slider-inner-icons" aria-hidden="true">
        <!-- Crisp Line Sun Vector SVG -->
        <svg class="theme-icon sun-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"></circle>
          <line x1="12" y1="2" x2="12" y2="4"></line>
          <line x1="12" y1="20" x2="12" y2="22"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="2" y1="12" x2="4" y2="12"></line>
          <line x1="20" y1="12" x2="22" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
        <!-- Crisp Line Moon Vector SVG -->
        <svg class="theme-icon moon-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      </div>
      <div class="slider-pill-thumb"></div>
    </div>

    <!-- Pod 2: Font Size Stepper [ A- | A+ ] -->
    <div class="dock-pod pod-font-stepper" role="group" aria-label="Text Size Controls">
      <button class="stepper-btn" onclick="LeafReader.adjustFontSize(-0.06)" title="Decrease font size" aria-label="Decrease font size">A-</button>
      <div class="stepper-divider" aria-hidden="true"></div>
      <button class="stepper-btn" onclick="LeafReader.adjustFontSize(0.06)" title="Increase font size" aria-label="Increase font size">A+</button>
    </div>

    <!-- Pod 3: Table of Contents Trigger + Popover Drawer -->
    <div class="toc-wrapper">
      <button class="dock-pod pod-circle" id="tocTrigger" onclick="LeafReader.toggleTOC(event)" title="Table of Contents" aria-haspopup="true" aria-expanded="false" aria-label="Table of Contents">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>

      <!-- TOC Popover Drawer -->
      <div class="toc-popover" id="tocPopover" role="dialog" aria-label="Chapters">
        <div class="toc-header">Table of Contents</div>
        <ul class="toc-list">
          <li class="toc-item" onclick="LeafReader.jumpChapter(1, 'Letter 1')"><span>Letter 1</span> <span>p. 1</span></li>
          <li class="toc-item" onclick="LeafReader.jumpChapter(2, 'Chapter 1 · Childhood')"><span>Chapter 1</span> <span>p. 14</span></li>
          <li class="toc-item" onclick="LeafReader.jumpChapter(3, 'Chapter 2 · Science')"><span>Chapter 2</span> <span>p. 26</span></li>
          <li class="toc-item current" onclick="LeafReader.jumpChapter(4, 'Chapter 4 · The Creation')"><span>Chapter 4 · The Creation</span> <span>p. 42</span></li>
          <li class="toc-item" onclick="LeafReader.jumpChapter(5, 'Chapter 5 · The Awakening')"><span>Chapter 5</span> <span>p. 58</span></li>
          <li class="toc-item" onclick="LeafReader.jumpChapter(6, 'Chapter 6 · Geneva')"><span>Chapter 6</span> <span>p. 75</span></li>
        </ul>
      </div>
    </div>

    <!-- Pod 4: Close Button -->
    <button class="dock-pod pod-circle" onclick="LeafReader.collapseDock()" title="Close Controls" aria-label="Close Controls">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

  </div>
</div>
```

#### Exact CSS Implementation
```css
/* Base Shared Pod Surface */
.dock-pod {
  background: var(--leaf-dock-bg);
  color: var(--leaf-dock-text);
  border: 1px solid var(--leaf-dock-border);
  box-shadow: var(--leaf-shadow-flat);
  transition: transform var(--leaf-transition-fast), background var(--leaf-transition-fast), border-color var(--leaf-transition-fast);
  position: relative;
}

/* Expanded Dock Container */
.expanded-dock-container {
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
  max-width: 420px;
  animation: flatSlideUp var(--leaf-transition-normal) forwards;
}

@keyframes flatSlideUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Tier 1: Progress Island */
.progress-island-dock {
  width: 100%;
  border-radius: 12px;
  padding: 10px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-track-wrapper {
  position: relative;
  width: 100%;
  height: 14px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}

.progress-flat-groove {
  width: 100%;
  height: 3px;
  background: var(--leaf-dock-track);
  border-radius: 999px;
  position: relative;
  overflow: hidden;
}

.progress-flat-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--leaf-dock-text);
  border-radius: 999px;
  width: 74%;
  transition: width 80ms linear;
}

.progress-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--leaf-font-mono);
  font-size: 0.68rem;
  color: var(--leaf-dock-text-muted);
  letter-spacing: 0.05em;
  user-select: none;
}

.progress-chapter-highlight {
  font-family: var(--leaf-font-display);
  font-size: 0.84rem;
  color: var(--leaf-dock-text);
  font-weight: 500;
}

.progress-stats-highlight {
  font-family: var(--leaf-font-mono);
  font-size: 0.68rem;
  color: var(--leaf-dock-text-muted);
}

/* Tier 2: Split Action Pods Row */
.split-pods-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
}

/* Pod 1: 2-State Sliding Theme Toggle */
.pod-slider {
  border-radius: 999px;
  padding: 2px;
  width: 62px;
  height: 32px;
  position: relative;
  cursor: pointer;
  background: var(--leaf-slider-track);
  border: 1px solid var(--leaf-dock-border);
}

.slider-inner-icons {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  z-index: 1;
  user-select: none;
}

.theme-icon {
  color: var(--leaf-dock-text-muted);
  transition: color var(--leaf-transition-fast);
}

.slider-pill-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 26px;
  height: 26px;
  background: var(--leaf-slider-thumb);
  border-radius: 50%;
  transition: transform var(--leaf-transition-normal);
  z-index: 2;
}

.pod-slider.night-active .slider-pill-thumb {
  transform: translateX(30px);
}

/* Pod 2: Font Size Stepper */
.pod-font-stepper {
  border-radius: 999px;
  height: 32px;
  display: flex;
  align-items: center;
  padding: 0 3px;
  border: 1px solid var(--leaf-dock-border);
}

.stepper-btn {
  background: none;
  border: none;
  color: var(--leaf-dock-text);
  font-family: var(--leaf-font-ui);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: 999px;
  transition: background var(--leaf-transition-fast);
  opacity: 0.9;
}

.stepper-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  opacity: 1;
}

.stepper-btn:active {
  transform: scale(0.96);
}

.stepper-divider {
  width: 1px;
  height: 12px;
  background: rgba(255, 255, 255, 0.18);
}

/* Pod 3 & 4: Circle Pods */
.toc-wrapper {
  position: relative;
}

.pod-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--leaf-dock-border);
  background: var(--leaf-dock-bg);
  color: var(--leaf-dock-text);
}

.pod-circle:hover {
  background: var(--leaf-dock-hover);
  border-color: rgba(255, 255, 255, 0.25);
}

.pod-circle:active {
  transform: scale(0.96);
}

/* Table of Contents Popover Drawer */
.toc-popover {
  display: none;
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  background: var(--leaf-dock-bg);
  border: 1px solid var(--leaf-dock-border);
  box-shadow: var(--leaf-shadow-flat);
  border-radius: 12px;
  padding: 12px;
  z-index: 50;
  animation: popoverFade var(--leaf-transition-fast) forwards;
}

@keyframes popoverFade {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.toc-header {
  font-family: var(--leaf-font-display);
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--leaf-dock-text);
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--leaf-dock-border);
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 170px;
  overflow-y: auto;
}

.toc-item {
  display: flex;
  justify-content: space-between;
  font-family: var(--leaf-font-ui);
  font-size: 0.8rem;
  color: var(--leaf-dock-text-muted);
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--leaf-transition-fast), color var(--leaf-transition-fast);
}

.toc-item:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--leaf-dock-text);
}

.toc-item.current {
  background: rgba(255, 255, 255, 0.14);
  color: var(--leaf-dock-text);
  font-weight: 500;
}
```

---

### 3.4 Complete Reader View Layout & Safe Margin Blueprint

To guarantee **strict single-page pagination with zero live page blur and zero overlap with controls**, implement the following structural layout:

```html
<!-- Complete Reader Container Tree -->
<div class="reader-viewport">
  
  <!-- Minimal Top Bar -->
  <header class="top-header">
    <a href="index.html" class="nav-back">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </svg>
      Library
    </a>
    <span class="brand-mark">Leaf</span>
  </header>

  <!-- Paginated Page Frame (Zero live blur, strict height boundary) -->
  <main class="page-frame" id="pageFrame">
    <div class="turn-zone turn-zone-left" onclick="LeafReader.prevPage()" title="Previous page"></div>
    <div class="turn-zone turn-zone-right" onclick="LeafReader.nextPage()" title="Next page"></div>

    <h1 class="chapter-title" id="pageHeading">Chapter 4 · The Creation</h1>

    <article class="prose" id="proseContainer">
      <p class="first-para">
        <span class="drop-cap">I</span>t was on a dreary night of November that I beheld the accomplishment of my toils. With an anxiety that almost amounted to agony, I collected the instruments of life around me, that I might infuse a spark of being into the lifeless thing that lay at my feet...
      </p>
      <p>
        How can I describe my emotions at this catastrophe, or how delineate the wretch whom with such infinite pains and care I had endeavoured to form?
      </p>
    </article>
  </main>

  <!-- Dedicated Bottom Margin Zone (Holds Persistent Dock or Expanded Deck) -->
  <footer class="bottom-margin-zone">
    <!-- State 1: Resting Dock -->
    <div class="persistent-dock-system" id="restingDock" onclick="LeafReader.expandDock()">...</div>

    <!-- State 2: Expanded Two-Tier Deck -->
    <div class="expanded-dock-container" id="expandedDock">...</div>
  </footer>

</div>
```

```css
/* Viewport & Pagination Frame Bounds */
html, body {
  height: 100%;
  overflow: hidden; /* Strict pagination constraint */
}

.reader-viewport {
  width: 100%;
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  background-color: var(--leaf-bg-paper);
}

.top-header {
  width: 100%;
  max-width: 620px;
  padding: 1.25rem 1.5rem 0.25rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

/* Page Frame: Reading text bounded strictly above bottom margin */
.page-frame {
  width: 100%;
  max-width: 620px;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding: 0.5rem 1.5rem 0.5rem;
  position: relative;
  min-height: 0;
  overflow: hidden; /* Zero spillover */
}

.chapter-title {
  font-family: var(--leaf-font-display);
  font-size: 1.85rem;
  line-height: 1.2;
  color: var(--leaf-ink-primary);
  font-weight: 400;
  text-align: center;
  margin-bottom: 1.25rem;
}

.prose {
  font-family: var(--leaf-font-body);
  font-size: 1.12rem;
  line-height: 1.65;
  text-align: justify;
  hyphens: auto;
  user-select: text;
  -webkit-user-select: text;
  transition: font-size var(--leaf-transition-fast);
}

.prose p {
  margin-bottom: 0.85rem;
  text-indent: 1.4em;
}

.prose p.first-para {
  text-indent: 0;
}

.drop-cap {
  float: left;
  font-family: var(--leaf-font-display);
  font-size: 3.4em;
  line-height: 0.8;
  padding: 0.05em 0.1em 0 0;
  color: var(--leaf-ink-primary);
  font-weight: 500;
}

/* Bottom Safe Zone */
.bottom-margin-zone {
  width: 100%;
  max-width: 620px;
  padding: 0.5rem 1rem max(1.5rem, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 30;
  position: relative;
}
```

---

### 3.5 JavaScript Micro-Interactions, Event Handlers & Keyboard Navigation

```javascript
/**
 * Leaf Reader State & Interaction Controller
 * Strictly adheres to Zero Live Page Blur, Cohesive Solid Docks, and Pointer Capture Seeking.
 */
const LeafReader = (() => {
  let currentFontSize = 1.12; // rem
  let isNight = false;
  let isDraggingProgress = false;
  let currentPage = 1;

  // Cached DOM Elements
  let restingDock, expandedDock, persistentFill, persistentPctBadge;
  let progressFill, progressTrack, themeSwitch, tocPopover, tocTrigger;
  let proseContainer, pageHeading;

  function initElements() {
    restingDock = document.getElementById('restingDock');
    expandedDock = document.getElementById('expandedDock');
    persistentFill = document.getElementById('persistentFill');
    persistentPctBadge = document.getElementById('persistentPctBadge');
    progressFill = document.getElementById('progressFill');
    progressTrack = document.getElementById('progressTrack');
    themeSwitch = document.getElementById('themeSwitch');
    tocPopover = document.getElementById('tocPopover');
    tocTrigger = document.getElementById('tocTrigger');
    proseContainer = document.getElementById('proseContainer');
    pageHeading = document.getElementById('pageHeading');
  }

  // --- 1. Dock State Switching ---
  function expandDock() {
    if (!restingDock || !expandedDock) return;
    restingDock.style.display = 'none';
    expandedDock.style.display = 'flex';
    closeTOC();
  }

  function collapseDock() {
    if (!restingDock || !expandedDock) return;
    expandedDock.style.display = 'none';
    restingDock.style.display = 'flex';
    closeTOC();
  }

  // --- 2. 2-State Sliding Theme Toggle ---
  function toggleSlidingTheme() {
    if (!themeSwitch) return;
    isNight = !isNight;
    themeSwitch.classList.toggle('night-active', isNight);
    themeSwitch.setAttribute('aria-checked', isNight ? 'true' : 'false');
    document.documentElement.setAttribute('data-theme', isNight ? 'night' : 'sepia');
  }

  // --- 3. Live Font Stepper (Zero Blur, Zero DOM Reload) ---
  function adjustFontSize(delta) {
    if (!proseContainer) return;
    currentFontSize = Math.min(1.45, Math.max(0.9, currentFontSize + delta));
    proseContainer.style.fontSize = `${currentFontSize.toFixed(2)}rem`;
  }

  // --- 4. Table of Contents Popover ---
  function toggleTOC(e) {
    if (e) e.stopPropagation();
    if (!tocPopover || !tocTrigger) return;
    const isOpen = tocPopover.style.display === 'block';
    tocPopover.style.display = isOpen ? 'none' : 'block';
    tocTrigger.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
  }

  function closeTOC() {
    if (tocPopover && tocTrigger) {
      tocPopover.style.display = 'none';
      tocTrigger.setAttribute('aria-expanded', 'false');
    }
  }

  function jumpChapter(num, title) {
    if (pageHeading) pageHeading.textContent = title;
    const scrubCh = document.getElementById('scrubChapter');
    const persistBadge = document.getElementById('persistentChapterBadge');
    if (scrubCh) scrubCh.textContent = title;
    if (persistBadge) persistBadge.textContent = `Ch. ${num}`;
    closeTOC();
  }

  // --- 5. Seekable Progress Scrubbing (Pointer Events: Touch + Mouse) ---
  function updateProgressFromEvent(e) {
    if (!progressTrack || !progressFill || !persistentFill || !persistentPctBadge) return;
    const rect = progressTrack.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    let pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    pct = Math.min(100, Math.max(1, pct));

    // Update Progress Bars & Badges
    progressFill.style.width = `${pct}%`;
    persistentFill.style.width = `${pct}%`;
    persistentPctBadge.textContent = `${pct}%`;
    progressTrack.setAttribute('aria-valuenow', pct.toString());

    // Dynamic stats computation (180 total pages model)
    const pageNum = Math.max(1, Math.round((pct / 100) * 180));
    const minsLeft = Math.max(1, Math.round(((100 - pct) / 100) * 24));
    const statsEl = document.getElementById('scrubStats');
    if (statsEl) {
      statsEl.textContent = `Page ${pageNum} of 180 · ${minsLeft}m left`;
    }
  }

  function initProgressListeners() {
    if (!progressTrack) return;

    progressTrack.addEventListener('pointerdown', (e) => {
      isDraggingProgress = true;
      try {
        progressTrack.setPointerCapture(e.pointerId);
      } catch (_) {}
      updateProgressFromEvent(e);
    });

    progressTrack.addEventListener('pointermove', (e) => {
      if (!isDraggingProgress) return;
      updateProgressFromEvent(e);
    });

    const endDrag = (e) => {
      if (isDraggingProgress) {
        isDraggingProgress = false;
        try {
          progressTrack.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
    };

    progressTrack.addEventListener('pointerup', endDrag);
    progressTrack.addEventListener('pointercancel', endDrag);

    // Keyboard accessibility on slider
    progressTrack.addEventListener('keydown', (e) => {
      let currentVal = parseInt(progressTrack.getAttribute('aria-valuenow') || '74', 10);
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nextVal = Math.min(100, currentVal + 2);
        updateProgressExplicit(nextVal);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextVal = Math.max(1, currentVal - 2);
        updateProgressExplicit(nextVal);
      }
    });
  }

  function updateProgressExplicit(pct) {
    if (!progressFill || !persistentFill || !persistentPctBadge || !progressTrack) return;
    progressFill.style.width = `${pct}%`;
    persistentFill.style.width = `${pct}%`;
    persistentPctBadge.textContent = `${pct}%`;
    progressTrack.setAttribute('aria-valuenow', pct.toString());
    const pageNum = Math.max(1, Math.round((pct / 100) * 180));
    const minsLeft = Math.max(1, Math.round(((100 - pct) / 100) * 24));
    const statsEl = document.getElementById('scrubStats');
    if (statsEl) statsEl.textContent = `Page ${pageNum} of 180 · ${minsLeft}m left`;
  }

  // --- 6. Global Click-Outside & Keyboard Handlers ---
  function initGlobalListeners() {
    document.addEventListener('click', (e) => {
      if (tocPopover && tocPopover.style.display === 'block') {
        if (!tocPopover.contains(e.target) && !tocTrigger.contains(e.target)) {
          closeTOC();
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (tocPopover && tocPopover.style.display === 'block') {
          closeTOC();
        } else if (expandedDock && expandedDock.style.display === 'flex') {
          collapseDock();
        }
      }
    });

    // Resting Dock Keyboard Expansion
    if (restingDock) {
      restingDock.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          expandDock();
        }
      });
    }

    // Theme Switch Keyboard Toggle
    if (themeSwitch) {
      themeSwitch.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleSlidingTheme();
        }
      });
    }
  }

  // Simulation page navigation helpers
  function nextPage() {
    currentPage = 2;
    if (pageHeading) pageHeading.textContent = "Chapter 4 · (Continued)";
  }

  function prevPage() {
    currentPage = 1;
    if (pageHeading) pageHeading.textContent = "Chapter 4 · The Creation";
  }

  // Public Interface
  return {
    init: () => {
      initElements();
      initProgressListeners();
      initGlobalListeners();
    },
    expandDock,
    collapseDock,
    toggleSlidingTheme,
    adjustFontSize,
    toggleTOC,
    closeTOC,
    jumpChapter,
    nextPage,
    prevPage
  };
})();

// Auto-initialize on DOM ready
document.addEventListener('DOMContentLoaded', LeafReader.init);
```

---

## 4. Summary of Critical Developer Constraints

| Constraint | Category | Implementation Requirement |
| :--- | :--- | :--- |
| **Color Cohesion** | Architecture | Both resting dock and opened split pods use the **exact same solid flat dark charcoal surface (`#1f1a16` in Light/Sepia, `#1c1713` in Dark/Night)**. No translucent mismatches. |
| **No Live Blur** | Performance & Prose | **Never apply `backdrop-filter: blur(...)` to prose containers or controls.** The reading text must remain 100% sharp and legible during dock expansion and font adjustments. |
| **No Emojis** | Visual Asset | Strictly use **flat vector line SVGs** for Sun, Moon, Settings, Table of Contents, and Close icons. |
| **Bookmark Removed** | Component Scope | The bookmark button is **100% removed** from the dock in Tier 2. |
| **Pagination Safety** | Layout Engine | `html, body` and `.page-frame` use `overflow: hidden`. Prose terminates safely above the bottom margin safe zone with **zero overlap**. |
| **Spine Creases** | Tactile Details | Hero cover uses **12px spine crease**; shelf book cards use **10px spine crease** (`linear-gradient` shadow pseudo-element). |
| **Animation Specs** | Micro-interactions | State transitions and dock expansions strictly execute between **`180ms - 240ms`** using `cubic-bezier(0.22, 0.61, 0.36, 1)`. |

---

## 5. Developer Inquiry & Clarification Channel

> ### 💬 To the Implementing Engineer:
> 
> This specification is finalized and verified against the production prototypes at `/home/shrey/leaf-design/index.html` and `/home/shrey/leaf-design/reader.html`.
> 
> If you have any clarifying questions regarding:
> 1. Integration with frontend frameworks (React, Vue, Svelte, Web Components) or state stores.
> 2. Mobile viewport adaptations (e.g. `env(safe-area-inset-bottom)` or mobile Safari dynamic URL bar shifts).
> 3. Custom font loading strategies (`Fraunces`, `EB Garamond`, `Source Sans 3`, `JetBrains Mono`).
> 4. Dynamic chapter pagination algorithms or token customization.
> 
> **Please ask your clarifying questions directly before altering any CSS tokens, DOM IDs, or layout structures.**
