// Simple visit counter with total post hits and daily stats. Daily unique app hits is captured using an ip and user-agent set.
// Visits are saved to memory immediately, and this is saved to disk every 1 hour.
// At the start of a new day (12am) the ip and user-agent set is cleared, and older than 30 day stats are deleted.
// Visit counting is in local time with prototype pollution defenses

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const srcUtils = require('../src/utils.js');
const utils = require('./utils');

// Prepare visit counter
const visitCounterDirectory = path.join(__dirname, '../data');
if (!fs.existsSync(visitCounterDirectory)) {
    fs.mkdirSync(visitCounterDirectory);
}
const visitCountFilePath = path.join(__dirname, '../data/visitCounts.json');
if (!fs.existsSync(visitCountFilePath)) {
    fs.writeFileSync(visitCountFilePath, JSON.stringify({}));
}

const appHitIpSetToday = new Set();
let searchTermFreqToday = new Map();
let printFreqToday = new Map();

const TOTAL_POST_HITS_KEY = 'totalPostHits';
const UNIQUE_APP_HITS_KEY = 'uniqueAppHits';
const HOMEPAGE_HITS_KEY = 'homepageHits';
const POST_HITS_KEY = 'postHits';
const SEARCH_HITS_KEY = 'searchHits';
const TOP_SEARCHES_KEY = 'topSearches';
const PRINT_HITS_KEY = 'printHits';
const TOP_PRINTS_KEY = 'topPrints';

// Load saved visit counts
let visitCounter;
try {
    visitCounter = JSON.parse(fs.readFileSync(visitCountFilePath), (key, value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.assign(Object.create(null), value);
        }
        return value;
    });
} catch (err) {
    console.log('Failed to parse existing visitCounts.json, starting fresh.');
    visitCounter = Object.create(null);
}

if (!visitCounter[TOTAL_POST_HITS_KEY]) {
    visitCounter[TOTAL_POST_HITS_KEY] = Object.create(null);
}

// Restore frequency tracking on server boot to minimise impact of server restart
const statsToday = getStatsGroup(new Date());
const topSearchesObj = statsToday[TOP_SEARCHES_KEY] || Object.create(null);
const topPrintsObj = statsToday[TOP_PRINTS_KEY] || Object.create(null);
searchTermFreqToday = new Map(Object.entries(topSearchesObj));
printFreqToday = new Map(Object.entries(topPrintsObj));

// Visits are not recorded if ?test=true or if an asset
// pathname includes search string
function visitCounterMiddleware(req, res, next) {
    try {
        const lowerCasePath = req.path ? req.path.toLowerCase() : req.path;
        const shouldSkipCounting = req.query.test?.toLowerCase() === 'true' || (typeof req.body?.pathname === 'string' && req.body.pathname.toLowerCase().includes('test=true'));

        // Count unique visit
        if (req.method === 'GET' && !shouldSkipCounting) {
            countUniqueVisit(req.ip, req.headers['user-agent']);
        }

        // Skip assets
        const isImage = srcUtils.ALLOWED_IMAGE_EXTENSIONS.some((ext) => lowerCasePath.endsWith(ext)) || lowerCasePath.endsWith('.ico');
        if (lowerCasePath.startsWith(`/${srcUtils.CSS_FOLDER}`) || lowerCasePath.startsWith(`/${srcUtils.JS_FOLDER}`) || lowerCasePath.endsWith('.json') || isImage) {
            return next();
        }

        // Skip tracking test traffic
        if (req.method === 'POST' && lowerCasePath === '/track-event' && shouldSkipCounting) {
            return sendNoStoreStatus(res, 200);
        }

        // Count page hits and printing
        if (req.method === 'POST' && lowerCasePath === '/track-event' && ['pageview', 'print'].includes(req.body?.event) && typeof req.body?.pathname === 'string') {
            const path = req.body.pathname.split('?')[0].toLowerCase();
            const { isPost, matchedPostType, postName } = utils.parseRequest(path);

            if (isPost || path === '/') {
                const page = isPost ? postName : 'homepage';
                if (req.body.event === 'pageview') countPageVisit(matchedPostType, page);
                if (req.body.event === 'print') countPrint(page);
            }

            return sendNoStoreStatus(res, 200);
        }

        // Count search hits and terms
        if (req.method === 'POST' && lowerCasePath === '/track-event' && req.body?.event === 'search' && typeof req.body?.query === 'string') {
            countSearch(req.body.query);
            return sendNoStoreStatus(res, 200);
        }

        next();
    } catch (err) {
        console.error('Error counting visits (middleware):', err);
        next();
    }
}

function sendNoStoreStatus(res, statusCode) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendStatus(statusCode);
}

// Start timers to save visits
function startAutoSave() {
    // Save all visits every 1 hour, to reduce impact of data loss on server downtime
    setInterval(saveVisits, 60 * 60 * 1000).unref();

    // Schedule the new day reset
    scheduleNextMidnight();
}

// Schedule reset at next local midnight
// Recalculate midnight after each run to account for drift and DST shifts
function scheduleNextMidnight() {
    const now = new Date();
    const nextLocalMidnight = new Date(now).setHours(24, 0, 0, 0);
    const msToMidnight = nextLocalMidnight - now;

    setTimeout(() => {
        try {
            newDayReset();
        } finally {
            scheduleNextMidnight();
        }
    }, msToMidnight).unref();
}

// Update the unique site visit, to be saved on the next saveVisits
function countUniqueVisit(ip, userAgent) {
    const userAgentToUse = userAgent || '';
    const hash = generateHash(ip, userAgentToUse);
    if (!appHitIpSetToday.has(hash)) {
        appHitIpSetToday.add(hash);
        const statsToday = getStatsGroup(new Date());
        statsToday[UNIQUE_APP_HITS_KEY]++;
    }
}

// Update the page visit, to be saved on the next saveVisits
function countPageVisit(postType, page) {
    const statsToday = getStatsGroup(new Date());
    // Save the page visit
    // Homepage
    if (page === 'homepage') {
        statsToday[HOMEPAGE_HITS_KEY]++;
        return;
    }

    // Post page
    const cleanPage = cleanTerm(page);
    statsToday[POST_HITS_KEY]++;
    if (!visitCounter[TOTAL_POST_HITS_KEY][postType]) {
        visitCounter[TOTAL_POST_HITS_KEY][postType] = Object.create(null);
    }
    visitCounter[TOTAL_POST_HITS_KEY][postType][cleanPage] = (visitCounter[TOTAL_POST_HITS_KEY][postType][cleanPage] || 0) + 1;
}

// Update the print hit, to be saved on the next saveVisits
function countPrint(post) {
    const statsToday = getStatsGroup(new Date());
    statsToday[PRINT_HITS_KEY]++;
    storeFrequencyTracking(printFreqToday, cleanTerm(post));
}

// Update the search hit, to be saved on the next saveVisits
function countSearch(query) {
    const cleanQuery = cleanTerm(query);
    if (!cleanQuery) return;

    const statsToday = getStatsGroup(new Date());
    statsToday[SEARCH_HITS_KEY]++;
    storeFrequencyTracking(searchTermFreqToday, cleanQuery);
}

// For frequency items such as search terms
function storeFrequencyTracking(trackingMap, term) {
    if (!term || typeof term !== 'string') return;

    let count = trackingMap.get(term) || 0;
    if (count > 0) {
        trackingMap.set(term, ++count);
    } else if (trackingMap.size < 10000) {
        trackingMap.set(term, 1);
    }
}

function cleanTerm(term) {
    return term?.toLowerCase().trim().slice(0, 100);
}

// Save all site visits
function saveVisits() {
    // Calculate and add frequent searches
    const statsToday = getStatsGroup(new Date());
    statsToday[TOP_SEARCHES_KEY] = getTopFrequencyResults(searchTermFreqToday);
    statsToday[TOP_PRINTS_KEY] = getTopFrequencyResults(printFreqToday);

    // Save with atomic write
    try {
        const tmpPath = `${visitCountFilePath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(visitCounter, null, 4), 'utf8');
        fs.renameSync(tmpPath, visitCountFilePath);
    } catch (err) {
        console.error('Error saving site visits to file (saveVisits):', err);
    }
}

// Returns the top results limited by maxResults, but will extend in case of a tie
function getTopFrequencyResults(trackingMap, maxResults = 5) {
    if (!trackingMap || typeof trackingMap.entries !== 'function') return Object.create(null);

    const sorted = Array.from(trackingMap.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length < maxResults) return Object.assign(Object.create(null), Object.fromEntries(sorted));
    const thresholdFreq = sorted[maxResults - 1][1];
    return Object.assign(Object.create(null), Object.fromEntries(sorted.filter((entry) => entry[1] >= thresholdFreq)));
}

function generateHash(ip, ua) {
    return crypto.createHash('MD5').update(ip).update('|').update(ua).digest('hex');
}

// Get the date's stats group, initialise if it doesn't exist
function getStatsGroup(date) {
    const day = getISODateFormat(new Date(date));

    const createDefaults = () =>
        Object.assign(Object.create(null), {
            [UNIQUE_APP_HITS_KEY]: 0,
            [HOMEPAGE_HITS_KEY]: 0,
            [POST_HITS_KEY]: 0,
            [SEARCH_HITS_KEY]: 0,
            [TOP_SEARCHES_KEY]: null,
            [PRINT_HITS_KEY]: 0,
            [TOP_PRINTS_KEY]: null,
        });

    if (!visitCounter[day]) {
        visitCounter[day] = createDefaults();
    } else {
        // If day already initialised, merge defaults in case of property changes
        visitCounter[day] = Object.assign(Object.create(null), createDefaults(), visitCounter[day]);
    }

    return visitCounter[day];
}

// Called at the start of the day to reset
function newDayReset() {
    try {
        saveVisits();
        appHitIpSetToday.clear();
        searchTermFreqToday.clear();
        printFreqToday.clear();

        // Rotate daily stats, only store 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        for (const item in visitCounter) {
            if (item === TOTAL_POST_HITS_KEY) {
                continue;
            }
            const savedVisitDate = new Date(item);
            savedVisitDate.setHours(0, 0, 0, 0);
            if (savedVisitDate < thirtyDaysAgo) {
                delete visitCounter[item];
            }
        }
    } catch (err) {
        console.error('Error resetting visit counting (newDayReset):', err);
    }
}

// Returns the date in ISO format in the local timezone
function getISODateFormat(date) {
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    return `${year}-${month}-${day}`;
}

module.exports = {
    visitCounterMiddleware,
    startAutoSave,
    ...(process.env.NODE_ENV === 'test' && {
        getStatsGroup,
        scheduleNextMidnight,
        countUniqueVisit,
        countPageVisit,
        countPrint,
        countSearch,
        cleanTerm,
        saveVisits,
        getTopFrequencyResults,
        newDayReset,
        getISODateFormat,
        appHitIpSetToday,
        visitCounter,
        searchTermFreqToday,
        printFreqToday,
        generateHash,
        UNIQUE_APP_HITS_KEY,
        HOMEPAGE_HITS_KEY,
        TOP_SEARCHES_KEY,
        newDayReset,
        getISODateFormat,
    }),
};
