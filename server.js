const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const srcUtils = require('./src/utils.js');
const utils = require('./lib/utils.js');

const port = process.env.PORT || 3000;
const app = express();
srcUtils.validateConfigurations();
app.set('trust proxy', true);

app.use(
    helmet({
        strictTransportSecurity: false, // handled by reverse proxy
    }),
);

if (srcUtils.isFeatureEnabled('enableVisitCounter')) {
    const visitCounter = require('./lib/visitCounter.js');
    app.use(express.json({ limit: '1kb' }));
    app.use(visitCounter.visitCounterMiddleware);
    visitCounter.startAutoSave();
}

// Rewrite canonical post paths
// When "/recipes/bread" serve "/recipes/bread/bread.html"
app.use((req, res, next) => {
    const { isPost, isCanonicalPostPath, matchedPostType, postName } = utils.parseRequest(req.path);
    if (isPost && isCanonicalPostPath) {
        const newPath = `/${matchedPostType}/${postName}/${postName}`;
        const queryString = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        req.url = newPath + queryString;
    }
    next();
});

// Set cache control
app.use((req, res, next) => {
    const path = req.path;
    // Cache images, assets and search index for 1 year - they use content hash filenames for cache busting
    const isImage = srcUtils.ALLOWED_IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext)) || path.endsWith('.ico');
    const isStaticAsset = path.endsWith('.js') || path.endsWith('.css');
    const [searchIndexBase, searchIndexExt] = srcUtils.SEARCH_DATA_FILENAME.split('.');
    const isSearchIndex = path.startsWith(`/${searchIndexBase}`) && path.endsWith(searchIndexExt);

    if (isImage || isStaticAsset || isSearchIndex) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
        // All other content such as html pages must be re-validated
        res.setHeader('Cache-Control', 'no-cache');
    }

    next();
});

// Allow cross origin request to image files for link preview tools
// Image files are from the images folder (for favicon and other images) and each post's icon image
app.use((req, res, next) => {
    const path = req.path;
    const isImage = srcUtils.ALLOWED_IMAGE_EXTENSIONS.some((ext) => path.endsWith(ext)) || path.endsWith('.ico');
    if (isImage) {
        const isIconImage = path.includes('-icon');
        const isImageFolder = path.startsWith(`/${srcUtils.IMAGE_ASSETS_FOLDER}`);
        if (isIconImage || isImageFolder) {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        }
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const server = app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});

const gracefulShutdown = (signal) => {
    setTimeout(() => {
        console.error('Forcing shutdown due to timeout.');
        process.exit(1);
    }, 3000);

    server.close((err) => {
        if (err) {
            console.error('Error during shutdown, forcing shutdown: ' + err);
            process.exit(1);
        }
        console.log('Server closed gracefully.');
        process.exit(0);
    });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
