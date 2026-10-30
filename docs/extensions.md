# Export extension API

The JavaScript filter `simple_export_md.exporters` lets an independent plugin or theme supply export representations for its Gutenberg blocks and custom HTML. The exporter does not register theme-specific adapters or execute PHP render callbacks.

## Registration and load order

Enqueue your adapter on `enqueue_block_editor_assets`, with `wp-hooks` as a dependency. Add `wp-blocks` if the adapter also uses block APIs. The adapter does not need a dependency on `simple-export-md`: registration before or after the export panel loads is supported, and the filter is harmless when the exporter is inactive. Only load your code in the editor contexts your integration needs.

```php
add_action( 'enqueue_block_editor_assets', function () {
    wp_enqueue_script(
        'example-markdown-adapter',
        plugins_url( 'markdown-adapter.js', __FILE__ ),
        array( 'wp-hooks' ),
        '1.0.0',
        true
    );
} );
```

Register a namespaced filter callback and append your descriptor without discarding other registrations:

```js
wp.hooks.addFilter('simple_export_md.exporters', 'example/diagram-export', (exporters) => [
    ...exporters,
    {
        id: 'example/diagram',
        label: 'Example diagrams',
        blockNames: ['example/diagram'],
        formats: [
            { value: 'svg', label: 'Inline SVG' },
            { value: 'image', label: 'Image URL' },
        ],
        async exportBlock(block, { format, post, signal }) {
            // Integration-owned code: obtain data for these unsaved block attributes.
            // Forward signal to fetch(), if used. Do not modify the post or create resources.
            const data = await getDiagramExportData(block.attributes, post.id, signal);
            if (!data) return null;
            return format === 'svg'
                ? { type: 'svg', content: data.svg }
                : { type: 'image', url: data.imageUrl, alt: block.attributes.alt || '' };
        },
    },
]);
```

`getDiagramExportData` is a placeholder for your integration's own implementation. The export plugin does not provide a diagram renderer or a data endpoint.

The descriptor contract:

| Field | Contract |
| --- | --- |
| `id` | Unique nonempty string containing lowercase letters, digits, `.`, `_`, `-` or `/`, starting with a letter or digit. Use a vendor/plugin namespace. |
| `label` | Nonempty plain-text label for the panel's selector. Translate it in your own text domain. |
| `formats` | Nonempty array of `{ value, label }`. Both fields are nonempty strings; values must be unique within the descriptor. The empty string is reserved for Standard export. |
| `blockNames` / `exportBlock` | Optional array of block names and its callback. A nonempty array requires a function. |
| `selector` / `exportHtml` | Optional valid CSS selector and its callback. A nonempty selector requires a function. |

At least one target must be declared. A descriptor can declare both kinds. Invalid descriptors and later duplicate IDs are ignored, with a console diagnostic containing only the entry index. A failed registry filter is ignored with a diagnostic; its exception details are not displayed.

Selectors are shown only when their block names or HTML targets occur in the current content. Standard export is initially selected. Choices are kept in memory for the current editor session and reset when the post changes; they are not written to the post, user options or browser storage.

## Custom HTML example

The callback receives a detached copy of the matching element. Replacing a parent also replaces its descendants. Return `null` to let later adapters or standard conversion handle it.

```js
wp.hooks.addFilter('simple_export_md.exporters', 'example/card-export', (exporters) => [
    ...exporters,
    {
        id: 'example/cards',
        label: 'Example cards',
        selector: '.example-card',
        formats: [{ value: 'text', label: 'Text' }],
        exportHtml(element) {
            const title = element.querySelector('.example-card-title');
            if (!title) return null;
            const paragraph = document.createElement('p');
            paragraph.textContent = title.textContent;
            return { type: 'html', content: paragraph.outerHTML };
        },
    },
]);
```

## Callbacks, results and errors

Both callbacks receive `(input, { format, post, signal })`. `input` is a copied block object or detached HTML element. `post` is a separate copy of the edited `id`, `title`, `slug`, `date`, `categories` and `tags` values; selected taxonomy values are IDs. `signal` is an `AbortSignal`. Metadata and blocks are captured when the export action starts, including unsaved edits.

Callbacks must be read-only and may return their result directly or through a Promise. They run only when the user exports with a selected custom format, never to determine panel visibility. Each invocation has a 30-second deadline. Forward `signal` to asynchronous work; timeout aborts the signal, discards late results and restores the export controls. JavaScript that blocks the browser's main thread cannot be interrupted by this deadline.

| Result | Export representation |
| --- | --- |
| `null` | Try the next selected matching adapter, then use standard export. `undefined` is an invalid result. |
| `{ type: 'html', content: string }` | Nonempty HTML converted by Turndown. Executable elements, SVG/MathML, styles, event attributes and unsafe link/image schemes are removed. If no Markdown content remains, export fails. |
| `{ type: 'svg', content: string }` | Valid standalone static SVG preserved as inline HTML in the Markdown. |
| `{ type: 'image', url: string, alt: string, title?: string }` | Markdown image with escaped text and an absolute HTTP(S) URL. Relative, data, blob and credential-bearing URLs are rejected. |

SVG and image are result types, not reserved format names. Your formats may use any nonempty unique values. Multiple diagrams can be supplied by separate blocks; an HTML result may contain multiple ordinary images.

Only selected adapters participate. Registry array order determines precedence; normal WordPress filter priorities control how that array is built. The first non-null result wins. Block replacements own their complete subtree; descendants are not called separately. Other blocks retain their nesting and order. HTML matching follows block preparation, from parent to child, and does not process replacement output again.

A callback rejection, malformed result, unsupported SVG or timeout stops the entire export. No partial file or clipboard content is produced. Errors identify the adapter, without exposing callback exception details. The user can retry or choose Standard export. A `null` result uses the existing omission-warning behavior if the original content cannot be exported. Before export, selected block adapters are treated as candidates for handling their blocks; after export, warnings reflect the actual fallback results. Warning text is never included in Markdown.

## Static SVG profile

SVG must have the `http://www.w3.org/2000/svg` namespace and parse as XML. The profile allows static geometry, groups, text, definitions, symbols, gradients, patterns, clipping, masks and markers. Supported tags are:

```text
svg g defs symbol use title desc path rect circle ellipse line polyline polygon
text tspan textPath clipPath mask marker linearGradient radialGradient stop pattern
```

Geometry and presentation use explicit attributes such as `viewBox`, `width`, `height`, `d`, `transform`, `fill`, `stroke`, `font-size` and `text-anchor`. The exact attribute allowlist is defined in `sanitizeSvg()` in `assets/export-md.js`.

Scripts, event attributes, CSS (`style` elements and attributes), animation, `foreignObject`, embedded images, external references, XML processing instructions, DTDs and entities are unsupported. References must point to existing local IDs, with no cycles. Exported IDs and their references receive a deterministic fragment prefix so that repeated diagrams remain independent. Unsupported content is rejected rather than silently removing diagram labels or shapes. This includes SVG produced by diagram tools that use HTML labels inside `foreignObject`: the adapter must provide a compatible static SVG or offer the image URL alternative. There is no automatic rasterization or fallback to a different selected format.

SVG is embedded in the same `.md` content for copy and download. Markdown viewers differ in their support for inline SVG; some remove it. No separate SVG files, ZIP archives, uploads or persistent exported resources are created by this plugin.
