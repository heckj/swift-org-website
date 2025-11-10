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
 * Site Check Tool
 *
 * Crawls the local Swift.org development site to identify content issues:
 * - Broken internal links
 * - Broken images
 * - Isolated pages (no incoming links)
 * - Pages with no outgoing links
 *
 * The crawler attempts to load /sitemap.xml first to get a comprehensive list
 * of all pages. If the sitemap is not available, it falls back to crawling
 * from the homepage.
 *
 * Usage: npm run site-check
 *
 * Environment Variables:
 * - SITE_URL: Base URL to crawl (default: http://localhost:4000)
 * - MAX_PAGES: Maximum number of pages to crawl (default: 1000)
 * - CHECK_EXTERNAL: Whether to check external links (default: false)
 * - CRAWL_DELAY: Delay in milliseconds between page requests (default: 50)
 *               Increase this if your dev server is struggling (e.g., 250, 500, 1000)
 */

const { chromium } = require('playwright')
const fs = require('fs').promises
const path = require('path')

// Configuration - can be overridden via environment variables
const CONFIG = {
  baseUrl: process.env.SITE_URL || 'http://localhost:4000', // Target site URL
  maxPages: parseInt(process.env.MAX_PAGES) || 1000, // Limit crawl to prevent runaway
  timeout: 30000, // Page load timeout in milliseconds
  checkExternalLinks: process.env.CHECK_EXTERNAL === 'true', // Currently unused, reserved for future
  concurrency: 3, // Currently unused, reserved for concurrent crawling
  outputFile: 'site-check-report.json', // Where to save the detailed JSON report
  delayBetweenRequests: parseInt(process.env.CRAWL_DELAY) || 50, // Delay in ms between page requests (default 50ms)
}

// State tracking - shared across all crawl operations
const state = {
  visited: new Set(), // URLs already crawled
  toVisit: new Set(), // Set of URLs to crawl next
  pages: new Map(), // url -> { outgoingLinks: {header: [], footer: [], content: []}, images: [], incomingLinks: [] }
  brokenLinks: [], // Links that returned 404
  brokenImages: new Map(), // Map of broken image URL -> { pages: [], alt: string }
  redirects: [], // Pages that redirect to another URL
  errors: [], // Pages that threw errors during crawl
  externalLinks: new Map(), // Map of domain -> { pages: Set() }
}

// Color codes for console output - ANSI escape sequences
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

// Helper to log colored messages to console
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

// Helper to add delay between requests
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Check if URL belongs to the same site being crawled (not external)
function isInternalUrl(url, baseUrl) {
  try {
    const urlObj = new URL(url, baseUrl)
    const baseObj = new URL(baseUrl)

    // Consider localhost and 0.0.0.0 as the same host
    const normalizeHost = (hostname) => {
      if (hostname === '0.0.0.0' || hostname === 'localhost') {
        return 'localhost'
      }
      return hostname
    }

    return (
      normalizeHost(urlObj.hostname) === normalizeHost(baseObj.hostname) &&
      urlObj.port === baseObj.port
    )
  } catch {
    return false
  }
}

// Normalize URLs for consistent comparison - removes hash and trailing slash
function normalizeUrl(url, baseUrl) {
  try {
    const urlObj = new URL(url, baseUrl)
    // Remove hash and trailing slash for consistency
    urlObj.hash = ''
    let normalized = urlObj.href
    if (normalized.endsWith('/') && normalized !== baseUrl + '/') {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return null
  }
}

// Strip base URL from internal links - returns just the path/URI
function stripBaseUrl(url, baseUrl) {
  try {
    const urlObj = new URL(url)
    const baseObj = new URL(baseUrl)

    // Only strip if it's the same host
    if (urlObj.hostname === baseObj.hostname) {
      return urlObj.pathname + urlObj.search + urlObj.hash
    }
    return url
  } catch {
    return url
  }
}

// Extract all links and images from the current page using browser context
// Links are categorized into header, footer, and content buckets
async function extractLinksAndImages(page, currentUrl) {
  return await page.evaluate(() => {
    const images = []

    // Helper to extract links from a container
    const extractLinks = (container) => {
      const links = []
      if (!container) return links

      container.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href')
        if (
          href &&
          !href.startsWith('javascript:') &&
          !href.startsWith('mailto:')
        ) {
          links.push({
            href: href,
            text: a.textContent.trim().substring(0, 100), // Truncate long link text
          })
        }
      })
      return links
    }

    // Extract header/navigation links
    const headerContainer = document.querySelector('header.site-navigation')
    const headerLinks = extractLinks(headerContainer)

    // Extract footer links
    const footerContainer = document.querySelector('footer.global-footer')
    const footerLinks = extractLinks(footerContainer)

    // Extract content links (defensive: all links minus header and footer)
    const allLinks = extractLinks(document)
    const headerHrefs = new Set(headerLinks.map((l) => l.href))
    const footerHrefs = new Set(footerLinks.map((l) => l.href))
    const contentLinks = allLinks.filter(
      (link) => !headerHrefs.has(link.href) && !footerHrefs.has(link.href),
    )

    // Extract all images with their src and alt text
    document.querySelectorAll('img[src]').forEach((img) => {
      images.push({
        src: img.getAttribute('src'),
        alt: img.getAttribute('alt') || '(no alt text)',
      })
    })

    return { headerLinks, footerLinks, contentLinks, images }
  })
}

// Main crawl function - visits a page, extracts links/images, checks validity
async function crawlPage(browser, url, depth = 0) {
  // Skip if already visited or reached max page limit from CONFIG
  if (state.visited.has(url) || state.visited.size >= CONFIG.maxPages) {
    return
  }

  state.visited.add(url)
  log(`[${state.visited.size}/${CONFIG.maxPages}] Crawling: ${url}`, 'cyan')

  const page = await browser.newPage()
  const failedImages = new Set() // Track images that failed to load

  // Listen for failed image requests during page load
  page.on('requestfailed', (request) => {
    if (request.resourceType() === 'image') {
      failedImages.add(request.url())
    }
  })

  try {
    // Load page with timeout from CONFIG
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.timeout,
    })

    // Track pages that fail to load
    if (!response || response.status() !== 200) {
      // Get referrers (pages that link to this failed page)
      const referrers = state.pages.has(url)
        ? state.pages.get(url).incomingLinks
        : []

      state.errors.push({
        url,
        error: `HTTP ${response?.status() || 'unknown'}`,
        referrers,
      })
      await page.close()
      return
    }

    // Detect redirects by comparing requested URL with final URL
    // Ignore redirects that only add a trailing slash
    const finalUrl = response.url()
    const isTrailingSlashRedirect =
      finalUrl === url + '/' || finalUrl + '/' === url

    if (finalUrl !== url && !isTrailingSlashRedirect) {
      state.redirects.push({
        from: url,
        to: finalUrl,
        status: response.status(),
      })
      log(`  Redirect: ${url} -> ${finalUrl}`, 'yellow')
    }

    // Extract links and images
    const { headerLinks, footerLinks, contentLinks, images } =
      await extractLinksAndImages(page, url)

    // Initialize page data in state
    if (!state.pages.has(url)) {
      state.pages.set(url, {
        outgoingLinks: {
          header: [],
          footer: [],
          content: [],
        },
        images: [],
        incomingLinks: [],
        status: response.status(),
      })
    }

    const pageData = state.pages.get(url)

    // Helper function to process links from a specific category
    const processLinks = (links, category) => {
      for (const link of links) {
        const normalizedUrl = normalizeUrl(link.href, url)
        if (!normalizedUrl) continue

        // Check if link is internal or external
        if (isInternalUrl(normalizedUrl, CONFIG.baseUrl)) {
          // Internal link - add to categorized outgoing links
          pageData.outgoingLinks[category].push(normalizedUrl)

          // Track incoming links for orphan detection
          if (!state.pages.has(normalizedUrl)) {
            state.pages.set(normalizedUrl, {
              outgoingLinks: {
                header: [],
                footer: [],
                content: [],
              },
              images: [],
              incomingLinks: [],
            })
          }
          state.pages.get(normalizedUrl).incomingLinks.push(url)

          // Add to crawl queue if not yet visited (O(1) Set lookup)
          if (!state.visited.has(normalizedUrl) && !state.toVisit.has(normalizedUrl)) {
            state.toVisit.add(normalizedUrl)
          }
        } else {
          // External link - track the domain
          try {
            const linkHostname = new URL(normalizedUrl).hostname
            if (!state.externalLinks.has(linkHostname)) {
              state.externalLinks.set(linkHostname, { pages: new Set() })
            }
            state.externalLinks.get(linkHostname).pages.add(url)
          } catch (e) {
            // Invalid URL, skip
          }
        }
      }
    }

    // Process links from each category
    processLinks(headerLinks, 'header')
    processLinks(footerLinks, 'footer')
    processLinks(contentLinks, 'content')

    // Process images and check against failed requests
    for (const image of images) {
      const imageUrl = normalizeUrl(image.src, url)
      if (imageUrl) {
        pageData.images.push(imageUrl)

        // Check if image failed to load during page rendering
        if (failedImages.has(imageUrl)) {
          // Add or update broken image entry with deduplication
          if (!state.brokenImages.has(imageUrl)) {
            state.brokenImages.set(imageUrl, {
              pages: [url],
              alt: image.alt,
            })
          } else {
            // Add this page to the list of pages with this broken image
            state.brokenImages.get(imageUrl).pages.push(url)
          }
        }
      }
    }
  } catch (error) {
    // Get referrers (pages that link to this failed page)
    const referrers = state.pages.has(url)
      ? state.pages.get(url).incomingLinks
      : []

    state.errors.push({
      url,
      error: error.message,
      referrers,
    })
    log(`  Error: ${error.message}`, 'red')
  } finally {
    await page.close()
  }
}

// Validate links that were discovered but not crawled (check for 404s)
// Only validates internal links - external links are not checked
async function validateLinks(browser) {
  log('\nValidating internal links...', 'blue')

  const page = await browser.newPage()
  const allLinks = new Set()

  // Collect all unique internal links from crawled pages
  for (const [url, data] of state.pages) {
    // Collect from all three categories
    for (const link of data.outgoingLinks.header) {
      allLinks.add(link)
    }
    for (const link of data.outgoingLinks.footer) {
      allLinks.add(link)
    }
    for (const link of data.outgoingLinks.content) {
      allLinks.add(link)
    }
  }

  // Check links that weren't visited during crawl
  // Only check internal links (external links are already filtered out)
  for (const link of allLinks) {
    if (!state.visited.has(link)) {
      try {
        log(`  Checking unvisited link: ${link}`, 'yellow')
        const response = await page.request.head(link, { timeout: 10000 })
        if (response.status() === 404) {
          // Use existing incomingLinks tracking instead of searching
          const referrers = state.pages.has(link)
            ? state.pages.get(link).incomingLinks
            : []

          state.brokenLinks.push({
            url: link,
            referrers,
            status: 404,
          })
        }
      } catch (error) {
        log(`  Error checking ${link}: ${error.message}`, 'red')
      }
    }
  }

  await page.close()
}

// Find pages with no incoming links (orphaned/isolated pages)
function analyzeIsolatedPages() {
  const isolated = []
  const homepage = normalizeUrl('/', CONFIG.baseUrl)

  for (const [url, data] of state.pages) {
    // Skip homepage from isolation check
    if (url === homepage || url === CONFIG.baseUrl) continue

    // Check if page has incoming links (excluding self-references)
    const incomingLinks = data.incomingLinks.filter((link) => link !== url)
    if (incomingLinks.length === 0) {
      // Count total outgoing links across all categories
      const totalOutgoingLinks =
        data.outgoingLinks.header.length +
        data.outgoingLinks.footer.length +
        data.outgoingLinks.content.length

      isolated.push({
        url,
        outgoingLinks: totalOutgoingLinks,
      })
    }
  }

  return isolated
}

// Load and parse sitemap.xml to get initial list of URLs to crawl
async function loadSitemap(browser) {
  const sitemapUrl = `${CONFIG.baseUrl}/sitemap.xml`
  log(`Attempting to load sitemap from: ${sitemapUrl}`, 'blue')

  const page = await browser.newPage()
  const urls = []

  try {
    const response = await page.goto(sitemapUrl, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.timeout,
    })

    if (!response || response.status() !== 200) {
      log(
        `  Sitemap not found (HTTP ${response?.status() || 'unknown'})`,
        'yellow',
      )
      await page.close()
      return null
    }

    // Get the sitemap content
    const content = await page.content()

    // Parse XML to extract <loc> tags using regex
    // This handles both <loc>URL</loc> and <loc><![CDATA[URL]]></loc> formats
    const locRegex = /<loc>\s*(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?\s*<\/loc>/gi
    let match

    while ((match = locRegex.exec(content)) !== null) {
      const url = match[1].trim()
      if (url && isInternalUrl(url, CONFIG.baseUrl)) {
        const normalized = normalizeUrl(url, CONFIG.baseUrl)
        if (normalized) {
          urls.push(normalized)
        }
      }
    }

    await page.close()

    if (urls.length === 0) {
      log(`  Sitemap found but contains no valid URLs`, 'yellow')
      return null
    }

    log(`  Found ${urls.length} URLs in sitemap`, 'green')
    return urls
  } catch (error) {
    log(`  Error loading sitemap: ${error.message}`, 'yellow')
    await page.close()
    return null
  }
}

// Generate JSON report with all findings - saved to CONFIG.outputFile
function generateReport() {
  const isolated = analyzeIsolatedPages()

  // Count total links across all categories
  const totalLinks = Array.from(state.pages.values()).reduce((sum, p) => {
    return (
      sum +
      p.outgoingLinks.header.length +
      p.outgoingLinks.footer.length +
      p.outgoingLinks.content.length
    )
  }, 0)

  // Create a Set of isolated page URLs for quick lookup
  const isolatedSet = new Set(isolated.map((p) => p.url))

  // Build page-centric report structure
  const pages = {}
  for (const [url, data] of state.pages.entries()) {
    const strippedUrl = stripBaseUrl(url, CONFIG.baseUrl)

    // Find any redirect that originated from this page
    const redirect = state.redirects.find((r) => r.from === url)

    // Find any error that occurred on this page
    const error = state.errors.find((e) => e.url === url)

    // Find broken links that this page links to
    const allOutgoingLinks = [
      ...data.outgoingLinks.header,
      ...data.outgoingLinks.footer,
      ...data.outgoingLinks.content,
    ]
    const brokenLinksFromThisPage = state.brokenLinks
      .filter(
        (bl) =>
          data.outgoingLinks.header.includes(bl.url) ||
          data.outgoingLinks.footer.includes(bl.url) ||
          data.outgoingLinks.content.includes(bl.url),
      )
      .map((bl) => ({
        url: stripBaseUrl(bl.url, CONFIG.baseUrl),
        status: bl.status,
      }))

    // Find broken images on this page
    const brokenImagesOnPage = Array.from(state.brokenImages.entries())
      .filter(([imageUrl, imageData]) => imageData.pages.includes(url))
      .map(([imageUrl, imageData]) => ({
        url: stripBaseUrl(imageUrl, CONFIG.baseUrl),
        alt: imageData.alt,
      }))

    // Find external domains linked from this page
    const externalDomainsFromPage = []
    for (const [domain, domainData] of state.externalLinks.entries()) {
      if (domainData.pages.has(url)) {
        externalDomainsFromPage.push(domain)
      }
    }

    // Deduplicate and strip incoming links
    const uniqueIncomingLinks = [...new Set(data.incomingLinks)].map((link) =>
      stripBaseUrl(link, CONFIG.baseUrl),
    )

    pages[strippedUrl] = {
      incomingLinks: uniqueIncomingLinks,
      isIsolated: isolatedSet.has(url),
      outgoingLinks: {
        header: data.outgoingLinks.header.map((link) =>
          stripBaseUrl(link, CONFIG.baseUrl),
        ),
        footer: data.outgoingLinks.footer.map((link) =>
          stripBaseUrl(link, CONFIG.baseUrl),
        ),
        content: data.outgoingLinks.content.map((link) =>
          stripBaseUrl(link, CONFIG.baseUrl),
        ),
      },
      externalDomains: externalDomainsFromPage,
      imagesCount: data.images.length,
      issues: {
        redirect: redirect
          ? {
              to: stripBaseUrl(redirect.to, CONFIG.baseUrl),
              status: redirect.status,
            }
          : null,
        error: error ? error.error : null,
        brokenLinks: brokenLinksFromThisPage,
        brokenImages: brokenImagesOnPage,
      },
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    config: CONFIG,
    summary: {
      totalPages: state.visited.size,
      totalLinks: totalLinks,
      brokenLinks: state.brokenLinks.length,
      brokenImages: state.brokenImages.size,
      redirects: state.redirects.length,
      isolatedPages: isolated.length,
      errors: state.errors.length,
      externalDomains: state.externalLinks.size,
    },
    pages: pages,
  }

  return report
}

// Print colorized summary to console - truncates long lists
function printSummary(report) {
  log('\n' + '='.repeat(60), 'cyan')
  log('Site Check Summary', 'cyan')
  log('='.repeat(60), 'cyan')

  log(`\nPages Crawled: ${report.summary.totalPages}`, 'blue')
  log(`Total Links: ${report.summary.totalLinks}`, 'blue')

  // Collect issues from page-centric structure
  const brokenLinks = []
  const brokenImages = []
  const redirects = []
  const isolatedPages = []

  for (const [pageUrl, pageData] of Object.entries(report.pages)) {
    if (pageData.issues.brokenLinks.length > 0) {
      pageData.issues.brokenLinks.forEach((bl) => {
        brokenLinks.push({
          url: bl.url,
          referrer: pageUrl,
        })
      })
    }
    if (pageData.issues.brokenImages.length > 0) {
      pageData.issues.brokenImages.forEach((bi) => {
        brokenImages.push({
          url: bi.url,
          alt: bi.alt,
          page: pageUrl,
        })
      })
    }
    if (pageData.issues.redirect) {
      redirects.push({
        from: pageUrl,
        to: pageData.issues.redirect.to,
      })
    }
    if (pageData.isIsolated) {
      isolatedPages.push(pageUrl)
    }
    if (pageData.issues.error) {
      // Add to broken links list so they appear in the broken links report
      // Include error pages even if they have no referrers
      if (pageData.incomingLinks.length > 0) {
        pageData.incomingLinks.forEach((referrer) => {
          brokenLinks.push({
            url: pageUrl,
            referrer: referrer,
            error: pageData.issues.error,
          })
        })
      } else {
        // Error page with no incoming links - still report it
        brokenLinks.push({
          url: pageUrl,
          referrer: '(no referrers)',
          error: pageData.issues.error,
        })
      }
    }
  }

  if (brokenLinks.length > 0) {
    log(`\n❌ Broken Links: ${brokenLinks.length}`, 'red')
    brokenLinks.forEach((link) => {
      log(`  ${link.url}`, 'red')
      if (link.error) {
        log(`    Error: ${link.error}`, 'red')
      }
      log(`    Referenced by: ${link.referrer}`, 'yellow')
    })
  } else {
    log(`\n✅ No broken links found`, 'green')
  }

  if (brokenImages.length > 0) {
    log(`\n❌ Broken Images: ${brokenImages.length}`, 'red')
    brokenImages.slice(0, 10).forEach((img) => {
      log(`  ${img.url}`, 'red')
      log(`    Alt text: ${img.alt}`, 'yellow')
      log(`    Found on: ${img.page}`, 'yellow')
    })
    if (brokenImages.length > 10) {
      log(
        `  ... and ${brokenImages.length - 10} more (see report file)`,
        'yellow',
      )
    }
  } else {
    log(`\n✅ No broken images found`, 'green')
  }

  if (redirects.length > 0) {
    log(`\n⚠️  Redirects: ${redirects.length}`, 'yellow')
    log('  (Pages that redirect to another URL)', 'yellow')
    redirects.slice(0, 10).forEach((redirect) => {
      log(`  ${redirect.from}`, 'yellow')
      log(`    -> ${redirect.to}`, 'cyan')
    })
    if (redirects.length > 10) {
      log(`  ... and ${redirects.length - 10} more (see report file)`, 'yellow')
    }
  } else {
    log(`\n✅ No redirects found`, 'green')
  }

  if (isolatedPages.length > 0) {
    log(`\n⚠️  Isolated Pages: ${isolatedPages.length}`, 'yellow')
    log('  (Pages with no incoming links from the site)', 'yellow')
    isolatedPages.forEach((page) => {
      log(`  ${page}`, 'yellow')
    })
  } else {
    log(`\n✅ No isolated pages found`, 'green')
  }

  if (report.summary.externalDomains > 0) {
    log(
      `\n🔗 External Domains Linked: ${report.summary.externalDomains}`,
      'blue',
    )
    log('  (See individual pages in report for details)', 'blue')
  }

  log(`\n📄 Full report saved to: ${CONFIG.outputFile}`, 'green')
  log('='.repeat(60) + '\n', 'cyan')
}

// Main entry point - orchestrates crawl, validation, and reporting
async function main() {
  log('Starting Swift.org Site Check Tool', 'blue')
  log(`Base URL: ${CONFIG.baseUrl}`, 'blue')
  log(`Max Pages: ${CONFIG.maxPages}\n`, 'blue')

  // Launch headless browser via Playwright
  const browser = await chromium.launch({ headless: true })

  try {
    // Try to load sitemap.xml to get initial list of URLs
    const sitemapUrls = await loadSitemap(browser)

    if (sitemapUrls && sitemapUrls.length > 0) {
      // Use sitemap URLs as starting point
      log(`Using sitemap URLs as crawl queue`, 'green')
      for (const url of sitemapUrls) {
        state.toVisit.add(url)
      }
    } else {
      // Fall back to starting from homepage
      log(`⚠️  Sitemap not available, starting from homepage only`, 'yellow')
      log(
        `   This may miss pages not linked from the site navigation\n`,
        'yellow',
      )
      state.toVisit.add(CONFIG.baseUrl)
    }

    log('') // Empty line before crawl starts

    // Crawl pages breadth-first until queue empty or hit CONFIG.maxPages
    while (state.toVisit.size > 0 && state.visited.size < CONFIG.maxPages) {
      // Get and remove first URL from Set (convert to array to get first element)
      const url = state.toVisit.values().next().value
      state.toVisit.delete(url)
      await crawlPage(browser, url)

      // Add delay between requests to avoid overwhelming the server
      if (state.toVisit.size > 0 && CONFIG.delayBetweenRequests > 0) {
        await sleep(CONFIG.delayBetweenRequests)
      }
    }

    // Validate all discovered links that weren't crawled
    await validateLinks(browser)

    // Generate report
    const report = generateReport()

    // Save to file specified in CONFIG.outputFile
    await fs.writeFile(
      CONFIG.outputFile,
      JSON.stringify(report, null, 2),
      'utf8',
    )

    // Print summary
    printSummary(report)

    // Exit with error code if issues found (for CI integration)
    const hasIssues =
      report.summary.brokenLinks > 0 ||
      report.summary.brokenImages > 0 ||
      report.summary.errors > 0

    process.exit(hasIssues ? 1 : 0)
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'red')
    console.error(error)
    process.exit(1)
  } finally {
    await browser.close()
  }
}

// Run if called directly (not imported as module)
if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = { main }
