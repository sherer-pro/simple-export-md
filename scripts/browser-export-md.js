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
            await page.addScriptTag({ content: fs.readFileSync(path.join('assets', 'turndown.js'), 'utf8') });
            const checks = await page.evaluate(async (source) => {
                let count = 0;
                function check(condition, message) {
                    count++;
                    if (!condition) throw new Error(message);
                }
                let panel, cursor = 0, state = [], effect, cleanup, copied = '';
                let clipboardError = false, termError = false, termLoading = false;
                let categoryIds = [], blocks = [{ name: 'core/paragraph', html: '<p>Unsaved body</p>' }];
                const timers = new Map();
                let nextTimer = 0;
                window.setTimeout = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
                window.clearTimeout = (id) => timers.delete(id);
                Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => {
                    if (clipboardError) throw new Error('Clipboard rejected');
                    copied = text;
                } } });
                const serialize = (items) => items.map((block) => block.html ?? '<div>' + serialize(block.innerBlocks || []) + '</div>').join('');
                window.SIMPLE_EXPORT_MD_TESTS = true;
                window.wp = {
                    plugins: { registerPlugin: (name, plugin) => { panel = plugin.render; } },
                    editPost: { PluginDocumentSettingPanel: 'panel' },
                    components: { Button: 'button', Notice: 'notice' },
                    i18n: { __: (text) => text },
                    blocks: { serialize, getBlockType: (name) => ({ title: name }) },
                    data: {
                        dispatch: () => ({ invalidateResolution: () => { termError = false; } }),
                        useSelect: (callback) => callback((store) => {
                            if (store === 'core/editor') return {
                                getCurrentPost: () => ({ id: 42 }), getCurrentPostId: () => 42,
                                getEditedPostAttribute: (key) => ({ title: 'Unsaved "title"\nnext', slug: 'new-slug', date: '2026-10-08T12:00:00', categories: categoryIds, tags: [] })[key],
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
                        useEffect: (callback, deps) => {
                            if (!effect || deps.some((dep, index) => dep !== effect[index])) {
                                if (cleanup) cleanup();
                                effect = deps;
                                cleanup = callback();
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
                const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(nodes)];
                const render = () => { cursor = 0; return nodes(panel()); };
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
            console.log(`${variant}: ${checks} browser checks passed`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
