# Visual Site Map - Development Plan

**Project**: Generate interactive visual sitemap from site-check.js output
**Input**: `site-check-report.json`
**Output**: Static HTML file with embedded D3.js visualization
**Status**: In Progress

## Goals

- Visualize site structure with home page at top
- Show navigation difficulty (clicks from home = depth)
- Highlight header/footer links in special layer
- Display content errors (broken links, isolated pages, errors)
- Enable interactive exploration (search, filter, details)

## Technical Approach

- **Layout**: Layered/level-based (Y-axis = depth from home)
- **Library**: D3.js for SVG rendering
- **Format**: Node.js script generates standalone HTML file
- **Navigation Metric**: Number of clicks from home page
- **Header/Footer**: Special layer below home (Layer 1)

## Progress Tracking

### Phase 1: Foundation ✅

- [x] **Step 1**: Create site-visualize.md to track progress
- [x] **Step 2**: Set up d3.js dependencies in package.json
- [x] **Step 3**: Create script to load site-check-report.json
- [x] **Step 4**: Implement BFS algorithm to calculate page depths
- [x] **Step 5**: Categorize pages into layers (0=home, 1=header/footer, 2+=content)

**Verification**: ✅ Console output showing 441 pages organized into 18 layers

### Phase 2: Basic Visualization ✅

- [x] **Step 6**: Create basic layer visualization (nodes positioned by layer)
- [x] **Step 7**: Draw links/edges between connected pages
- [x] **Step 8**: Color code nodes by status (normal, error, broken, isolated)
- [x] **Step 9**: Style header/footer layer distinctly
- [x] **Step 10**: Add node labels with URL truncation
- [x] **Step 17**: Add legend (moved up - already implemented)
- [x] **Step 19**: Display summary statistics (moved up - already implemented)

**Verification**: ✅ Generated site-visualize-output.html with layered graph visualization

### Phase 3: Interactivity

- [ ] **Step 11**: Implement click handler for page details
- [ ] **Step 12**: Build detail panel (URL, links, errors, images)
- [ ] **Step 13**: Add filter controls (errors, isolated, broken links)
- [ ] **Step 14**: Implement filtering logic
- [ ] **Step 15**: Add search box with highlighting
- [ ] **Step 16**: Implement collapse/expand for layers

**Verification**: Can filter, search, and explore page details

### Phase 4: Polish & Performance

- [ ] **Step 18**: Add zoom and pan controls
- [ ] **Step 20**: Test with small sample data (5-10 pages)
- [x] **Step 21**: Test with full site-check-report.json (441 pages tested)
- [ ] **Step 22**: Optimize performance for large graphs
- [ ] **Step 23**: Add export functionality (SVG/PNG)
- [ ] **Step 24**: Create usage documentation

**Verification**: Smooth performance with 400+ pages

## Data Structures

### Input Format (from site-check-report.json)

```json
{
  "pages": {
    "/": {
      "incomingLinks": [],
      "isIsolated": false,
      "outgoingLinks": {
        "header": ["/docs", "/blog"],
        "footer": ["/privacy"],
        "content": ["/getting-started"]
      },
      "externalLinks": ["https://github.com/..."],
      "imagesCount": 5,
      "issues": {
        "redirect": null,
        "error": null,
        "brokenLinks": [],
        "brokenImages": []
      }
    }
  }
}
```

### Computed Layer Structure

```javascript
{
  layers: {
    0: ['/'],                           // Home
    1: ['/docs', '/blog', '/privacy'],  // Header/Footer (globally available)
    2: ['/getting-started', '/about'],  // 1 click from home via content
    3: [...],                           // 2 clicks from home
  },
  pageMetadata: {
    '/': { layer: 0, type: 'home', status: 'healthy', ... },
    '/docs': { layer: 1, type: 'header', status: 'healthy', ... }
  }
}
```

## Visual Design

### Layout

```
Layer 0:                [Home /]
                           |
Layer 1:    [Header Links] | [Footer Links]
                |          |          |
Layer 2:     [Page A]  [Page B]  [Page C]
                |          |
Layer 3:     [Page D]  [Page E]

Isolated:   [Orphan 1] [Orphan 2]
```

### Color Scheme

- **Green (#10b981)**: Healthy page, no issues
- **Red (#ef4444)**: Error or broken links
- **Orange (#f97316)**: Isolated page (no incoming links)
- **Yellow (#eab308)**: Warning (broken images)
- **Blue (#3b82f6)**: Header/footer (globally available)
- **Gray (#9ca3af)**: Collapsed/hidden

### Node Encoding

- **Size**: Proportional to incoming link count (popularity)
- **Border**: Thick border for current selection
- **Shape**: Rounded rectangles for all pages

## Files Created

- `scripts/site-visualize.js` - Main Node.js script
- `scripts/site-visualize.md` - This progress tracker
- `scripts/site-visualize-output.html` - Generated visualization (output)

## Usage

```bash
# Generate visualization from report
node scripts/site-visualize.js

# Opens site-visualize-output.html in default browser
# Or specify output file
node scripts/site-visualize.js --output custom-name.html

# Use specific report file
node scripts/site-visualize.js --input other-report.json
```

## Dependencies

- `d3` - D3.js for visualization (will be embedded in generated HTML)
- `fs` - File system operations (built-in)

## Session Notes

### Session 1 (2025-11-10) - COMPLETED

**Phase 1 & 2: Foundation and Basic Visualization**

Initial implementation completed:
- ✅ Created project structure with d3.js dependencies
- ✅ Implemented initial BFS layer calculation (later fixed)
- ✅ Generated standalone HTML with embedded D3.js visualization
- ✅ Created layered node visualization with color coding
- ✅ Added legend and summary statistics

**User Feedback & Improvements:**

1. **Spacing & Readability Issues**
   - Nodes were too tightly packed and hard to read
   - Isolated pages in single line were cramped

2. **Applied Fixes:**
   - ✅ Changed layout to 80px per node minimum (was 3px)
   - ✅ Increased font size from 10px to 11px with medium weight
   - ✅ Extended label length from 15 to 25 characters
   - ✅ Arranged isolated pages in tall band (400px) with grid layout
   - ✅ Added "Node Size" explanation to legend (popularity = incoming links)
   - ✅ Increased left margin from 60px to 150px for layer labels

3. **Critical BFS Algorithm Bug Found & Fixed:**
   - **Problem**: BFS only started from homepage, not header/footer pages
   - **Issue**: Pages linked from global navigation were incorrectly deep in tree
   - **Example**: `/documentation/server/guides` appeared at Layer 8 instead of Layer 2
   - **Root Cause**: Didn't model that header/footer links appear on EVERY page

   **Fix Applied:**
   - Start BFS from home (depth 0) AND all header/footer pages (depth 1)
   - Process ALL link types (header, footer, content) during traversal
   - Results: Reduced from **18 layers (16 clicks max)** to **8 layers (7 clicks max)**
   - Much more realistic: 204 pages now at Layer 3 (2 clicks from anywhere)

**Major Content Issues Discovered:**

4. **47 Self-Referential Isolated Pages:**
   - Pages that only link to themselves, completely orphaned
   - Categories:
     - Google Summer of Code pages (2019-2025)
     - Server guides (majority of isolated pages)
     - Documentation pages (API design, C++ interop)
     - Project pages (lldb, compiler-stdlib, etc.)

5. **CRITICAL: Duplicate Server Documentation Hierarchies:**

   **Two Parallel Hierarchies Exist:**
   - `/documentation/server/*` (21 pages) - ✅ Reachable via header → documentation
   - `/server/*` (24 pages) - ❌ Isolated, only 2 blog post links

   **Evidence:**
   - 6 exact duplicate pages with same filenames
   - Examples: `/server/guides/building.html` ↔ `/documentation/server/guides/building.html`

   **Cross-Contamination:**
   - Reachable pages link to isolated pages:
     - `/documentation/server/guides/deployment.html` → `/server/guides/packaging.html` ❌
     - `/documentation/server/guides/deploying/ubuntu.html` → `/server/guides/building.html` ❌
   - Creates broken, inconsistent user experience

   **External Links Analysis:**
   - Only 2 blog posts link to `/server` landing page
   - 24 of 29 pages linking to `/server/*` are self-referential
   - Forms isolated island of pages

**Investigation Method:**
- Created temporary analysis scripts (all cleaned up)
- Used direct JSON queries against site-check-report.json
- Traced link paths from header through documentation
- Identified link relationships and duplicate detection

**Current State:**

✅ **Working Features:**
- Accurate BFS-based depth calculation accounting for global navigation
- Wide, readable layout with proper spacing
- Color-coded status (healthy, error, isolated, header/footer)
- Node size reflects popularity (incoming link count)
- Legend with full explanation
- Isolated pages in tall band grid (137 pages)
- Generated output: `site-visualize-output.html` (1.2 MB)

**Statistics (After BFS Fix):**
- 441 total pages analyzed
- 8 layers (max depth: 7 clicks)
- Layer 3 has 204 pages (most content 2 clicks from home)
- 121 isolated pages
- 19 pages with errors
- 306 healthy pages

**Recommendations for Content Team:**
1. Choose canonical path: `/documentation/server/*` (already in navigation)
2. Redirect all `/server/*` → `/documentation/server/*`
3. Fix internal links in `/documentation/server/*` that reference `/server/*`
4. Review all 47 self-referential isolated pages for integration or removal

**Next Session Tasks:**

Phase 3: Interactivity (Steps 11-16 - not started)
- [ ] **Step 11**: Implement click handler for page details in side panel
- [ ] **Step 12**: Build detail panel showing URL, incoming/outgoing links, errors, images
- [ ] **Step 13**: Add filter controls (checkboxes for: errors, isolated, broken links)
- [ ] **Step 14**: Implement filtering logic to show/hide nodes based on selected filters
- [ ] **Step 15**: Add search box with real-time filtering/highlighting of matching pages
- [ ] **Step 16**: Implement collapse/expand functionality for layers (click layer header to toggle)

Phase 4: Polish & Performance (Steps 18, 20, 22-24)
- [ ] **Step 18**: Add zoom and pan controls for large site maps
- [ ] **Step 20**: Test with small sample data (5-10 pages) to verify basic functionality
- [ ] **Step 22**: Optimize performance for large graphs (virtualization if needed)
- [ ] **Step 23**: Add export functionality (save as SVG or PNG image)
- [ ] **Step 24**: Create usage documentation

**Files:**
- `scripts/site-visualize.js` - Main script (700+ lines)
- `scripts/site-visualize.md` - This tracker
- `site-visualize-output.html` - Generated visualization
- `package.json` - Updated with d3@^7.9.0

**Commands:**
```bash
npm run site-visualize              # Generate visualization
open site-visualize-output.html     # View in browser
```

---

_Last Updated: 2025-11-10_
_Session 1 Complete - Ready for Phase 3_
