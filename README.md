# Simple Export to Markdown

Simple Export to Markdown adds an **Export to Markdown** panel to the WordPress block editor. It can download the current post or page as a `.md` file or copy the generated Markdown to the clipboard.

Conversion runs entirely in the browser with the vendored Turndown library. The plugin does not create server-side export files, make external API calls, add REST/AJAX endpoints, or store exported content.

## Features

- Export Gutenberg content to Markdown from the editor sidebar.
- Download `.md` files or copy Markdown to the clipboard.
- Generate YAML front matter for `title`, `slug`, `date`, `categories`, and `tags`.
- Use the edited post state, including unsaved title, slug, date, category, tag, and block changes.
- Load only in the block editor for users with `edit_posts`.
- Support PHP and JavaScript translations.

## Requirements

- WordPress 6.0 or newer.
- PHP 7.4 or newer.
- The WordPress block editor.

## Installation

1. Copy this plugin directory into `wp-content/plugins/`.
2. Activate **Simple Export to Markdown** in the WordPress admin.
3. Open a post or page in the block editor.
4. Use the **Export to Markdown** panel in the editor sidebar.

## Project Structure

```text
simple-export-md/
  simple-export-md.php
  assets/
    export-md.css
    export-md.js
    export-md.min.js
    turndown.js
    turndown.min.js
  languages/
    simple-export-md.pot
    simple-export-md-{locale}.po
    simple-export-md-{locale}.mo
    simple-export-md-{locale}-simple-export-md.json
  THIRD-PARTY-NOTICES.md
```

## Build And Checks

Install development dependencies before rebuilding generated assets:

```bash
npm ci
```

Available scripts:

```bash
npm run build
npm run check:js
npm run smoke:js
npm run audit
npm test
```

`assets/export-md.min.js` is generated from `assets/export-md.js` with Terser. Edit the source file, then run `npm run build`.

## Release Checklist

Run these checks before tagging or publishing a release:

```bash
npm ci
npm run build
npm test
npm audit --audit-level=low
php -l simple-export-md.php
```

`assets/export-md.min.js` must be committed only as the Terser output from `npm run build`.
Translation updates should be regenerated with WP-CLI (`wp i18n make-pot`, `wp i18n update-po`, and `wp i18n make-mo`) so the PHP `.mo` files and JavaScript JSON files stay in sync.

## Compatibility Smoke Targets

- WordPress 6.0 with PHP 7.4 verifies the minimum supported runtime.
- WordPress 7.0 with PHP 7.4 or newer verifies the current tested editor runtime.
- The WordPress Playground blueprint uses the current tested WordPress target.

## Localization

The plugin text domain is `simple-export-md`. PHP translations load from `/languages` with `load_plugin_textdomain()`.

JavaScript translation JSON files use handle-based names:

```text
simple-export-md-{locale}-simple-export-md.json
```

That keeps translations working whether WordPress loads `assets/export-md.js` with `SCRIPT_DEBUG` or `assets/export-md.min.js` in production.

## Security Notes

The export action is client-side only. The plugin does not accept uploaded files, write exports on the server, run SQL queries, or expose custom REST/AJAX handlers.

The block editor assets are enqueued only in admin editor context and only for users who can `edit_posts`.

## Third-Party Code

Turndown is vendored in `assets/turndown.js` and `assets/turndown.min.js`. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

GPL-2.0-or-later.
