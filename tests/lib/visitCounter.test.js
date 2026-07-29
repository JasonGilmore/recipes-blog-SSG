beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
});

jest.mock('node:fs');
jest.mock('../../src/utils.js', () => ({
    ...jest.requireActual('../../src/utils.js'),
    parseRequest: jest.fn(),
}));
jest.mock('../../src/config.json', () => ({ contentDirectory: 'configContent1', outputDirectory: 'configOutput1', postTypes: { recipes: {}, blogs: {} } }), {
    virtual: true,
});

describe('init', () => {
    test('create visit count directory and file if not exist', () => {
        const fs = require('node:fs');
        fs.existsSync.mockReturnValue(false);
        fs.readFileSync.mockReturnValue('{}');

        require('../../lib/visitCounter.js');
        expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('data'));
        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('visitCounts.json'), JSON.stringify({}));
    });

    test('load existing data if file exists', () => {
        const fs = require('node:fs');
        fs.existsSync.mockReturnValue(true);
        const today = new Date().toISOString().split('T')[0];
        fs.readFileSync.mockReturnValue(JSON.stringify({ totalPostHits: {}, [today]: { topSearches: { pie: 1, tart: 2 } } }));
        require('../../lib/visitCounter.js');

        expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    test('should handle corrupted JSON by starting fresh', () => {
        const fs = require('node:fs');
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue('invalid-json');
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
        require('../../lib/visitCounter.js');

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to parse'));
    });
});

describe('track events middlware', () => {
    test('POST /track-event pageview calls sendStatus(200) and does not call next', () => {
        const utils = require('../../src/utils.js');
        utils.parseRequest.mockReturnValue({ isPost: true, matchedPostType: 'recipes', postName: 'bread' });
        const { visitCounterMiddleware } = require('../../lib/visitCounter.js');

        const req = { method: 'POST', path: '/track-event', headers: {}, body: { event: 'pageview', pathname: '/recipes/bread' }, query: {} };
        const res = { sendStatus: jest.fn(), setHeader: jest.fn() };
        const next = jest.fn();
        visitCounterMiddleware(req, res, next);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /track-event search calls sendStatus(200) and does not call next', () => {
        const req = { method: 'POST', path: '/track-event', headers: {}, body: { event: 'search', query: 'chocolate' }, query: {} };
        const res = { sendStatus: jest.fn(), setHeader: jest.fn() };
        const next = jest.fn();
        const { visitCounterMiddleware } = require('../../lib/visitCounter.js');

        visitCounterMiddleware(req, res, next);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /track-event print calls sendStatus(200) and does not call next', () => {
        const req = { method: 'POST', path: '/track-event', headers: {}, body: { event: 'print', pathname: '/recipes/tart?format=print' }, query: {} };
        const res = { sendStatus: jest.fn(), setHeader: jest.fn() };
        const next = jest.fn();
        const { visitCounterMiddleware } = require('../../lib/visitCounter.js');

        visitCounterMiddleware(req, res, next);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /track-event with test=true returns 200 and does not count', () => {
        const req = { method: 'POST', path: '/track-event', headers: {}, body: {}, query: { test: 'true' } };
        const res = { sendStatus: jest.fn(), setHeader: jest.fn() };
        const next = jest.fn();
        const { visitCounterMiddleware } = require('../../lib/visitCounter.js');

        visitCounterMiddleware(req, res, next);
        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(next).not.toHaveBeenCalled();
    });

    test('GET visit count skips asset requests', () => {
        const req = { method: 'GET', path: '/images/photo.jpg', headers: { 'user-agent': 'ua' }, ip: '1.2.3.4', body: {}, query: {} };
        const res = { sendStatus: jest.fn() };
        const next = jest.fn();
        const { visitCounterMiddleware } = require('../../lib/visitCounter.js');

        visitCounterMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.sendStatus).not.toHaveBeenCalled();
    });

    test('GET visit counts calls next() for non-asset calls', () => {
        const req = { method: 'GET', path: '/', headers: { 'user-agent': 'ua' }, ip: '1.2.3.4', body: {}, query: {} };
        const res = { sendStatus: jest.fn() };
        const next = jest.fn();
        const { visitCounterMiddleware } = require('../../lib/visitCounter.js');

        visitCounterMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });
});

test('correctly schedules reset at midnight each day', () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'setTimeout');
    const { scheduleNextMidnight } = require('../../lib/visitCounter.js');
    jest.setSystemTime(new Date('2026-02-22T23:00:00'));
    scheduleNextMidnight();

    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 3600000);

    jest.advanceTimersByTime(3600000);
    expect(setTimeout).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
});

test('startAutoSave schedules interval and timeout', () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'setTimeout');
    jest.spyOn(global, 'setInterval');
    const { startAutoSave } = require('../../lib/visitCounter.js');
    startAutoSave();

    expect(setTimeout).toHaveBeenCalled();
    expect(setInterval).toHaveBeenCalled();

    jest.useRealTimers();
});

test('countUniqueVisit', () => {
    const { countUniqueVisit, appHitIpSetToday, getStatsGroup } = require('../../lib/visitCounter.js');

    countUniqueVisit('100.100.10.10', 'Mozilla/5.0');
    expect(appHitIpSetToday.size).toBe(1);
    expect(getStatsGroup(new Date()).uniqueAppHits).toBe(1);

    countUniqueVisit('100.100.10.10', 'Mozilla/5.0');
    expect(appHitIpSetToday.size).toBe(1);
    expect(getStatsGroup(new Date()).uniqueAppHits).toBe(1);

    countUniqueVisit('100.100.10.11', 'Mozilla/5.1');
    expect(appHitIpSetToday.size).toBe(2);
    expect(getStatsGroup(new Date()).uniqueAppHits).toBe(2);
});

test('countPageVisit', () => {
    const { countPageVisit, getStatsGroup, visitCounter } = require('../../lib/visitCounter.js');

    countPageVisit('recipes', 'cookies');
    expect(getStatsGroup(new Date()).postHits).toBe(1);
    expect(visitCounter.totalPostHits.recipes.cookies).toBe(1);

    countPageVisit('recipes', 'cookies');
    expect(getStatsGroup(new Date()).postHits).toBe(2);
    expect(visitCounter.totalPostHits.recipes.cookies).toBe(2);
    expect(getStatsGroup(new Date()).homepageHits).toBe(0);

    countPageVisit(null, 'homepage');
    expect(getStatsGroup(new Date()).homepageHits).toBe(1);

    countPageVisit(null, 'homepage');
    expect(getStatsGroup(new Date()).homepageHits).toBe(2);
});

test('countSearch', () => {
    // Implicitly tests storeFrequencyTracking
    const { countSearch, getStatsGroup, searchTermFreqToday } = require('../../lib/visitCounter.js');

    countSearch('  Cookies  ');
    expect(getStatsGroup(new Date()).searchHits).toBe(1);
    expect(searchTermFreqToday.get('cookies')).toBe(1);

    countSearch('cookies');
    expect(getStatsGroup(new Date()).searchHits).toBe(2);
    expect(searchTermFreqToday.get('cookies')).toBe(2);

    countSearch('Brownies');
    expect(getStatsGroup(new Date()).searchHits).toBe(3);
    expect(searchTermFreqToday.get('brownies')).toBe(1);

    countSearch('   ');
    countSearch(null);
    expect(getStatsGroup(new Date()).searchHits).toBe(3);
    expect(searchTermFreqToday.size).toBe(2);

    const longQuery = 'a'.repeat(110);
    const truncated = 'a'.repeat(100);
    countSearch(longQuery);
    expect(searchTermFreqToday.has(longQuery)).toBe(false);
    expect(searchTermFreqToday.get(truncated)).toBe(1);
});

test('countPrint', () => {
    // Implicitly tests storeFrequencyTracking
    const { countPrint, getStatsGroup, printFreqToday } = require('../../lib/visitCounter.js');

    countPrint('  Cookies  ');
    expect(getStatsGroup(new Date()).printHits).toBe(1);
    expect(printFreqToday.get('cookies')).toBe(1);

    countPrint('cookies');
    expect(getStatsGroup(new Date()).printHits).toBe(2);
    expect(printFreqToday.get('cookies')).toBe(2);

    countPrint('Brownies');
    expect(getStatsGroup(new Date()).printHits).toBe(3);
    expect(printFreqToday.get('brownies')).toBe(1);
});

test('cleanTerm', () => {
    const { cleanTerm } = require('../../lib/visitCounter.js');

    expect(cleanTerm('COOKIES')).toBe('cookies');
    expect(cleanTerm('   cake   ')).toBe('cake');

    const longString = 'a'.repeat(150);
    const expectedResult = 'a'.repeat(100);
    expect(cleanTerm(longString)).toBe(expectedResult);
    expect(cleanTerm(longString).length).toBe(100);

    expect(cleanTerm(undefined)).toBeUndefined();
    expect(cleanTerm(null)).toBeUndefined();
});

describe('saveVisits', () => {
    test('perform an atomic write', () => {
        const fs = require('node:fs');
        const { saveVisits, visitCounter } = require('../../lib/visitCounter.js');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        saveVisits();

        const expectedData = JSON.stringify(visitCounter, null, 4);
        expect(fs.writeFileSync).toHaveBeenCalledWith(expect.anything(), expectedData, 'utf8');
        expect(fs.renameSync).toHaveBeenCalled();
        expect(consoleSpy).not.toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test('log error if atomic write fails', () => {
        const fs = require('node:fs');
        const { saveVisits, getStatsGroup, getTopFrequencyResults, visitCounter } = require('../../lib/visitCounter.js');
        const statsToday = getStatsGroup(new Date());
        statsToday.topSearches = {};
        statsToday.topPrints = {};
        const expectedData = JSON.stringify(visitCounter, null, 4);
        fs.writeFileSync.mockImplementation((path, content, encoding) => {
            if (content === expectedData) {
                throw new Error('test');
            }
        });
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        saveVisits();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error saving site visits to file'), expect.any(Error));
        consoleSpy.mockRestore();
    });
});

describe('getTopFrequencyResults', () => {
    test('Returns top searches and handles no searches', () => {
        const { getTopFrequencyResults } = require('../../lib/visitCounter.js');

        const topNoResults = getTopFrequencyResults();
        expect(topNoResults).toEqual({});

        const trackingMap = new Map([
            ['cookies', 1],
            ['brownies', 2],
        ]);
        const topResults = getTopFrequencyResults(trackingMap);
        expect(topResults.cookies).toBe(1);
        expect(topResults.brownies).toBe(2);
    });

    test('Correctly orders results and handles tied counts extending above max results', () => {
        const { getTopFrequencyResults } = require('../../lib/visitCounter.js');
        const trackingMap = new Map([
            ['brownies', 3],
            ['cookies', 4],
            ['cupcakes', 2],
            ['loaf cakes', 1],
            ['donuts', 2],
            ['pies', 2],
        ]);

        const topResults = getTopFrequencyResults(trackingMap);
        expect(topResults.cookies).toBe(4);
        expect(topResults.brownies).toBe(3);
        expect(topResults.cupcakes).toBe(2);
        expect(topResults.donuts).toBe(2);
        expect(topResults.pies).toBe(2);
        expect(topResults['loaf cakes']).toBe(undefined);

        // Ensure results are in descending order by count
        expect(Object.keys(topResults)).toEqual(['cookies', 'brownies', 'cupcakes', 'donuts', 'pies']);
    });
});

describe('generateHash', () => {
    const { generateHash } = require('../../lib/visitCounter.js');
    it('returns consistent hash for given inputs', () => {
        const ip = '127.0.0.1';
        const ua = 'Mozilla/5.0';

        const hashOne = generateHash(ip, ua);
        const hashTwo = generateHash(ip, ua);
        expect(hashOne).toBe(hashTwo);
    });

    it('returns different hashes for different inputs', () => {
        const hashOne = generateHash('1.1.1.1', 'Chrome');
        const hashTwo = generateHash('2.2.2.2', 'Chrome');
        expect(hashOne).not.toBe(hashTwo);
    });
});

describe('getStatsGroup', () => {
    const { getStatsGroup, visitCounter, UNIQUE_APP_HITS_KEY, HOMEPAGE_HITS_KEY } = require('../../lib/visitCounter.js');
    test('initialises new stats group', () => {
        const testDate = '2023-10-27';
        const result = getStatsGroup(testDate);

        expect(result).toEqual(
            expect.objectContaining({
                [UNIQUE_APP_HITS_KEY]: 0,
                [HOMEPAGE_HITS_KEY]: 0,
            }),
        );
    });

    it('preserves existing data while merging defaults', () => {
        const day = '2023-10-27';
        visitCounter[day] = { [UNIQUE_APP_HITS_KEY]: 50 };
        const result = getStatsGroup(day);

        expect(result[UNIQUE_APP_HITS_KEY]).toBe(50);
        expect(result[HOMEPAGE_HITS_KEY]).toBe(0);
    });
});

test('newDayReset saves visits, resets tracking and removes old data', () => {
    const {
        newDayReset,
        getStatsGroup,
        UNIQUE_APP_HITS_KEY,
        TOP_SEARCHES_KEY,
        getISODateFormat,
        visitCounter,
        appHitIpSetToday,
        searchTermFreqToday,
    } = require('../../lib/visitCounter.js');

    const today = getISODateFormat(new Date());
    const overThirtyDaysAgoDate = new Date();
    overThirtyDaysAgoDate.setDate(overThirtyDaysAgoDate.getDate() - 31);
    const overThirtyDaysAgo = getISODateFormat(overThirtyDaysAgoDate);

    const statsToKeep = getStatsGroup(today);
    statsToKeep[UNIQUE_APP_HITS_KEY] = 50;
    const statsToRemove = getStatsGroup(overThirtyDaysAgo);

    appHitIpSetToday.add('1.1.1.1');
    searchTermFreqToday.set('cookies', 5);

    expect(visitCounter).toHaveProperty(today);
    expect(visitCounter).toHaveProperty(overThirtyDaysAgo);

    newDayReset();
    expect(visitCounter).toHaveProperty(today);
    expect(visitCounter[today][TOP_SEARCHES_KEY]).toEqual({ cookies: 5 });
    expect(visitCounter[today][UNIQUE_APP_HITS_KEY]).toBe(50);
    expect(visitCounter).not.toHaveProperty(overThirtyDaysAgo);
    expect(appHitIpSetToday.size).toBe(0);
    expect(searchTermFreqToday.size).toBe(0);
});

describe('getISODateFormat', () => {
    const { getISODateFormat } = require('../../lib/visitCounter.js');
    it('formats a standard date correctly', () => {
        const date = new Date('2026-10-25');
        expect(getISODateFormat(date)).toBe('2026-10-25');
    });

    it('pads single digit months and days with a leading zero', () => {
        const date = new Date(2026, 0, 5);
        expect(getISODateFormat(date)).toBe('2026-01-05');
    });

    it('handles the last day of the year', () => {
        const date = new Date('2025-12-31');
        expect(getISODateFormat(date)).toBe('2025-12-31');
    });

    it('handles leap years', () => {
        const leapDay = new Date(2024, 1, 29);
        expect(getISODateFormat(leapDay)).toBe('2024-02-29');
    });
});
