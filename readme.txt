=== Simple Export to Markdown ===
Contributors: skreep
Tags: markdown, export, clipboard, content, editor
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.2
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds a Gutenberg editor panel to export any post or page content to Markdown format (.md file or clipboard).

== Description ==

**Simple Export to Markdown** adds a small, useful panel inside the WordPress block editor.
With a single click, you can export the current post or page to Markdown — either download a `.md` file or copy it directly to the clipboard.

The plugin uses the [Turndown](https://github.com/mixmark-io/turndown) library to accurately convert Gutenberg blocks into Markdown syntax, preserving headings, paragraphs, images, lists, quotes, and other standard content.

== Features ==

* Export any Gutenberg post or page directly to Markdown.
* Two modes: **Download .md** or **Copy to Clipboard**.
* Auto-generated YAML front matter (`title`, `slug`, `date`, `categories`, `tags`).
* Works natively inside the block editor — no admin pages or complex settings.
* Lightweight (under 14 KB of JS), no tracking, no external API calls.

== Requirements ==

* WordPress 6.0 or newer.
* PHP 7.4 or newer.
* Active Gutenberg (block) editor.

== Installation ==

1. Upload the plugin folder to your `/wp-content/plugins/` directory, or install the plugin directly via the WordPress Plugins screen.
2. Activate the plugin through the “Plugins” menu in WordPress.
3. Open any post or page in the Gutenberg editor — you’ll see a new sidebar panel named **Export to Markdown**.
4. Click **Download .md** to save a Markdown file, or **Copy Markdown** to copy the generated text into your clipboard.

== Frequently Asked Questions ==

= Where can I find the export button? =
In the Gutenberg editor sidebar (click the Settings icon if the sidebar is hidden), under a panel titled “Export to Markdown”.

= Does this work in the Classic Editor? =
No. The plugin only works in the modern block (Gutenberg) editor.

= Can I export custom blocks? =
Yes. Custom blocks will be serialized as HTML before Markdown conversion. Standard HTML will appear correctly in your Markdown output.

= Does it save files on the server? =
No. All conversion and download happen locally in your browser for security and privacy.

== Screenshots ==

1. Gutenberg editor with the **Export to Markdown** panel in the right sidebar.
2. Example Markdown file with generated YAML front matter.

== License ==

This plugin is open-source software licensed under the GPLv2 (or later).
© 2025 [Pavel Sherer](https://sherer.pro)
