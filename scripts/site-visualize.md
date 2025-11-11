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

### Session 1 (2025-11-10)

**Completed:**
- ✅ Phase 1: Foundation (all 5 steps)
  - Created project structure and dependencies
  - Implemented BFS layer calculation algorithm
  - Successfully analyzed 441 pages from Swift.org site
  - Identified 18 layers with max depth of 16 clicks from home
  - Found 137 isolated pages and 19 error pages

- ✅ Phase 2: Basic Visualization (all 5 steps + legend + stats)
  - Generated standalone HTML file with embedded D3.js
  - Created layered node visualization
  - Implemented link rendering between pages
  - Applied color coding by status (healthy, error, isolated, header/footer)
  - Added truncated labels and legend
  - Embedded summary statistics in header

**Key Findings:**
- 441 total pages analyzed
- Max navigation depth: 16 clicks from homepage!
- 137 pages not reachable via content links (isolated)
- 19 pages with errors
- Distribution: Most pages are 3-9 clicks from home

**Next Steps:**
- Phase 3: Add interactivity (detail panel, filters, search, collapse/expand)
- Phase 4: Polish and performance (zoom/pan, optimization, export, docs)

**Files Created:**
- `scripts/site-visualize.js` - Main Node.js script (400+ lines)
- `scripts/site-visualize.md` - This progress tracker
- `site-visualize-output.html` - Generated visualization
- `package.json` - Updated with d3 dependency and npm script

**Usage:**
```bash
npm run site-visualize
# or
node scripts/site-visualize.js
```

---

_Last Updated: 2025-11-10_
