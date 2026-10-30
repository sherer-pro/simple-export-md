# Simple Export to Markdown

Simple Export to Markdown adds an **Export to Markdown** panel to the WordPress block editor. It can download the current post or page as a `.md` file or copy the generated Markdown to the clipboard.

Conversion runs entirely in the browser with the vendored Turndown library. The plugin does not create server-side export files, make external API calls, add REST/AJAX endpoints, or store exported content.

## Features

- Export Gutenberg content to Markdown from the editor sidebar.
- Let independent plugins and themes provide opt-in export formats for their blocks and custom HTML.
- Download `.md` files or copy Markdown to the clipboard.
- Generate YAML front matter for `title`, `slug`, `date`, `categories`, and `tags`.
- Use the edited post state, including unsaved title, slug, date, category, tag, and block changes.
- Export page content independently of its surrounding template, including unsaved edits in the template-based editor.
- Preserve preformatted whitespace and export audio/video sources as Markdown links.
- Load only in the block editor for users with `edit_posts`.
- Support PHP and JavaScript translations.
- Export simple tables as GFM, retaining all data rows even without a header. Tables with merged cells, nested tables, captions, or code blocks remain sanitized HTML.
- Warn in the panel when saved block markup has no exportable content, including synced pattern references. The export continues without adding warning text to Markdown.
- Load all selected categories and tags in batches. Failed or incomplete metadata loading blocks export and provides a retry button.

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
  docs/
    extensions.md
```

## Build And Checks

Install development dependencies before rebuilding generated assets:

```bash
npm ci
npx playwright install chromium
```

Available scripts:

```bash
npm run build
npm run check:js
npm run smoke:js
npm run smoke:browser
npm run smoke:php
npm run audit
npm test
```

`assets/export-md.min.js` is generated from `assets/export-md.js` with Terser. Edit the source file, then run `npm run build`.

Development checks require Node.js 20 or newer and PHP on `PATH`. Browser checks use Playwright Chromium, an installed Chrome/Edge on Windows, or the executable specified by `PLAYWRIGHT_EXECUTABLE_PATH`. They run against both source and minified scripts in an isolated DOM with WordPress API stubs; they do not replace the WordPress compatibility smoke below.

Run development commands from the Git checkout. The WordPress.org runtime package excludes npm manifests and development scripts.

`npm test` checks metadata batching, errors and retries, GFM/HTML tables, omitted blocks, clipboard failures, repeated notices, download cleanup, safe filenames, and PHP asset loading. For an already prepared disposable WordPress fixture, run `node scripts/wordpress-export-md.js http://127.0.0.1:PORT`.

On Windows with Docker Desktop, run `powershell -NoProfile -File scripts/wordpress-smoke.ps1` for disposable WordPress 6.0/PHP 7.4 and WordPress 7.0/PHP 8.3 fixtures, with both source and minified assets. The runner requires the corresponding official WordPress images and `mariadb:11.8`, binds HTTP only to localhost, and removes only its own containers, volumes and networks.

## Extension API

Themes and plugins can register export adapters with the JavaScript filter `simple_export_md.exporters`. Each applicable adapter adds a format selector to the panel. **Standard export** is always the initial selection; additional formats require an explicit choice in the current editor session.

Adapters can replace their Gutenberg blocks or matching HTML subtrees with HTML, static inline SVG, or an image URL. Callbacks may return a Promise. Conversion remains in the browser; adapters are responsible for obtaining their own data and for any requests they make. The exporter adds no server endpoints and has no dependency on a particular theme or plugin.

See [the extension contract and examples](docs/extensions.md) for registration, callback results, load order, timeout handling and the supported SVG profile. SVG is embedded in the Markdown file; its display depends on the Markdown viewer.

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
- WordPress 7.1.4 on the local acceptance site verifies the template-based page editor and current Custom HTML serialization.
- The WordPress Playground blueprint uses the WordPress 7.1 release family.

## Localization

The plugin text domain is `simple-export-md`. PHP translations load from `/languages` with `load_plugin_textdomain()`.

JavaScript translation JSON files use handle-based names:

```text
simple-export-md-{locale}-simple-export-md.json
```

That keeps translations working whether WordPress loads `assets/export-md.js` with `SCRIPT_DEBUG` or `assets/export-md.min.js` in production.

## Export Limitations

Standard conversion uses saved HTML from the current editor blocks. It does not execute server rendering callbacks or expand synced pattern references. Optional adapters may supply representations for otherwise omitted blocks. Omitted blocks are listed in a persistent, dismissible panel warning, which is shown again on the next export. Warning text is never inserted into the file or clipboard content.

Errors remain visible until dismissed. Successful copy/download notices expire and restart for each action. Downloads use the edited slug, with a post-ID fallback and Windows device-name protection.

Script and style contents are excluded. HTML table fallbacks retain structure and safe formatting while removing executable elements, event handlers, inline styles and unsafe link/image schemes. Custom blocks can lose interactive behavior during Markdown conversion.

## Security Notes

The export action is client-side only. The plugin does not accept uploaded files, write exports on the server, run SQL queries, or expose custom REST/AJAX handlers.

The block editor assets are enqueued only in admin editor context and only for users who can `edit_posts`.

## Third-Party Code

Turndown is vendored in `assets/turndown.js` and `assets/turndown.min.js`. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

GPL-2.0-or-later.
