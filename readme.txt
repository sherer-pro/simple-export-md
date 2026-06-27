=== Simple Export to Markdown ===
Contributors: skreep
Tags: markdown, export, clipboard, content, editor
Requires at least: 6.0
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 0.1.3
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds a Gutenberg editor panel to export post or page content to Markdown format.

== Description ==

**Simple Export to Markdown** adds a small panel inside the WordPress block editor. With one click, editors can download the current post or page as a `.md` file or copy the generated Markdown to the clipboard.

The plugin uses the bundled Turndown library to convert serialized Gutenberg blocks in the browser. It does not create server-side export files, make external API calls, add REST/AJAX endpoints, or store exported content.

== Features ==

* Export Gutenberg content directly to Markdown.
* Download `.md` files or copy Markdown to the clipboard.
* Auto-generated YAML front matter for `title`, `slug`, `date`, `categories`, and `tags`.
* Uses the edited post state, including unsaved title, slug, date, category, tag, and block changes.
* Loads only in the block editor for users with `edit_posts`.
* JavaScript translations are loaded with `wp_set_script_translations()`.

== Requirements ==

* WordPress 7.0 or newer.
* PHP 7.4 or newer.
* Active Gutenberg/block editor.

== Installation ==

1. Upload the plugin folder to `/wp-content/plugins/`, or install it through the WordPress Plugins screen.
2. Activate the plugin through the "Plugins" menu in WordPress.
3. Open any post or page in the block editor.
4. Find the **Export to Markdown** panel in the editor sidebar.
5. Click **Download .md** or **Copy Markdown**.

== Frequently Asked Questions ==

= Does this work in the Classic Editor? =

No. The plugin is designed for the WordPress block editor.

= Does it save files on the server? =

No. Conversion, download, and clipboard copy happen locally in the browser.

= Can it export custom blocks? =

Custom blocks are serialized by WordPress before Turndown converts the resulting HTML to Markdown.

= Why are the JavaScript translation files named with the script handle? =

The files use the `simple-export-md-{locale}-simple-export-md.json` pattern so translations work for both the source and minified editor scripts.

= How should release builds be verified? =

Run `npm ci`, `npm run build`, `npm test`, `npm audit --audit-level=low`, and `php -l simple-export-md.php`. The minified editor script should only be committed as the Terser output from `npm run build`.

== Screenshots ==

1. Gutenberg editor with the **Export to Markdown** panel in the right sidebar.
2. Example Markdown file with generated YAML front matter.

== Changelog ==

= 0.1.3 =
* Hardened editor asset loading.
* Fixed JavaScript translation file names.
* Improved Markdown export reliability and filename sanitization.

== License ==

This plugin is open-source software licensed under the GPLv2 or later.
