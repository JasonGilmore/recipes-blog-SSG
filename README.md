# Recipe Blog Static Site Generator

A small static site generator for publishing recipe and food blogs. Write content in Markdown and publish a static HTML site. Designed to run behind a reverse proxy.

## Features

- Convert Markdown posts with front-matter into HTML pages.
- Configurable site structure and navigation via `src/config.json` (overrides [`src/config.default.json`](src/config.default.json)).
- Generate homepage, top-level pages (including with pagination) and post pages using simple templating (see [`src/templates/`](src/templates)).
- Generate content hash filenames for images and site assets, for reliable cache busting.
- Copy and sanitise image assets (with Exif removal).
- Client-side search.
- Simple visit counting.

## Quick start

1. Install dependencies:

    ```sh
    npm install
    ```

2. Build the static site:

    ```sh
    npm run build
    ```

3. Serve the site:
    ```sh
    npm run serve
    ```
    Or run `npm start` to build then serve.

## Configuration

The site generator reads default settings from [`src/config.default.json`](src/config.default.json). To customise content and output directories, post types (which controls top-level pages) and feature toggles, create `src/config.json` which will override the defaults.

Create a siteContent.json file within the [`src/templates/`](src/templates/) directory for key site information including a reference to the homepage image. Place the homepage image and a favicon into the [`src/templates/images/`](src/templates/images/) directory. siteContent.json supports the following fields:

- **siteName**: the site name.
- **mainIntroduction**: the main introduction text, used on the homepage.
- **secondaryIntroduction**: the secondary introduction text, used on the homepage after the main introduction.
- **recentPostsMessage**: optional, the recent post text to display on the homepage.
- **theme**: an object containing design tokens to apply CSS compatible colour values (RGB, Hex etc.). Supported keys include accent-colour, accent-colour-dark, recipe-box-background, light-box-background, dark-box-background.
- **siteUrl**: the site url.
- **siteIcon**: optional, a small icon to display in the site header.
- **heroImage**: the name of the main image in the [`src/templates/images/`](src/templates/images/) directory, used for the homepage hero image.
- **heroImageSmall**: the name of a smaller sized version of the hero image (<300KB) in the [`src/templates/images/`](src/templates/images/) directory, used for og image previews to conform to image size limits.
- **heroImageAlt**: alt text for the hero images.
- **[post type name]Image (such as recipesImage)**: optional, the name of an image in the [`src/templates/images/`](src/templates/images/) directory, to display as a small icon below the top-level page heading.
- **[post type name]Description (such as recipesDescription)**: optional, descriptive text to display at the top of the top-level page as well as head markup.
- **maxPostsPerPage**: the maximum number of posts per top level page before pagination.
- **searchPlaceholders**: optional, an array of placeholder texts to use in site search input.

Optionally add a robots.txt in the [`src/templates/static`](src/templates/static) directory.

## Content structure

- The content root is the folder configured by `contentDirectory` in the configuration.
- Each post type (e.g. `recipes`, `blogs`) should contain a post folder for each post. Each post folder contains a Markdown file (post) and optional assets (images).
- Footer content lives in the `footers` directory. Each footer is a single Markdown file and is automatically included in the footer on the site.

Example folder structure:

```
content/
  recipes/
    fruit-tart/
      fruit-tart.md
      tart.jpg
    chocolate-cake/
      chocolate-cake.md
      cake.jpg
      cake-closeup.jpg
  blogs/
    sourdough-starter-101/
      sourdough-starter-101.md
  footers/
    about.md
    disclaimer.md
```

## Front-matter

Front-matter is used to define metadata for site generation and structured data markup generation.

Front-matter for posts:

- **title**: the name of the post for display on site cards and og link previews.
- **description**: the description of the post for display on site cards and og link previews.
- **keywords**: comma separated keywords related to the post.
- **date**: the date in ISO format for recent post sorting.
- **image**: the image of the post for display on site cards and og link previews.
    - Ensure the image is <300KB to conform to image size limits for link previews.

Front-matter for footers:

- **displayName**: the name in the site footer.
- **order**: the order it appears in the site footer.

## Templates & Assets

- Templates live in `src/templates/`.
- Static assets (CSS/JS) are copied to the public output by the assets handler.

## Posts

This project supports a few post-specific conveniences for writing recipes and food content.

### Relative images

- Use relative image paths in your Markdown (example: `![alt](./image.jpg 'Title')`).
- This supports local previewing while writing content.
- On build the generator copies those images into the output directory and rewrites the image references in the generated HTML, so they point to the copied asset in the public site.

### Recipe and box layout blocks

- Wrap recipe-specific content in the recipe box layout block to produce a styled recipe block:
    - Start marker: `{recipeboxstart}`
    - End marker: `{recipeboxend}`
- Anything between these markers is rendered as a single recipe block.
  Example:

```markdown
{recipeboxstart}

## Ingredients

- 500 g flour
- 350 g water
- ...

### Method

1. Combine all ingredients.
2. ...

{recipeboxend}
```

Use `{notesboxstart} {notesboxend}` and `{extranotesboxstart} {extranotesboxend}` for additional styled layout blocks to group content.

### Tables

- Markdown tables are styled for improved readability. Write standard Markdown tables and the style will be applied automatically.

Example:

```markdown
| Ingredient | Amount |
| ---------- | ------ |
| Flour      | 500 g  |
| Water      | 350 g  |
```

### Additional Features

- **Jump to recipe**: Add a jump to recipe button with `{jumptorecipebox}` anywhere in the content. This will generate a button that, when clicked, scrolls the page to the start of the first recipe box.
- **Print recipe**: Add a print button with `{printrecipebox}` anywhere in the content. When clicked this will open the post in a new tab displaying the site icon, name, post url, `{recipeboxstart}` and `{notesboxstart}` only, and allows changing the font size before printing.
- **Ingredient checkboxes**: Add checkboxes for ingredients using markdown task list syntax `- [ ]`. These will be styled and will cross out the text when checked.

## Search

This generator includes a high-performance client-side search powered by Lunr.js.

- Search index is created during build with filename content hashing, and only fetched upon user interaction.
- Can be toggled on/off via site configuration.
- Features debounced search execution and automatic highlighting for better readability.
- Search hits and top search term tracking via visit counter.

## Visit Counter

This generator includes an optional visit counter to track site visits.

- Visit counting is enabled by default but can be customised via the `enableVisitCounter` property in the configuration. Simple numeric data is stored, persisted in `data/visitCounts.json` for 7 days and then archived in `data/visitCounts-archive.jsonl`.
- totalPostHits are incremented indefinitely, and visit stats are captured daily.
- To prevent internal testing inflating visit counting, counting is bypassed if the url search string contains the parameter `test=true`.
- For counting hits a simple client-side JavaScript tracking is used. For counting unique visitors, hashed ip address and user agent are counted and reset each day. If you require stricter privacy, disable this feature.
- Example:

```json
{
    "totalPostHits": {
        "recipes": {
            "fruit-tart": 15,
            "sourdough": 20
        },
        "blogs": {
            "howto-pie-crust": 10,
            "howot-layer-cakes": 5
        }
    },
    "2026-08-08": {
        "uniqueAppHits": 20,
        "uniquePostHits": 15,
        "homepageHits": 25,
        "postHits": 35,
        "searchHits": 1,
        "topSearches": {
            "pie": 1
        },
        "printHits": 1,
        "topPrints": {
            "fruit-tart": 1
        }
    }
}
```
