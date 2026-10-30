const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
    const candidates = [process.env.PLAYWRIGHT_EXECUTABLE_PATH, chromium.executablePath()];
    if (process.platform === 'win32') candidates.push(
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    );
    const executablePath = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    if (!executablePath) throw new Error('Install Chromium with npx playwright install chromium, or set PLAYWRIGHT_EXECUTABLE_PATH.');
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        for (const variant of ['export-md.js', 'export-md.min.js']) {
            const page = await browser.newPage();
            const unexpectedRequests = [];
            await page.route('**/*', (route) => { unexpectedRequests.push(route.request().url()); return route.abort(); });
            await page.addScriptTag({ content: fs.readFileSync(path.join('assets', 'turndown.js'), 'utf8') });
            const checks = await page.evaluate(async (source) => {
                let count = 0;
                function check(condition, message) {
                    count++;
                    if (!condition) throw new Error(message);
                }
                let panel, cursor = 0, state = [], effectCursor = 0, effects = [], copied = '';
                let clipboardError = false, termError = false, termLoading = false;
                let categoryIds = [], postBlocks, blocks = [{ name: 'core/paragraph', html: '<p>Unsaved body</p>' }];
                const timers = new Map();
                let nextTimer = 0;
                window.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
                window.clearTimeout = (id) => timers.delete(id);
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => {
                    if (clipboardError) throw new Error('Clipboard rejected');
                    copied = text;
                } } });
                let htmlUsesInnerContent = false;
                const serialize = (items) => items.map((block) => block.name === 'core/html' ?
                    (htmlUsesInnerContent ? (block.innerContent || []).join('') : block.attributes.content) :
                    block.html ?? '<' + (block.tag || 'div') + '>' + serialize(block.innerBlocks || []) + '</' + (block.tag || 'div') + '>').join('');
                const hooks = new Map();
                const addHook = (name, namespace, callback) => {
                    if (!hooks.has(name)) hooks.set(name, new Map());
                    hooks.get(name).set(namespace, callback);
                };
                const doAction = (name, ...args) => [...(hooks.get(name)?.values() || [])].forEach((callback) => callback(...args));
                window.SIMPLE_EXPORT_MD_TESTS = true;
                window.wp = {
                    plugins: { registerPlugin: (name, plugin) => { panel = plugin.render; } },
                    editPost: { PluginDocumentSettingPanel: 'panel' },
                    editor: { PluginDocumentSettingPanel: 'panel' },
                    components: { Button: 'button', Notice: 'notice', SelectControl: 'select' },
                    hooks: {
                        addAction: addHook,
                        removeAction: (name, namespace) => hooks.get(name)?.delete(namespace),
                        addFilter: (name, namespace, callback) => { addHook(name, namespace, callback); doAction('hookAdded', name); },
                        removeFilter: (name, namespace) => { hooks.get(name)?.delete(namespace); doAction('hookRemoved', name); },
                        applyFilters: (name, value) => [...(hooks.get(name)?.values() || [])].reduce((result, callback) => callback(result), value),
                    },
                    i18n: { __: (text) => text },
                    blocks: { serialize, getBlockType: (name) => ({ title: name }), createBlock: (name, attributes, innerBlocks = [], innerContent) => ({ name, attributes, innerBlocks, innerContent }) },
                    data: {
                        dispatch: () => ({ invalidateResolution: () => { termError = false; } }),
                        useSelect: (callback) => callback((store) => {
                            if (store === 'core/editor') return {
                                getCurrentPost: () => ({ id: 42 }), getCurrentPostId: () => 42,
                                getEditedPostAttribute: (key) => ({ title: 'Unsaved "title"\nnext', slug: 'new-slug', date: '2026-10-08T12:00:00', categories: categoryIds, tags: [], blocks: postBlocks })[key],
                            };
                            if (store === 'core/block-editor') return { getBlocks: () => blocks };
                            return {
                                getEntityRecords: (kind, taxonomy, query) => termError || termLoading ? null : query.include.map((id) => ({ id, name: 'term-' + id })),
                                hasFinishedResolution: () => !termLoading,
                                getResolutionError: () => termError ? new Error('REST failed') : null,
                            };
                        }),
                    },
                    element: {
                        createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
                        useState: (initial) => {
                            const index = cursor++;
                            if (!(index in state)) state[index] = initial;
                            return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
                        },
                        useCallback: (callback) => callback, useMemo: (callback) => callback(),
                        useRef: (value) => {
                            const index = cursor++;
                            if (!(index in state)) state[index] = { current: value };
                            return state[index];
                        },
                        useEffect: (callback, deps) => {
                            const index = effectCursor++;
                            const effect = effects[index];
                            if (!effect || deps.some((dep, i) => dep !== effect.deps[i])) {
                                if (effect?.cleanup) effect.cleanup();
                                effects[index] = { deps, cleanup: callback() };
                            }
                        },
                    },
                };
                (0, eval)(source);
                const helpers = window.simpleExportMdInternals;
                const table = helpers.convertHtml('<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td><strong>A | B</strong></td><td><a href="https://example.org">Link</a><br>Next</td></tr></tbody></table>');
                check(table.includes('| Name | Value |\n| --- | --- |'), 'GFM header and separator');
                check(table.includes('**A \\| B**') && table.includes('[Link](https://example.org)<br>Next'), 'Cell formatting, pipes and breaks');
                const noHeader = helpers.convertHtml('<table><tr><td>First</td><td>10</td></tr><tr><td>Second</td><td>20</td></tr></table>');
                check(noHeader.startsWith('|  |  |\n| --- | --- |\n| First | 10 |'), 'Do not promote a data row to a header');
                for (const html of [
                    '<table><tr><td colspan="2">Wide</td></tr><tr><td>A</td><td>B</td></tr></table>',
                    '<table><caption>Caption</caption><tr><td>A</td></tr></table>',
                    '<table><tr><td><table><tr><td>Nested</td></tr></table></td></tr></table>',
                ]) check(helpers.convertHtml(html).includes('<table>'), 'Preserve complex table HTML');
                const safe = helpers.convertHtml('<table onclick="alert(1)"><tr><td colspan="2" style="color:red"><script>badScript()</script><style>badStyle</style><a href="java&#x0a;script:alert(1)" onclick="bad()">Unsafe</a><img src="data:text/html,bad" onerror="bad()"><a href="https://example.org">Safe</a></td></tr></table>');
                check(!/onclick|onerror|javascript|badScript|badStyle|data:text|style=/.test(safe), 'Sanitize active table content');
                check(safe.includes('colspan="2"') && safe.includes('href="https://example.org"'), 'Keep structure and safe links');
                const basic = helpers.convertHtml('<h2>Heading</h2><p><em>Em</em> <strong>Strong</strong></p><ul><li>One</li><li>Two</li></ul><blockquote><p>Quote</p></blockquote><pre><code>const a = 1;\n</code></pre><figure><img src="https://example.org/a.png" alt="Alt"><figcaption>Caption</figcaption></figure><script>hiddenScript</script><style>hiddenStyle</style>');
                check(basic.includes('## Heading') && basic.includes('_Em_ **Strong**'), 'Heading and inline formatting');
                check(basic.includes('*   One') && basic.includes('> Quote') && basic.includes('```\nconst a = 1;'), 'Lists, quotes and code');
                check(basic.includes('![Alt](https://example.org/a.png)') && basic.includes('Caption'), 'Image and caption');
                check(!basic.includes('hiddenScript') && !basic.includes('hiddenStyle'), 'Exclude script and style text');
                const preformatted = helpers.convertHtml('<pre class="wp-block-preformatted">QA preformatted\n  indentation\n```\n</pre>');
                check(preformatted === '````\nQA preformatted\n  indentation\n```\n````', 'Preformatted blocks preserve whitespace and embedded backtick fences');
                const media = helpers.convertHtml('<figure><audio src="https://example.org/audio.mp3"></audio><figcaption>Audio caption</figcaption></figure><video><source src="https://example.org/video(1).mp4"></video>');
                check(media.includes('[Audio](https://example.org/audio.mp3)') && media.includes('Audio caption') && media.includes('[Video](https://example.org/video%281%29.mp4)'), 'Audio and video blocks retain their source links and captions');
                check(!helpers.convertHtml('<audio src="javascript:alert(1)"></audio><video src="https://user:pass@example.org/v.mp4"></video>').includes(']('), 'Reject unsafe and credential-bearing media source links');
                const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
                const render = () => { cursor = 0; effectCursor = 0; return nodes(panel()); };
                const buttons = (tree) => tree.filter((node) => node.type === 'button');
                let tree = render();
                await buttons(tree)[1].props.onClick(); tree = render();
                check(copied.includes('title: "Unsaved \\"title\\"\\nnext"') && copied.includes('Unsaved body'), 'Export unsaved metadata and body');
                check(tree.some((node) => node.props.status === 'success'), 'Copy success notice');
                const firstNotice = state[1]; const firstTimer = nextTimer;
                await buttons(tree)[1].props.onClick(); render();
                check(state[1] !== firstNotice && nextTimer > firstTimer && timers.size === 1, 'Restart repeated success notifications');
                clipboardError = true;
                await buttons(render())[1].props.onClick(); tree = render();
                check(state[0] === false && tree.some((node) => node.props.status === 'error') && timers.size === 0, 'Persistent clipboard error restores controls');
                clipboardError = false;
                categoryIds = [1]; termError = true; tree = render();
                check(buttons(tree).slice(-2).every((node) => node.props.disabled), 'Block export after REST error');
                buttons(tree)[0].props.onClick(); tree = render();
                check(!buttons(tree).at(-1).props.disabled, 'Retry resolves metadata error');
                categoryIds = [2, 1];
                await buttons(render()).at(-1).props.onClick();
                check(copied.includes('categories: ["term-2", "term-1"]'), 'Updated term selection in original order');
                termLoading = true; tree = render();
                check(buttons(tree).every((node) => node.props.disabled), 'Disable while loading'); termLoading = false;
                blocks = [{ name: 'core/group', innerBlocks: [{ name: 'core/block', html: '<!-- wp:block {"ref":1} /-->' }, { name: 'core/latest-posts', html: '<!-- wp:latest-posts /-->' }, { name: 'core/paragraph', html: '<p>Kept</p>' }] }];
                tree = render();
                let warning = tree.find((node) => node.props.status === 'warning');
                check(Boolean(warning) && helpers.findOmittedBlocks(blocks).length === 2, 'Nested omitted blocks warning');
                check(helpers.findOmittedBlocks([{ name: 'custom/dynamic-container', html: '<!-- wp:custom/dynamic-container /-->', innerBlocks: [{ name: 'core/paragraph', html: '<p>Unserialized child</p>' }] }]).length === 1, 'Warn when a dynamic parent does not serialize its children');
                check(helpers.findOmittedBlocks([{ name: 'core/more', html: '<!--more-->' }, { name: 'core/nextpage', html: '<!--nextpage-->' }]).length === 0, 'Intentional pagination markers need no warning');
                await buttons(tree).at(-1).props.onClick(); tree = render();
                check(copied.includes('Kept') && !copied.includes('omitted') && !copied.includes('core/block'), 'No warning text added to Markdown');
                for (const timer of [...timers.values()]) if (timer.delay === 2400) timer.callback();
                tree = render(); check(tree.some((node) => node.props.status === 'warning'), 'Warning persists after success expires');
                warning = tree.find((node) => node.props.status === 'warning'); warning.props.onRemove();
                check(!render().some((node) => node.props.status === 'warning'), 'Warning can be dismissed');
                blocks = [{ name: 'core/paragraph', html: '<p>Complete</p>' }];
                check(!render().some((node) => node.props.status === 'warning'), 'Warning removed when content is complete');
                postBlocks = [{ name: 'core/paragraph', html: '<p>Actual unsaved page body</p>' }];
                blocks = [{ name: 'core/template-part', html: '<header>Template header</header>' }];
                await buttons(render()).at(-1).props.onClick();
                check(copied.includes('Actual unsaved page body') && !copied.includes('Template header'), 'Page exports use edited post blocks rather than the surrounding template');
                postBlocks = undefined;
                // Public extension contract: use the same entry point as an independently loaded plugin.
                const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="80" height="40" fill="url(#paint)"/><text x="2" y="20">Diagram</text></svg>';
                let blockCalls = 0, htmlCalls = 0, mode = 'normal', resolveSlow, seenSignal;
                const definition = {
                    id: 'example/diagram', label: 'Example diagrams',
                    formats: [{ value: 'svg', label: 'Inline SVG' }, { value: 'image', label: 'Image URL' }],
                    blockNames: ['example/diagram'], selector: '.example-diagram',
                    exportBlock: async (block, context) => {
                        blockCalls++;
                        seenSignal = context.signal;
                        check(context.post.id === 42 && !context.signal.aborted, 'Extension context and abort signal');
                        block.attributes.caption = 'Mutation isolated'; context.post.title = 'Mutation isolated';
                        if (mode === 'error') throw new Error('secret callback details');
                        if (mode === 'invalid') return { type: 'unknown' };
                        if (mode === 'null') return null;
                        if (mode === 'slow') await new Promise((resolve) => { resolveSlow = resolve; });
                        if (mode === 'timeout') return new Promise(() => {});
                        return context.format === 'svg' ? { type: 'svg', content: svg } : { type: 'image', url: 'https://example.org/diagram(1).png', alt: 'A [diagram]', title: 'A "title"' };
                    },
                    exportHtml: async (node) => {
                        htmlCalls++;
                        node.textContent = 'Mutated copy';
                        return { type: 'html', content: '<p><strong>Custom HTML</strong><script>secret()</script><a href="javascript:bad()">Safe text</a><img src="https://example.org/never-fetch.png" alt="Export only"></p>' };
                    },
                };
                wp.hooks.addFilter('simple_export_md.exporters', 'example/diagram', (entries) => [...entries, definition]);
                blocks = [{ name: 'core/quote', tag: 'blockquote', innerBlocks: [
                    { name: 'core/paragraph', html: '<p>Before</p>' },
                    { name: 'example/diagram', attributes: { caption: 'Original' }, html: '<!-- wp:example/diagram /-->' },
                    { name: 'core/paragraph', html: '<p>After</p>' },
                ] }];
                tree = render();
                let select = tree.find((node) => node.type === 'select');
                check(select?.props.value === '' && blockCalls === 0, 'Late registration shows opt-in controls without running callbacks');
                await buttons(tree).at(-1).props.onClick();
                check(blockCalls === 0 && !copied.includes('<svg'), 'Standard export is unchanged by registration');
                select.props.onChange('svg'); tree = render();
                const unchanged = JSON.stringify(blocks);
                await buttons(tree).at(-1).props.onClick(); tree = render();
                check(copied.includes('> <svg') && copied.includes('Diagram</text>') && copied.indexOf('Before') < copied.indexOf('<svg') && copied.indexOf('<svg') < copied.indexOf('After'), 'SVG survives conversion inside its parent and in document order');
                check(JSON.stringify(blocks) === unchanged && !copied.includes('Mutation isolated'), 'Extension mutations cannot change editor blocks or metadata');
                check(!tree.some((node) => node.props.status === 'warning'), 'Handled dynamic block has no omission warning');
                select = tree.find((node) => node.type === 'select'); select.props.onChange('image');
                await buttons(render()).at(-1).props.onClick();
                check(copied.includes('![A \\[diagram\\]](https://example.org/diagram%281%29.png "A \\"title\\"")'), 'Image output escapes Markdown text, URL parentheses and title quotes');
                const imageMarkdown = copied;
                let downloadedBlob;
                URL.createObjectURL = (blob) => { downloadedBlob = blob; return 'blob:extension'; };
                URL.revokeObjectURL = () => {};
                HTMLAnchorElement.prototype.click = () => {};
                await buttons(render()).at(-2).props.onClick();
                check(await downloadedBlob.text() === imageMarkdown, 'Extension download and clipboard contents are identical');
                mode = 'error';
                await buttons(render()).at(-1).props.onClick(); tree = render();
                check(tree.some((node) => node.props.status === 'error' && !node.props.children.includes('secret')) && !state[0], 'Callback errors stop export without leaking details and restore controls');
                mode = 'invalid'; await buttons(render()).at(-1).props.onClick();
                check(render().some((node) => node.props.status === 'error'), 'Reject malformed extension results');
                mode = 'null'; await buttons(render()).at(-1).props.onClick();
                check(render().some((node) => node.props.status === 'warning'), 'A null result falls back and restores actual omission warnings');
                mode = 'slow';
                const pending = buttons(render()).at(-1).props.onClick();
                for (let i = 0; i < 12 && !resolveSlow; i++) await Promise.resolve();
                check(Boolean(resolveSlow) && buttons(render()).every((node) => node.props.disabled), 'Disable controls while awaiting extension');
                const callsWhileBusy = blockCalls;
                await buttons(render()).at(-1).props.onClick();
                check(blockCalls === callsWhileBusy, 'Prevent overlapping exports');
                blocks = [{ name: 'core/paragraph', html: '<p>New editor state</p>' }];
                resolveSlow(); await pending;
                check(!copied.includes('New editor state') && copied.includes('Before'), 'Async export uses the snapshot from the click');
                blocks = [{ name: 'example/diagram', attributes: {}, html: '<!-- wp:example/diagram /-->' }];
                mode = 'timeout';
                const timed = buttons(render()).at(-1).props.onClick();
                for (let i = 0; i < 12; i++) await Promise.resolve();
                const deadline = [...timers.values()].find((timer) => timer.delay === 30000);
                check(Boolean(deadline), 'Install extension deadline'); deadline.callback(); await timed;
                check(seenSignal.aborted && !state[0] && render().some((node) => node.props.status === 'error'), 'Timeout aborts the handler and restores controls');
                mode = 'normal'; await buttons(render()).at(-1).props.onClick();
                check(render().some((node) => node.props.status === 'success'), 'Retry succeeds after timeout');
                let resolveClipboard, clipboardStarted = false;
                const originalClipboardItem = window.ClipboardItem;
                window.ClipboardItem = class { constructor(data) { this.data = data; } };
                navigator.clipboard.write = async (items) => { clipboardStarted = true; copied = await (await items[0].data['text/plain']).text(); };
                const clipboardPending = helpers.copyMarkdown(new Promise((resolve) => { resolveClipboard = resolve; }));
                check(clipboardStarted, 'Promise clipboard write starts before asynchronous content is ready');
                resolveClipboard('Prepared clipboard'); await clipboardPending;
                check(copied === 'Prepared clipboard', 'Promise clipboard receives prepared text');
                delete navigator.clipboard.write;
                window.ClipboardItem = originalClipboardItem;
                const choices = { 'example/diagram': 'svg' };
                const entries = helpers.getExporters();
                htmlUsesInnerContent = true;
                const modernHtml = await helpers.prepareExport(blocks, { id: 42 }, entries, choices);
                check(modernHtml.body.includes('<svg') && modernHtml.omitted.length === 0, 'WordPress 7.1 innerContent serialization preserves block replacements');
                htmlUsesInnerContent = false;
                const twoSvg = await helpers.prepareExport([blocks[0], blocks[0]], { id: 42 }, entries, choices);
                check(twoSvg.body.includes('id="semd-svg-0-paint"') && twoSvg.body.includes('url(#semd-svg-0-paint)') &&
                    twoSvg.body.includes('id="semd-svg-1-paint"') && !twoSvg.body.includes('id="paint"'), 'Scope SVG IDs and local references to each fragment');
                for (const url of ['javascript:alert(1)', 'data:image/svg+xml,invalid', 'blob:invalid', '/relative.png', 'https://user:pass@example.org/a.png', 'https://example.org/a\n.png']) {
                    let rejected = false;
                    try { await helpers.prepareExport(blocks, { id: 42 }, [{ ...entries[0], exportBlock: () => ({ type: 'image', url, alt: 'Test' }) }], choices); }
                    catch (error) { rejected = true; }
                    check(rejected, 'Reject unsafe, relative or credential-bearing image URLs');
                }
                const parentCalls = blockCalls;
                const parent = await helpers.prepareExport([{ name: 'example/diagram', attributes: {}, innerBlocks: [{ name: 'example/diagram', attributes: {} }] }], { id: 42 }, entries, choices);
                check(blockCalls === parentCalls + 1 && parent.body.includes('<svg'), 'A replaced parent owns its subtree');
                const htmlBlocks = [{ name: 'core/html', attributes: { content: '<p>First</p><div class="example-diagram"><div class="example-diagram">Nested</div></div><p>Last</p>' } }];
                const htmlBefore = JSON.stringify(htmlBlocks);
                const customHtml = await helpers.prepareExport(htmlBlocks, { id: 42 }, entries, choices);
                check(htmlCalls === 1 && customHtml.body.includes('**Custom HTML**') && !/secret|javascript|Nested|Mutated copy/.test(customHtml.body), 'Detached HTML transformation replaces a subtree and sanitizes its output');
                check(JSON.stringify(htmlBlocks) === htmlBefore && customHtml.body.indexOf('First') < customHtml.body.indexOf('Custom HTML') && customHtml.body.indexOf('Custom HTML') < customHtml.body.indexOf('Last'), 'HTML input and document order are preserved');
                for (const content of [
                    '<table><tr><td><span class="example-diagram">Original</span></td></tr></table>',
                    '<table><tr><td colspan="2"><span class="example-diagram">Original</span></td></tr></table>',
                ]) {
                    const tableExport = await helpers.prepareExport([{ name: 'core/html', attributes: { content } }], { id: 42 }, [{ ...entries[0], exportHtml: () => ({ type: 'svg', content: svg }) }], choices);
                    check(tableExport.body.includes('<svg') && !/SEMD|Original/.test(tableExport.body), 'Keep extension fragments in GFM and HTML table fallbacks');
                }
                for (const bad of [
                    '<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"/>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>Label</div></foreignObject></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><path style="fill:red"/></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.org/x.svg#a"/></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(https://example.org/x)"/></svg>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><use href="#a"/></g></svg>',
                    '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>',
                    '<svg xmlns="http://www.w3.org/2000/svg"><path></svg>',
                ]) {
                    let rejected = false; try { helpers.sanitizeSvg(bad); } catch (error) { rejected = true; }
                    check(rejected, 'Reject unsupported or dangerous SVG');
                }
                let fallbackCalls = 0;
                wp.hooks.addFilter('simple_export_md.exporters', 'example/fallback', (items) => [...items, {
                    id: 'example/fallback', label: 'Fallback', blockNames: ['example/diagram'], formats: [{ value: 'text', label: 'Text' }],
                    exportBlock: () => { fallbackCalls++; return { type: 'html', content: '<p>Fallback handler</p>' }; },
                }]);
                mode = 'null';
                const fallback = await helpers.prepareExport(blocks, { id: 42 }, helpers.getExporters(), { ...choices, 'example/fallback': 'text' });
                check(fallback.body.includes('Fallback handler') && fallbackCalls === 1 && fallback.omitted.length === 0, 'First non-null handler wins in registration order');
                mode = 'normal';
                await helpers.prepareExport(blocks, { id: 42 }, helpers.getExporters(), { ...choices, 'example/fallback': 'text' });
                check(fallbackCalls === 1, 'Later matching handlers do not run after replacement');
                wp.hooks.addFilter('simple_export_md.exporters', 'example/invalid', (items) => [...items, definition, { ...definition, id: 'example/bad', selector: '[' }, { id: 'example/malformed' }]);
                check(helpers.getExporters().length === 2, 'Reject duplicate IDs, invalid selectors and malformed definitions');
                wp.hooks.removeFilter('simple_export_md.exporters', 'example/invalid');
                wp.hooks.removeFilter('simple_export_md.exporters', 'example/diagram');
                wp.hooks.removeFilter('simple_export_md.exporters', 'example/fallback');
                check(!render().some((node) => node.type === 'select'), 'Removing extensions updates the panel');
                for (const [id, timer] of timers) if (timer.delay === 10000) { timer.callback(); timers.delete(id); }
                let revoked = [], created = [], clickError = false;
                URL.createObjectURL = () => { const url = 'blob:audit-' + created.length; created.push(url); return url; };
                URL.revokeObjectURL = (url) => revoked.push(url);
                HTMLAnchorElement.prototype.click = () => { if (clickError) throw new Error('Download rejected'); };
                helpers.downloadMarkdown('Body', 'post.md');
                check(document.querySelectorAll('a').length === 0 && revoked.length === 0, 'Remove successful download anchor');
                [...timers.values()].find((timer) => timer.delay === 10000).callback();
                check(revoked[0] === created[0], 'Release successful Object URL');
                clickError = true;
                try { helpers.downloadMarkdown('Body', 'post.md'); } catch (error) { check(error.message === 'Download rejected', 'Propagate download error'); }
                check(document.querySelectorAll('a').length === 0 && revoked.includes(created[1]), 'Release failed download anchor and URL');
                return count;
            }, fs.readFileSync(path.join('assets', variant), 'utf8'));
            await page.waitForTimeout(50);
            if (unexpectedRequests.length) throw new Error('Export must not fetch resources: ' + unexpectedRequests.join(', '));
            console.log(`${variant}: ${checks} browser checks passed`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
