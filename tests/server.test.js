let express;

jest.mock('express', () => {
    const internalMiddlewares = [];
    const mockExpress = jest.fn(() => ({
        use: jest.fn((m) => internalMiddlewares.push(m)),
        listen: jest.fn((p, cb) => {
            if (cb) cb();
            return {
                close: jest.fn((closeCb) => {
                    if (closeCb) closeCb();
                }),
            };
        }),
        set: jest.fn(),
    }));

    mockExpress.json = jest.fn((opts) => 'jsonMiddleware');
    mockExpress.static = jest.fn(() => 'staticMiddleware');
    mockExpress.getInternalMiddlewares = () => internalMiddlewares;
    mockExpress.resetInternalState = () => (internalMiddlewares.length = 0);
    return mockExpress;
});
jest.mock('helmet', () => jest.fn(() => 'helmetMiddleware'));
jest.mock('../lib/visitCounter.js', () => ({
    visitCounterMiddleware: 'visitMiddleware',
    startAutoSave: jest.fn(),
}));
jest.mock('../src/utils.js', () => ({
    ...jest.requireActual('../src/utils.js'),
    isFeatureEnabled: jest.fn(),
}));
jest.mock('../lib/utils.js', () => ({
    parseRequest: jest.fn(() => ({ isPost: false })),
}));

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    express = require('express');
    express.resetInternalState();
});

describe('server setup', () => {
    test('applies helmet middleware', () => {
        require('../server.js');
        expect(express.getInternalMiddlewares()).toContain('helmetMiddleware');
    });

    test('sets up static files directory with html extension', () => {
        require('../server.js');
        expect(express.getInternalMiddlewares()).toContain('staticMiddleware');
        expect(express.static).toHaveBeenCalledWith(expect.stringContaining('public'), { extensions: ['html'] });
    });

    test('server listens', () => {
        require('../server.js');
        const app = express.mock.results[0].value;
        expect(app.listen).toHaveBeenCalledWith(expect.any(Number), expect.any(Function));
    });
});

describe('visit counter', () => {
    test('runs when feature enabled', () => {
        const utils = require('../src/utils.js');
        utils.isFeatureEnabled.mockImplementation((featureName) => featureName === 'enableVisitCounter');
        const visitCounter = require('../lib/visitCounter.js');
        require('../server.js');

        expect(express.json).toHaveBeenCalledWith({ limit: '1kb' });
        expect(express.getInternalMiddlewares()).toContain('visitMiddleware');
        expect(visitCounter.startAutoSave).toHaveBeenCalled();
    });

    test('does not run when feature disabled', () => {
        const utils = require('../src/utils.js');
        utils.isFeatureEnabled.mockImplementation((featureName) => featureName !== 'enableVisitCounter');
        const visitCounter = require('../lib/visitCounter.js');
        require('../server.js');

        expect(express.json).not.toHaveBeenCalled();
        expect(express.getInternalMiddlewares()).not.toContain('visitMiddleware');
        expect(visitCounter.startAutoSave).not.toHaveBeenCalled();
    });
});

test('rewrites canonical paths middleware', () => {
    const utils = require('../lib/utils.js');
    utils.parseRequest.mockImplementation(() => ({
        isPost: true,
        isCanonicalPostPath: true,
        matchedPostType: 'recipes',
        postName: 'bread',
    }));
    require('../server.js');

    const rewriteMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('isCanonicalPostPath'))[0];
    const req = { path: '/recipes/bread', url: '/recipes/bread' };
    const res = {};
    rewriteMiddleware(req, res, () => {});
    expect(req.url).toBe('/recipes/bread/bread');
});

describe('sets cache control headers', () => {
    test('cache control for images', () => {
        require('../server.js');
        const cacheControlMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cache-Control'))[0];
        const reqImage = { path: '/images/pic.jpg', url: '/images/pic.jpg' };
        const resImage = { setHeader: jest.fn() };
        cacheControlMiddleware(reqImage, resImage, () => {});
        expect(resImage.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringMatching(/public, max-age=\d+, immutable/));
    });

    test('cache control for static assets', () => {
        require('../server.js');
        const cacheControlMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cache-Control'))[0];
        const reqAsset = { path: '/js/posts.js', url: '/js/posts.js' };
        const resAsset = { setHeader: jest.fn() };
        cacheControlMiddleware(reqAsset, resAsset, () => {});
        expect(resAsset.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringMatching(/public, max-age=\d+, immutable/));
    });

    test('cache control for search index json', () => {
        require('../server.js');
        const cacheControlMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cache-Control'))[0];
        const reqAsset = { path: '/search-data.1a2b3c.json', url: '/search-data.1a2b3c.json' };
        const resAsset = { setHeader: jest.fn() };
        cacheControlMiddleware(reqAsset, resAsset, () => {});
        expect(resAsset.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringMatching(/public, max-age=\d+, immutable/));
    });

    test('no cache control for other json', () => {
        require('../server.js');
        const cacheControlMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cache-Control'))[0];
        const reqAsset = { path: '/other.json', url: '/other.json' };
        const resAsset = { setHeader: jest.fn() };
        cacheControlMiddleware(reqAsset, resAsset, () => {});
        expect(resAsset.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    });

    test('no cache control for other pages', () => {
        require('../server.js');
        const cacheControlMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cache-Control'))[0];
        const reqPage = { path: '/recipes/bread.html', url: '/recipes/bread.html' };
        const resPage = { setHeader: jest.fn() };
        cacheControlMiddleware(reqPage, resPage, () => {});
        expect(resPage.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    });
});

describe('sets CORS headers', () => {
    const utils = require('../src/utils.js');
    test('CORS for -icon images', () => {
        require('../server.js');
        const corsMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cross-Origin-Resource-Policy'))[0];
        const reqIconImage = { path: '/recipes/bread/bread-icon.jpg', url: '/recipes/bread/bread-icon.jpg' };
        const resIconImage = { setHeader: jest.fn() };
        corsMiddleware(reqIconImage, resIconImage, () => {});
        expect(resIconImage.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    });

    test('CORS for images in images folder', () => {
        require('../server.js');
        const corsMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cross-Origin-Resource-Policy'))[0];
        const reqImageFromFolder = { path: `/${utils.IMAGE_ASSETS_FOLDER}/bread.jpg`, url: `/${utils.IMAGE_ASSETS_FOLDER}/bread.jpg` };
        const resImageFromFolder = { setHeader: jest.fn() };
        corsMiddleware(reqImageFromFolder, resImageFromFolder, () => {});
        expect(resImageFromFolder.setHeader).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    });

    test('no CORS for other images', () => {
        require('../server.js');
        const corsMiddleware = express.getInternalMiddlewares().filter((m) => typeof m === 'function' && m.toString().includes('Cross-Origin-Resource-Policy'))[0];
        const reqOtherImage = { path: '/folder/bread.jpg', url: '/folder/bread.jpg' };
        const resOtherImage = { setHeader: jest.fn() };
        corsMiddleware(reqOtherImage, resOtherImage, () => {});
        expect(resOtherImage.setHeader).not.toHaveBeenCalled();
    });
});

describe('graceful shutdown=', () => {
    let capturedListeners = {};
    let mockExit;

    beforeEach(() => {
        jest.spyOn(process, 'on').mockImplementation((signal, cb) => {
            capturedListeners[signal] = cb;
        });
        // Mock process.exit so the test runner doesn't die
        mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
        jest.useFakeTimers();
        // Trigger the process.on calls
        require('../server.js');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    test('SIGTERM and SIGINT listener should graceful shutdown', () => {
        expect(capturedListeners['SIGTERM']).toBeDefined();
        capturedListeners['SIGTERM']();

        expect(capturedListeners['SIGINT']).toBeDefined();
        capturedListeners['SIGINT']();

        expect(mockExit).toHaveBeenNthCalledWith(1, 0);
        expect(mockExit).toHaveBeenNthCalledWith(2, 0);
    });

    test('SIGTERM and SIGINT listener should force exit 1 after timeout', () => {
        expect(capturedListeners['SIGTERM']).toBeDefined();
        capturedListeners['SIGTERM']();
        jest.advanceTimersByTime(3000);
        expect(mockExit).toHaveBeenCalledWith(1);

        mockExit.mockClear();
        expect(capturedListeners['SIGINT']).toBeDefined();
        capturedListeners['SIGINT']();
        jest.advanceTimersByTime(3000);
        expect(mockExit).toHaveBeenCalledWith(1);
    });
});
