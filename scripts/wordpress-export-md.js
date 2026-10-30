const fs = require('fs');
const assert = require('assert/strict');
const { chromium } = require('playwright');

async function main() {
    const base = new URL(process.argv[2]);
    if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Only disposable localhost fixtures are supported.');
    const executablePath = [process.env.PLAYWRIGHT_EXECUTABLE_PATH, chromium.executablePath(),
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((file) => file && fs.existsSync(file));
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
        const page = await browser.newPage({ acceptDownloads: true });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
                writeText: async (text) => { window.simpleExportMdCopied = text; },
            } });
        });
        let failTerms = false;
        await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== base.origin) return route.abort();
            if (failTerms && /(?:\/wp\/v2\/categories|%2Fwp%2Fv2%2Fcategories)/i.test(url.href)) {
                return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'audit_failure', message: 'Synthetic term failure', data: { status: 500 } }) });
            }
            return route.continue();
        });
        await page.goto(new URL('/wp-login.php?semd-audit=1', base).href);
        await page.goto(new URL('/wp-admin/post-new.php', base).href);
        await page.waitForFunction(() => window.simpleExportMdAuditFixture && window.wp?.data?.select('core/editor')?.getCurrentPostId());
        const fixture = await page.evaluate(() => window.simpleExportMdAuditFixture);
        await page.goto(new URL(`/wp-admin/post.php?post=${fixture.post}&action=edit`, base).href);
        await page.waitForFunction(() => window.wp?.data?.select('core/editor')?.getCurrentPostId());
        await page.evaluate(() => {
            const settings = wp.data.select('core/edit-post');
            if (settings.isFeatureActive('welcomeGuide')) wp.data.dispatch('core/edit-post').toggleFeature('welcomeGuide');
            wp.data.dispatch('core/edit-post').openGeneralSidebar('edit-post/document');
        });
        const toggle = page.getByRole('button', { name: 'Export to Markdown', exact: true });
        await toggle.waitFor();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        const panel = page.locator('.simple-export-md');
        const copy = panel.getByRole('button', { name: 'Copy Markdown', exact: true });
        const waitReady = () => page.waitForFunction(() => [...document.querySelectorAll('.simple-export-md button')].some((button) => button.textContent === 'Copy Markdown' && !button.disabled));
        await page.evaluate((ids) => {
            wp.data.dispatch('core/editor').editPost({ title: 'Unsaved audit title', slug: 'unsaved-audit', categories: ids });
            wp.data.dispatch('core/block-editor').resetBlocks(wp.blocks.parse('<!-- wp:paragraph --><p>Unsaved body</p><!-- /wp:paragraph --><!-- wp:table --><figure class="wp-block-table"><table><tbody><tr><td>Product</td><td>Price</td></tr><tr><td>Book</td><td>100</td></tr></tbody></table></figure><!-- /wp:table -->'));
        }, fixture.categories);
        await waitReady(); await copy.click();
        const markdown = await page.evaluate(() => window.simpleExportMdCopied);
        assert(markdown.includes('title: "Unsaved audit title"') && markdown.includes('Unsaved body'));
        assert.equal((markdown.match(/Audit category \d+/g) || []).length, 201);
        assert(markdown.includes('| Product | Price |') && markdown.includes('| Book | 100 |'));
        const downloadEvent = page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Download .md', exact: true }).click();
        const download = await downloadEvent;
        assert.equal(download.suggestedFilename(), 'unsaved-audit.md');
        assert.equal(fs.readFileSync(await download.path(), 'utf8'), markdown);
        failTerms = true;
        await page.evaluate((ids) => wp.data.dispatch('core/editor').editPost({ categories: ids.slice(0, 3).reverse() }), fixture.categories);
        await panel.getByText('Could not load all categories and tags. Please retry.', { exact: true }).waitFor();
        assert(await copy.isDisabled());
        await page.waitForTimeout(2700);
        assert(await panel.getByText('Could not load all categories and tags. Please retry.', { exact: true }).isVisible());
        failTerms = false;
        await panel.getByRole('button', { name: 'Retry loading terms', exact: true }).click();
        await waitReady(); await copy.click();
        const recovered = await page.evaluate(() => window.simpleExportMdCopied);
        assert(recovered.includes('categories: ["Audit category 3", "Audit category 2", "Audit category 1"]'));
        await page.evaluate(() => wp.data.dispatch('core/block-editor').resetBlocks(wp.blocks.parse('<!-- wp:paragraph --><p>Kept body</p><!-- /wp:paragraph --><!-- wp:latest-posts /-->')));
        const warning = panel.getByText('Markdown will omit content from these blocks:', { exact: true });
        await warning.waitFor(); await waitReady(); await copy.click();
        await page.waitForTimeout(2700);
        assert(await warning.isVisible());
        const partial = await page.evaluate(() => window.simpleExportMdCopied);
        assert(partial.includes('Kept body') && !partial.includes('omit content'));
        await page.evaluate(() => {
            wp.data.dispatch('core/block-editor').resetBlocks([
                wp.blocks.createBlock('core/group', {}, [
                    wp.blocks.createBlock('core/paragraph', { content: 'Before extension' }),
                    wp.blocks.createBlock('example/export-diagram', { caption: 'Original caption' }),
                    wp.blocks.createBlock('core/html', { content: '<div class="fixture-export-html">Original custom HTML</div>' }, [], ['<div class="fixture-export-html">Original custom HTML</div>']),
                    wp.blocks.createBlock('core/paragraph', { content: 'After extension' }),
                ]),
            ]);
        });
        const format = panel.getByLabel('Fixture diagrams', { exact: true });
        await format.waitFor();
        assert.equal(await format.inputValue(), '');
        assert.equal(await page.evaluate(() => window.simpleExportMdFixtureCalls), 0);
        await copy.click();
        assert(!(await page.evaluate(() => window.simpleExportMdCopied)).includes('<svg'));
        assert.equal(await page.evaluate(() => window.simpleExportMdFixtureCalls), 0);
        await format.selectOption('svg');
        const originalBlocks = await page.evaluate(() => JSON.stringify(wp.data.select('core/block-editor').getBlocks()));
        await copy.click();
        await waitReady();
        await panel.getByText('Markdown copied to clipboard.', { exact: true }).waitFor();
        const svgMarkdown = await page.evaluate(() => window.simpleExportMdCopied);
        assert(svgMarkdown.includes('<svg') && svgMarkdown.includes('Fixture SVG</text>'));
        assert(svgMarkdown.includes('**Fixture HTML exported**') && !svgMarkdown.includes('Original custom HTML'));
        assert(svgMarkdown.indexOf('Before extension') < svgMarkdown.indexOf('<svg') && svgMarkdown.indexOf('<svg') < svgMarkdown.indexOf('After extension'));
        assert.equal(await page.evaluate(() => JSON.stringify(wp.data.select('core/block-editor').getBlocks())), originalBlocks);
        assert.equal(await warning.count(), 0);
        const svgDownloadEvent = page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Download .md', exact: true }).click();
        assert.equal(fs.readFileSync(await (await svgDownloadEvent).path(), 'utf8'), svgMarkdown);
        await format.selectOption('image'); await copy.click(); await waitReady();
        await panel.getByText('Markdown copied to clipboard.', { exact: true }).waitFor();
        assert((await page.evaluate(() => window.simpleExportMdCopied)).includes('![Fixture diagram](https://example.invalid/diagram.png)'));
        await format.selectOption(''); await copy.click();
        await warning.waitFor();
        assert(!(await page.evaluate(() => window.simpleExportMdCopied)).includes('Fixture SVG'));
        const script = await page.locator('script[src*="/assets/export-md."]').getAttribute('src');
        await page.goto(new URL('/wp-admin/site-editor.php', base).href);
        assert.equal(await page.locator('script[src*="/plugins/simple-export-md/"]').count(), 0);
        await page.goto(new URL('/wp-admin/widgets.php', base).href);
        assert.equal(await page.locator('script[src*="/plugins/simple-export-md/"]').count(), 0);
        assert.deepEqual(errors, []);
        console.log(`${base.origin}: Gutenberg metadata, tables, extension controls, async nested blocks, custom HTML, SVG/image export, identical download, REST retry and editor isolation passed (${script.includes('.min.js') ? 'minified' : 'source'})`);
    } finally {
        await browser.close();
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
