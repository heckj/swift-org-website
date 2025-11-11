#!/usr/bin/env node
//===----------------------------------------------------------------------===//
//
// This source file is part of the Swift.org open source project
//
// Copyright (c) 2025 Apple Inc. and the Swift.org project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of Swift.org project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

/**
 * Site Visualize Tool
 *
 * Generates an interactive visual sitemap from site-check-report.json
 * Shows page hierarchy, navigation difficulty, and content issues.
 *
 * Usage: npm run site-visualize
 *        node scripts/site-visualize.js
 *        node scripts/site-visualize.js --input custom-report.json --output custom.html
 *
 * Output: site-visualize-output.html (standalone HTML file)
 */

const fs = require('fs').promises
const path = require('path')

// Configuration
const CONFIG = {
  inputFile:
    process.argv.find((arg) => arg.startsWith('--input='))?.split('=')[1] ||
    'site-check-report.json',
  outputFile:
    process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1] ||
    'site-visualize-output.html',
}

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

/**
 * Load and parse the site check report
 */
async function loadReport(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    log(`Error loading report: ${error.message}`, 'red')
    throw error
  }
}

/**
 * Identify pages that appear in header or footer across the site
 * These are "globally available" navigation links
 */
function identifyHeaderFooterPages(pages) {
  const headerPages = new Set()
  const footerPages = new Set()

  // Collect all unique header and footer links across all pages
  for (const [uri, data] of Object.entries(pages)) {
    data.outgoingLinks.header.forEach((link) => headerPages.add(link))
    data.outgoingLinks.footer.forEach((link) => footerPages.add(link))
  }

  return {
    header: Array.from(headerPages),
    footer: Array.from(footerPages),
    all: Array.from(new Set([...headerPages, ...footerPages])),
  }
}

/**
 * Calculate page depth using BFS from homepage
 * Header pages are assigned to Layer 1, footer pages to Layer 2
 * Other pages get depth based on shortest path via content links
 */
function calculateLayers(pages) {
  const layers = {}
  const pageMetadata = {}

  // Layer 0: Home page
  const homeUri = '/'
  layers[0] = [homeUri]
  pageMetadata[homeUri] = {
    layer: 0,
    type: 'home',
    ...getPageStatus(pages[homeUri]),
  }

  // Identify header/footer pages
  const navPages = identifyHeaderFooterPages(pages)

  // Layer 1: Header pages (globally available in site navigation)
  // Layer 2: Footer pages (globally available in site footer)
  layers[1] = []
  layers[2] = []

  navPages.all.forEach((uri) => {
    const inHeader = navPages.header.includes(uri)
    const inFooter = navPages.footer.includes(uri)

    let type, layer
    if (inHeader && inFooter) {
      type = 'header-footer'
      layer = 1 // Prioritize header layer for pages in both
    } else if (inHeader) {
      type = 'header'
      layer = 1
    } else {
      type = 'footer'
      layer = 2
    }

    layers[layer].push(uri)
    pageMetadata[uri] = {
      layer,
      type,
      ...getPageStatus(pages[uri] || {}),
    }
  })

  // BFS to calculate depths for remaining pages
  // Since header/footer links appear on EVERY page, we start BFS from:
  // 1. Home page (depth 0)
  // 2. Header pages (depth 1)
  // 3. Footer pages (depth 2)
  // This ensures pages linked from global navigation get correct shallow depth

  const visited = new Set([homeUri, ...navPages.all])
  const queue = [{ uri: homeUri, depth: 0 }]

  // Add header pages to queue at depth 1
  navPages.header.forEach((uri) => {
    queue.push({ uri, depth: 1 })
  })

  // Add footer pages to queue at depth 2
  navPages.footer.forEach((uri) => {
    queue.push({ uri, depth: 2 })
  })

  while (queue.length > 0) {
    const { uri, depth } = queue.shift()

    // Skip if page doesn't exist in report
    if (!pages[uri]) continue

    // Process ALL outgoing links (header, footer, and content)
    // Since header/footer appear on every page, all their links are globally accessible
    const allLinks = [
      ...(pages[uri].outgoingLinks.header || []),
      ...(pages[uri].outgoingLinks.footer || []),
      ...(pages[uri].outgoingLinks.content || []),
    ]

    for (const linkUri of allLinks) {
      if (!visited.has(linkUri)) {
        visited.add(linkUri)
        const newDepth = depth + 1
        // Content pages start at Layer 3 (after header=1, footer=2)
        const newLayer = newDepth + 2

        // Initialize layer array if needed
        if (!layers[newLayer]) {
          layers[newLayer] = []
        }

        layers[newLayer].push(linkUri)

        pageMetadata[linkUri] = {
          layer: newLayer,
          type: 'content',
          ...getPageStatus(pages[linkUri] || {}),
        }

        queue.push({ uri: linkUri, depth: newDepth })
      }
    }
  }

  // Find isolated pages (not reached by BFS)
  const isolatedPages = []
  for (const uri of Object.keys(pages)) {
    if (!visited.has(uri)) {
      isolatedPages.push(uri)
      pageMetadata[uri] = {
        layer: 'isolated',
        type: 'isolated',
        ...getPageStatus(pages[uri]),
      }
    }
  }

  if (isolatedPages.length > 0) {
    layers['isolated'] = isolatedPages
  }

  return { layers, pageMetadata }
}

/**
 * Determine page status based on issues
 */
function getPageStatus(pageData) {
  const hasError = pageData.issues?.error !== null
  const hasBrokenLinks =
    pageData.issues?.brokenLinks && pageData.issues.brokenLinks.length > 0
  const hasBrokenImages =
    pageData.issues?.brokenImages && pageData.issues.brokenImages.length > 0
  const isIsolated = pageData.isIsolated === true

  let status = 'healthy'
  if (hasError) status = 'error'
  else if (hasBrokenLinks) status = 'broken-links'
  else if (isIsolated) status = 'isolated'
  else if (hasBrokenImages) status = 'warning'

  return {
    status,
    hasError,
    hasBrokenLinks,
    hasBrokenImages,
    isIsolated,
    incomingCount: pageData.incomingLinks?.length || 0,
    outgoingCount:
      (pageData.outgoingLinks?.header?.length || 0) +
      (pageData.outgoingLinks?.footer?.length || 0) +
      (pageData.outgoingLinks?.content?.length || 0),
  }
}

/**
 * Generate statistics about the site structure
 */
function generateStatistics(layers, pageMetadata, report) {
  const stats = {
    totalPages: Object.keys(pageMetadata).length,
    layerCount: Object.keys(layers).filter((k) => k !== 'isolated').length,
    maxDepth: Math.max(
      ...Object.keys(layers)
        .filter((k) => k !== 'isolated')
        .map(Number),
    ),
    byLayer: {},
    byStatus: {
      healthy: 0,
      error: 0,
      'broken-links': 0,
      isolated: 0,
      warning: 0,
    },
  }

  // Count pages per layer
  for (const [layer, uris] of Object.entries(layers)) {
    stats.byLayer[layer] = uris.length
  }

  // Count pages by status
  for (const metadata of Object.values(pageMetadata)) {
    stats.byStatus[metadata.status]++
  }

  return stats
}

/**
 * Print summary to console
 */
function printSummary(stats, layers) {
  log('\n' + '='.repeat(60), 'cyan')
  log('Site Visualization - Layer Analysis', 'cyan')
  log('='.repeat(60), 'cyan')

  log(`\nTotal Pages: ${stats.totalPages}`, 'blue')
  log(`Layers: ${stats.layerCount} (max depth: ${stats.maxDepth})`, 'blue')

  log('\nPages per Layer:', 'cyan')
  for (const [layer, count] of Object.entries(stats.byLayer)) {
    const layerName =
      layer === '0'
        ? 'Home'
        : layer === '1'
          ? 'Header'
          : layer === '2'
            ? 'Footer'
            : layer === 'isolated'
              ? 'Isolated'
              : `Layer ${layer} (${parseInt(layer) - 2} clicks)`
    log(`  ${layerName}: ${count} pages`, 'blue')
  }

  log('\nPages by Status:', 'cyan')
  if (stats.byStatus.healthy > 0)
    log(`  ✓ Healthy: ${stats.byStatus.healthy}`, 'green')
  if (stats.byStatus.error > 0)
    log(`  ✗ Errors: ${stats.byStatus.error}`, 'red')
  if (stats.byStatus['broken-links'] > 0)
    log(`  ✗ Broken Links: ${stats.byStatus['broken-links']}`, 'red')
  if (stats.byStatus.isolated > 0)
    log(`  ⚠ Isolated: ${stats.byStatus.isolated}`, 'yellow')
  if (stats.byStatus.warning > 0)
    log(`  ⚠ Warnings: ${stats.byStatus.warning}`, 'yellow')

  log('\n' + '='.repeat(60) + '\n', 'cyan')
}

/**
 * Generate HTML visualization with embedded D3.js
 */
function generateHTML(report, layers, pageMetadata, stats) {
  // Prepare data for visualization
  const visualizationData = {
    stats,
    layers,
    pages: report.pages,
    metadata: pageMetadata,
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Swift.org Site Map Visualization</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      color: #111827;
    }

    #container {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    #header {
      background: white;
      border-bottom: 2px solid #e5e7eb;
      padding: 1rem 2rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    h1 {
      font-size: 1.5rem;
      color: #f05138;
      margin-bottom: 0.5rem;
    }

    #stats {
      display: flex;
      gap: 2rem;
      font-size: 0.875rem;
      color: #6b7280;
    }

    .stat { display: flex; align-items: center; gap: 0.5rem; }
    .stat-value { font-weight: 600; color: #111827; }

    #controls {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 1rem 2rem;
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    #viz-container {
      flex: 1;
      overflow: auto;
      position: relative;
    }

    #visualization {
      min-width: 100%;
      min-height: 100%;
    }

    /* Node styles */
    .node circle {
      stroke: white;
      stroke-width: 2;
      cursor: pointer;
      transition: r 0.2s;
    }

    .node:hover circle {
      stroke-width: 3;
    }

    .node text {
      font-size: 11px;
      pointer-events: none;
      fill: #374151;
      font-weight: 500;
    }

    /* Link styles */
    .link {
      stroke: #d1d5db;
      stroke-width: 1;
      fill: none;
      opacity: 0.6;
    }

    .link-header { stroke: #3b82f6; stroke-dasharray: 2,2; }
    .link-footer { stroke: #14b8a6; stroke-dasharray: 2,2; }

    /* Layer labels */
    .layer-label {
      font-size: 12px;
      font-weight: 600;
      fill: #6b7280;
    }

    /* Legend */
    #legend {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: white;
      padding: 1rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      font-size: 0.75rem;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.25rem 0;
    }

    .legend-color {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid white;
    }
  </style>
</head>
<body>
  <div id="container">
    <div id="header">
      <h1>Swift.org Site Map - Layer Visualization</h1>
      <div id="stats">
        <div class="stat">
          <span>Total Pages:</span>
          <span class="stat-value">${stats.totalPages}</span>
        </div>
        <div class="stat">
          <span>Layers:</span>
          <span class="stat-value">${stats.layerCount}</span>
        </div>
        <div class="stat">
          <span>Max Depth:</span>
          <span class="stat-value">${stats.maxDepth} clicks</span>
        </div>
        <div class="stat">
          <span>Errors:</span>
          <span class="stat-value" style="color: #ef4444">${stats.byStatus.error}</span>
        </div>
        <div class="stat">
          <span>Isolated:</span>
          <span class="stat-value" style="color: #f97316">${stats.byStatus.isolated}</span>
        </div>
      </div>
    </div>

    <div id="controls">
      <span style="font-size: 0.875rem; color: #6b7280;">Interactive features coming soon...</span>
    </div>

    <div id="viz-container">
      <svg id="visualization"></svg>
      <div id="legend">
        <div style="font-weight: 600; margin-bottom: 0.5rem;">Status</div>
        <div class="legend-item">
          <div class="legend-color" style="background: #10b981"></div>
          <span>Healthy</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #ef4444"></div>
          <span>Error</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #f97316"></div>
          <span>Isolated</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #eab308"></div>
          <span>Warning</span>
        </div>
        <div style="font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem;">Navigation</div>
        <div class="legend-item">
          <div class="legend-color" style="background: #3b82f6"></div>
          <span>Header Links</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background: #14b8a6"></div>
          <span>Footer Links</span>
        </div>
        <div style="font-weight: 600; margin-top: 1rem; margin-bottom: 0.5rem;">Node Size</div>
        <div style="font-size: 0.7rem; color: #6b7280; line-height: 1.4;">
          Larger nodes = more incoming links (popular pages)
        </div>
      </div>
    </div>
  </div>

  <script>
    // Embedded data
    const DATA = ${JSON.stringify(visualizationData)};

    // Color mapping
    const colors = {
      'home': '#f05138',
      'header': '#3b82f6',
      'footer': '#14b8a6',
      'header-footer': '#6366f1',
      'healthy': '#10b981',
      'error': '#ef4444',
      'isolated': '#f97316',
      'warning': '#eab308',
      'broken-links': '#dc2626'
    };

    function getNodeColor(uri, metadata) {
      if (metadata.type === 'home') return colors.home;
      if (metadata.type === 'header' || metadata.type === 'footer' || metadata.type === 'header-footer') {
        return colors[metadata.type];
      }
      return colors[metadata.status] || colors.healthy;
    }

    function getNodeSize(metadata) {
      // Size based on popularity (incoming links)
      const base = 5;
      const popularity = metadata.incomingCount || 0;
      return base + Math.min(popularity, 20);
    }

    // Build node and link data structures
    const nodes = [];
    const links = [];

    // Create nodes from all pages
    Object.keys(DATA.layers).forEach(layerNum => {
      const uris = DATA.layers[layerNum];
      uris.forEach(uri => {
        const metadata = DATA.metadata[uri];
        nodes.push({
          id: uri,
          layer: layerNum,
          ...metadata
        });
      });
    });

    // Create links from page relationships
    Object.entries(DATA.pages).forEach(([sourceUri, pageData]) => {
      const sourceNode = nodes.find(n => n.id === sourceUri);
      if (!sourceNode) return;

      // Add content links
      (pageData.outgoingLinks.content || []).forEach(targetUri => {
        const targetNode = nodes.find(n => n.id === targetUri);
        if (targetNode) {
          links.push({
            source: sourceUri,
            target: targetUri,
            type: 'content'
          });
        }
      });
    });

    // Setup SVG for force-directed layout
    const width = 2400;
    const height = 2400;
    const centerX = width / 2;
    const centerY = height / 2;

    const svg = d3.select('#visualization')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', \`0 0 \${width} \${height}\`);

    const g = svg.append('g');

    // Calculate radial positions based on layer
    const layerNumbers = Object.keys(DATA.layers).filter(k => k !== 'isolated').map(Number).sort((a,b) => a-b);
    const maxLayer = Math.max(...layerNumbers);
    const radiusStep = Math.min(180, (Math.min(width, height) / 2 - 100) / (maxLayer + 2));

    // Assign target radius for each node based on layer
    nodes.forEach(node => {
      if (node.layer === 'isolated') {
        // Isolated pages go to outermost ring
        node.targetRadius = (maxLayer + 2) * radiusStep;
      } else if (node.layer === 0) {
        // Home at center
        node.targetRadius = 0;
      } else {
        // Other layers at increasing radii
        node.targetRadius = node.layer * radiusStep;
      }

      // Initialize position at target radius with random angle
      const angle = Math.random() * 2 * Math.PI;
      node.x = centerX + node.targetRadius * Math.cos(angle);
      node.y = centerY + node.targetRadius * Math.sin(angle);
    });

    // Draw concentric circles for layer guides
    const layerGuides = g.append('g').attr('class', 'layer-guides');

    layerNumbers.forEach((layerNum) => {
      const radius = layerNum * radiusStep;
      if (radius > 0) {
        layerGuides.append('circle')
          .attr('cx', centerX)
          .attr('cy', centerY)
          .attr('r', radius)
          .attr('fill', 'none')
          .attr('stroke', '#e5e7eb')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '4,4');
      }
    });

    // Isolated layer guide
    const isolatedCount = DATA.layers.isolated ? DATA.layers.isolated.length : 0;
    if (isolatedCount > 0) {
      const isolatedRadius = (maxLayer + 2) * radiusStep;
      layerGuides.append('circle')
        .attr('cx', centerX)
        .attr('cy', centerY)
        .attr('r', isolatedRadius)
        .attr('fill', 'none')
        .attr('stroke', '#f97316')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '4,4');
    }

    // Draw layer labels
    layerNumbers.forEach((layerNum) => {
      const radius = layerNum * radiusStep;
      const layerName = layerNum === 0 ? 'Home' :
                        layerNum === 1 ? 'Header' :
                        layerNum === 2 ? 'Footer' :
                        \`Layer \${layerNum} (\${layerNum - 2} clicks)\`;

      if (radius > 0) {
        g.append('text')
          .attr('class', 'layer-label')
          .attr('x', centerX + radius + 10)
          .attr('y', centerY)
          .attr('text-anchor', 'start')
          .attr('dominant-baseline', 'middle')
          .text(layerName);
      }
    });

    // Isolated layer label
    if (isolatedCount > 0) {
      const isolatedRadius = (maxLayer + 2) * radiusStep;
      g.append('text')
        .attr('class', 'layer-label')
        .attr('x', centerX + isolatedRadius + 10)
        .attr('y', centerY)
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#f97316')
        .text(\`Isolated (\${isolatedCount})\`);
    }

    // Draw links
    const linkElements = g.selectAll('.link')
      .data(links)
      .join('line')
      .attr('class', d => \`link link-\${d.type}\`);

    // Draw nodes
    const nodeGroups = g.selectAll('.node')
      .data(nodes)
      .join('g')
      .attr('class', 'node');

    nodeGroups.append('circle')
      .attr('r', d => getNodeSize(d))
      .attr('fill', d => getNodeColor(d.id, d))
      .on('click', (event, d) => {
        alert(\`Page: \${d.id}\\nLayer: \${d.layer}\\nStatus: \${d.status}\\nIncoming: \${d.incomingCount}\\nOutgoing: \${d.outgoingCount}\`);
      })
      .call(d3.drag()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));

    nodeGroups.append('text')
      .attr('dy', 20)
      .attr('text-anchor', 'middle')
      .text(d => {
        const parts = d.id.split('/');
        const lastPart = parts[parts.length - 1] || '/';
        return lastPart.length > 20 ? lastPart.substring(0, 17) + '...' : lastPart;
      });

    // Force simulation with D3's built-in radial force
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id(d => d.id)
        .distance(d => {
          const source = nodes.find(n => n.id === d.source);
          const target = nodes.find(n => n.id === d.target);
          // Shorter links within same layer, longer across layers
          return Math.abs((source?.layer || 0) - (target?.layer || 0)) * 50 + 40;
        })
        .strength(0.2))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('collision', d3.forceCollide().radius(d => getNodeSize(d) + 15).strength(1))
      .force('radial', d3.forceRadial(d => d.targetRadius, centerX, centerY).strength(0.8))
      .on('tick', ticked);

    function ticked() {
      linkElements
        .attr('x1', d => {
          const source = nodes.find(n => n.id === d.source.id || n.id === d.source);
          return source ? source.x : 0;
        })
        .attr('y1', d => {
          const source = nodes.find(n => n.id === d.source.id || n.id === d.source);
          return source ? source.y : 0;
        })
        .attr('x2', d => {
          const target = nodes.find(n => n.id === d.target.id || n.id === d.target);
          return target ? target.x : 0;
        })
        .attr('y2', d => {
          const target = nodes.find(n => n.id === d.target.id || n.id === d.target);
          return target ? target.y : 0;
        });

      nodeGroups
        .attr('transform', d => \`translate(\${d.x},\${d.y})\`);
    }

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    console.log('Visualization rendered:', {
      nodes: nodes.length,
      links: links.length,
      layers: layerNumbers.length
    });
  </script>
</body>
</html>`;
}

/**
 * Main entry point
 */
async function main() {
  log('Starting Site Visualization Tool', 'blue')
  log(`Input: ${CONFIG.inputFile}`, 'blue')
  log(`Output: ${CONFIG.outputFile}\n`, 'blue')

  // Load report
  log('Loading site check report...', 'cyan')
  const report = await loadReport(CONFIG.inputFile)
  log(`  Loaded ${Object.keys(report.pages).length} pages\n`, 'green')

  // Calculate layers
  log('Calculating page layers and depths...', 'cyan')
  const { layers, pageMetadata } = calculateLayers(report.pages)
  log(`  Organized into ${Object.keys(layers).length} layers\n`, 'green')

  // Generate statistics
  const stats = generateStatistics(layers, pageMetadata, report)
  printSummary(stats, layers)

  // Generate HTML visualization
  log('Generating HTML visualization...', 'cyan')
  const html = generateHTML(report, layers, pageMetadata, stats)
  await fs.writeFile(CONFIG.outputFile, html, 'utf8')
  log(`✓ Visualization saved to: ${CONFIG.outputFile}\n`, 'green')

  log('Open the file in your browser to view the interactive sitemap!', 'cyan')
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    log(`Fatal error: ${error.message}`, 'red')
    console.error(error)
    process.exit(1)
  })
}

module.exports = { main, calculateLayers, identifyHeaderFooterPages }
