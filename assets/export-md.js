(function (wp) {
    const { registerPlugin } = wp.plugins;
    const PluginDocumentSettingPanel = wp.editor?.PluginDocumentSettingPanel || wp.editPost.PluginDocumentSettingPanel;
    const { Button, Notice, SelectControl } = wp.components;
    const { useSelect } = wp.data;
    const { __ } = wp.i18n;
    const { createElement: h, useState, useCallback, useEffect, useMemo, useRef } = wp.element;

    const EXPORTERS_HOOK = 'simple_export_md.exporters';
    const diagnostics = new Set();

    function diagnose(key) {
        if (diagnostics.has(key)) return;
        diagnostics.add(key);
        // Never log definitions, callback errors, attributes, URLs or post content.
        console.warn('Simple Export to Markdown: invalid export extension (' + key + ').');
    }

    function getExporters() {
        let entries;
        try { entries = wp.hooks.applyFilters(EXPORTERS_HOOK, []); }
        catch (error) { diagnose('filter'); return []; }
        if (!Array.isArray(entries)) { diagnose('list'); return []; }
        const ids = new Set();
        return entries.flatMap((entry, index) => {
            try {
                if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9._/-]*$/.test(entry.id) ||
                    ids.has(entry.id) || typeof entry.label !== 'string' || !entry.label.trim() ||
                    !Array.isArray(entry.formats) || !entry.formats.length) throw new Error();
                const values = new Set();
                const formats = entry.formats.map((format) => {
                    if (!format || typeof format.value !== 'string' || !format.value.trim() || values.has(format.value) ||
                        typeof format.label !== 'string' || !format.label.trim()) throw new Error();
                    values.add(format.value);
                    return { value: format.value, label: format.label };
                });
                const blockNames = entry.blockNames === undefined ? [] : entry.blockNames;
                if (!Array.isArray(blockNames) || blockNames.some((name) => typeof name !== 'string' || !name.trim()) ||
                    (blockNames.length && typeof entry.exportBlock !== 'function')) throw new Error();
                const selector = entry.selector === undefined ? '' : entry.selector;
                if (typeof selector !== 'string' || (selector && typeof entry.exportHtml !== 'function') ||
                    (!blockNames.length && !selector)) throw new Error();
                if (selector) document.createElement('template').content.querySelector(selector);
                ids.add(entry.id);
                return [{ id: entry.id, label: entry.label, formats, blockNames: [...blockNames], selector,
                    exportBlock: entry.exportBlock, exportHtml: entry.exportHtml }];
            } catch (error) { diagnose('entry ' + index); return []; }
        });
    }

    function activeExporters(exporters, choices) {
        return exporters.filter((entry) => entry.formats.some((format) => format.value === choices[entry.id]));
    }

    function applicableExporters(exporters, blocks) {
        const names = new Set();
        function visit(block) { names.add(block.name); (block.innerBlocks || []).forEach(visit); }
        blocks.forEach(visit);
        let template;
        return exporters.filter((entry) => {
            if (entry.blockNames.some((name) => names.has(name))) return true;
            if (!entry.selector) return false;
            if (!template) {
                template = document.createElement('template');
                template.innerHTML = wp.blocks.serialize(blocks);
            }
            return Boolean(template.content.querySelector(entry.selector));
        });
    }

    function extensionError(entry, message) {
        return new Error(message + ' (' + entry.id + ')');
    }

    async function callExporter(entry, callback, input, post, format) {
        const controller = new AbortController();
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(() => callback(input, { format, post: JSON.parse(JSON.stringify(post)), signal: controller.signal })),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        reject(extensionError(entry, __('An export extension timed out. Please retry.', 'simple-export-md')));
                        controller.abort();
                    }, 30000);
                }),
            ]);
        } catch (error) {
            if (controller.signal.aborted) throw extensionError(entry, __('An export extension timed out. Please retry.', 'simple-export-md'));
            throw extensionError(entry, __('An export extension failed. Please retry or use standard export.', 'simple-export-md'));
        } finally { clearTimeout(timer); }
    }

    // A deliberately static SVG profile. Reject unsupported features instead of losing labels or geometry.
    function sanitizeSvg(source, prefix = '') {
        const invalid = () => new Error(__('SVG export requires static SVG without scripts, CSS, foreignObject or external resources.', 'simple-export-md'));
        if (typeof source !== 'string' || /<!DOCTYPE|<!ENTITY|<\?/i.test(source)) throw invalid();
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        const root = doc.documentElement;
        const ns = 'http://www.w3.org/2000/svg';
        if (doc.querySelector('parsererror') || root.localName !== 'svg' || root.namespaceURI !== ns) throw invalid();
        const tags = new Set('svg g defs symbol use title desc path rect circle ellipse line polyline polygon text tspan textPath clipPath mask marker linearGradient radialGradient stop pattern'.split(' '));
        const attrs = new Set(('id viewBox width height x y x1 y1 x2 y2 cx cy r rx ry dx dy d points transform preserveAspectRatio ' +
            'fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity ' +
            'font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline textLength lengthAdjust startOffset ' +
            'clip-path clip-rule mask marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits ' +
            'gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity fx fy fr ' +
            'patternUnits patternContentUnits patternTransform color vector-effect').split(' '));
        const ids = new Set();
        for (const node of [root, ...root.querySelectorAll('*')]) {
            if (node.namespaceURI !== ns || !tags.has(node.localName)) throw invalid();
            for (const attr of [...node.attributes]) {
                if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') {
                    if (!['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'].includes(attr.value)) throw invalid();
                } else if (attr.localName === 'href' && (!attr.namespaceURI || attr.namespaceURI === 'http://www.w3.org/1999/xlink')) {
                    if (!/^#[A-Za-z_][\w:.-]*$/.test(attr.value)) throw invalid();
                } else if (attr.namespaceURI || !attrs.has(attr.name) || /[\\\u0000-\u001f\u007f]|\/\*|expression\s*\(/i.test(attr.value)) {
                    throw invalid();
                } else if (/url\s*\(/i.test(attr.value) && !/^url\(\s*['"]?#[A-Za-z_][\w:.-]*['"]?\s*\)$/i.test(attr.value)) {
                    throw invalid();
                }
            }
            if (node.hasAttribute('id')) {
                const id = node.getAttribute('id');
                if (!/^[A-Za-z_][\w:.-]*$/.test(id) || ids.has(id)) throw invalid();
                ids.add(id);
            }
        }
        // Local references may not resolve into a different inline SVG or into a cycle.
        const visiting = new Set(), visited = new Set();
        function checkReferences(node) {
            if (visiting.has(node)) throw invalid();
            if (visited.has(node)) return;
            visiting.add(node);
            for (const attr of [...node.attributes]) {
                const ref = attr.localName === 'href' ? attr.value.slice(1) : attr.value.match(/^url\(\s*['"]?#([\w:.-]+)/i)?.[1];
                if (ref) {
                    const target = doc.getElementById(ref);
                    if (!target) throw invalid();
                    checkReferences(target);
                }
            }
            [...node.children].forEach(checkReferences);
            visiting.delete(node); visited.add(node);
        }
        checkReferences(root);
        if (prefix) {
            for (const node of [root, ...root.querySelectorAll('*')]) {
                for (const attr of [...node.attributes]) {
                    if (attr.name === 'id') attr.value = prefix + attr.value;
                    else if (attr.localName === 'href') attr.value = '#' + prefix + attr.value.slice(1);
                    else if (/^url\(/i.test(attr.value)) attr.value = attr.value.replace(/#([\w:.-]+)/, '#' + prefix + '$1');
                }
            }
        }
        return new XMLSerializer().serializeToString(root);
    }

    function renderExportResult(result, entry, index) {
        const invalid = () => extensionError(entry, __('An export extension returned invalid content.', 'simple-export-md'));
        if (!result || typeof result !== 'object') throw invalid();
        let html;
        if (result.type === 'svg') {
            try { html = sanitizeSvg(result.content, 'semd-svg-' + index + '-'); }
            catch (error) { throw extensionError(entry, error.message); }
            return { html, markdown: '\n\n' + html + '\n\n' };
        }
        if (result.type === 'html' && typeof result.content === 'string' && result.content.trim()) {
            const template = document.createElement('template');
            template.innerHTML = result.content;
            template.content.replaceChildren(sanitizeTable(template.content, true));
            html = template.innerHTML;
        } else if (result.type === 'image' && typeof result.url === 'string' && /^https?:\/\//i.test(result.url) &&
            typeof result.alt === 'string' && (result.title === undefined || typeof result.title === 'string')) {
            let url;
            try { url = new URL(result.url); } catch (error) { throw invalid(); }
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(result.url)) throw invalid();
            const template = document.createElement('template');
            template.innerHTML = '<img>';
            const img = template.content.firstChild;
            img.setAttribute('src', url.href.replace(/[()]/g, (char) => char === '(' ? '%28' : '%29'));
            img.setAttribute('alt', result.alt.replace(/[\r\n]+/g, ' '));
            if (result.title !== undefined) img.setAttribute('title', result.title.replace(/[\r\n]+/g, ' '));
            html = img.outerHTML;
            const escapeText = (text) => text.replace(/[\\\[\]`*_]/g, '\\$&');
            const title = result.title ? ' "' + img.getAttribute('title').replace(/[\\"]/g, '\\$&') + '"' : '';
            return { html, markdown: '![' + escapeText(img.getAttribute('alt')) + '](' + img.getAttribute('src') + title + ')' };
        } else { throw invalid(); }
        const markdown = convertHtml(html);
        if (!markdown.trim()) throw invalid();
        return { html, markdown };
    }

    async function prepareExport(blocks, post, exporters, choices) {
        const selected = activeExporters(exporters, choices);
        if (!selected.length) return { body: convertHtml(wp.blocks.serialize(blocks)), omitted: findOmittedBlocks(blocks) };
        const snapshot = JSON.parse(JSON.stringify(blocks));
        const postSnapshot = JSON.parse(JSON.stringify(post));
        const selections = { ...choices };
        const fragments = new Map();
        const token = 'SEMD' + Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16)).join('') + 'F';
        function placeholder(result, entry) {
            const key = token + fragments.size + 'END';
            fragments.set(key, renderExportResult(result, entry, fragments.size));
            return '<span>' + key + '</span>';
        }
        async function visitBlock(block) {
            for (const entry of selected) {
                if (!entry.blockNames.includes(block.name)) continue;
                const result = await callExporter(entry, entry.exportBlock, JSON.parse(JSON.stringify(block)), postSnapshot, selections[entry.id]);
                if (result !== null) {
                    const content = placeholder(result, entry);
                    // WordPress 7.1 stores Custom HTML in innerContent; older editors use attributes.content.
                    return wp.blocks.createBlock('core/html', { content }, [], [content]);
                }
            }
            block.innerBlocks = await visitBlocks(block.innerBlocks || []);
            return block;
        }
        async function visitBlocks(items) {
            const prepared = [];
            for (const block of items) prepared.push(await visitBlock(block));
            return prepared;
        }
        const prepared = await visitBlocks(snapshot);
        const omitted = findOmittedBlocks(prepared);
        const template = document.createElement('template');
        template.innerHTML = wp.blocks.serialize(prepared);
        async function visitHtml(parent) {
            for (const node of [...parent.children]) {
                if (node.nodeName === 'SPAN' && fragments.has(node.textContent)) continue;
                let replaced = false;
                for (const entry of selected) {
                    if (!entry.selector || !node.matches(entry.selector)) continue;
                    const result = await callExporter(entry, entry.exportHtml, node.cloneNode(true), postSnapshot, selections[entry.id]);
                    if (result === null) continue;
                    const replacement = document.createElement('template');
                    replacement.innerHTML = placeholder(result, entry);
                    node.replaceWith(replacement.content);
                    replaced = true;
                    break;
                }
                if (!replaced) await visitHtml(node);
            }
        }
        await visitHtml(template.content);
        const body = convertHtml(template.innerHTML, fragments);
        // A dynamic ancestor can legitimately discard a replacement. Never leak internal tokens.
        if (body.includes(token)) throw new Error(__('An export extension returned invalid content.', 'simple-export-md'));
        return { body, omitted };
    }

    const TERM_QUERY_BASE = {
        per_page: 100,
        orderby: 'include',
    };

    function normalizeTermIds(value) {
        return Array.isArray(value)
            ? [...new Set(value.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
            : [];
    }

    function buildTermsQuery(ids) {
        return {
            ...TERM_QUERY_BASE,
            include: ids,
        };
    }

    function selectTerms(select, taxonomy, ids) {
        const core = select('core');
        const recordsById = new Map();
        let isLoading = false;
        let error = false;

        for (const query of buildTermsQueries(ids)) {
            const args = ['taxonomy', taxonomy, query];
            const records = core.getEntityRecords(...args);
            const hasFinished = core.hasFinishedResolution('getEntityRecords', args);
            error = Boolean(core.getResolutionError('getEntityRecords', args)) || error;
            isLoading = !hasFinished || isLoading;
            for (const record of records || []) {
                if (record && typeof record.name === 'string') recordsById.set(Number(record.id), record);
            }
        }

        const records = ids.map((id) => recordsById.get(id)).filter(Boolean);
        error = error || (!isLoading && records.length !== ids.length);

        return {
            isLoading,
            error,
            records,
        };
    }

    function buildTermsQueries(ids) {
        const queries = [];
        for (let offset = 0; offset < ids.length; offset += 100) {
            queries.push(buildTermsQuery(ids.slice(offset, offset + 100)));
        }
        return queries;
    }

    function retryTerms(taxonomy, ids) {
        for (const query of buildTermsQueries(ids)) {
            wp.data.dispatch('core').invalidateResolution('getEntityRecords', ['taxonomy', taxonomy, query]);
        }
    }

    function getEditedPostState(editor) {
        const currentPost = editor.getCurrentPost ? editor.getCurrentPost() : {};
        const currentPostId = editor.getCurrentPostId ? editor.getCurrentPostId() : currentPost?.id;

        return {
            id: currentPostId,
            title: editor.getEditedPostAttribute('title'),
            slug: editor.getEditedPostAttribute('slug'),
            date: editor.getEditedPostAttribute('date'),
            categories: normalizeTermIds(editor.getEditedPostAttribute('categories')),
            tags: normalizeTermIds(editor.getEditedPostAttribute('tags')),
        };
    }

    function selectPostBlocks(select) {
        const editor = select('core/editor');
        const edited = editor.getEditedPostAttribute('blocks');
        if (Array.isArray(edited)) return edited;
        if (typeof editor.getEditorBlocks === 'function') return editor.getEditorBlocks();
        return select('core/block-editor').getBlocks();
    }

    function stripHtml(value) {
        // Parsed in a detached template for text extraction only; content is never inserted into the document.
        const template = document.createElement('template');
        template.innerHTML = String(value);
        return template.content.textContent || '';
    }

    function normalizeTitle(title) {
        if (typeof title === 'string') {
            return title;
        }

        if (title && typeof title.raw === 'string') {
            return title.raw;
        }

        if (title && typeof title.rendered === 'string') {
            return stripHtml(title.rendered);
        }

        return '';
    }

    function yamlString(value) {
        return JSON.stringify(String(value));
    }

    function yamlArray(values) {
        return '[' + values.map(yamlString).join(', ') + ']';
    }

    function buildFrontMatter(post, cats, tags) {
        const title = normalizeTitle(post.title).trim();
        const slug = String(post.slug || '').trim();
        const date = String(post.date || '').trim();
        const categoryNames = cats.map((term) => term && term.name).filter(Boolean);
        const tagNames = tags.map((term) => term && term.name).filter(Boolean);
        const lines = ['---'];

        if (title) lines.push('title: ' + yamlString(title));
        if (slug) lines.push('slug: ' + yamlString(slug));
        if (date) lines.push('date: ' + yamlString(date));
        if (categoryNames.length) lines.push('categories: ' + yamlArray(categoryNames));
        if (tagNames.length) lines.push('tags: ' + yamlArray(tagNames));

        lines.push('---\n');
        return lines.join('\n');
    }

    function sanitizeFilename(slug, postId) {
        const fallback = postId ? 'post-' + postId : 'post';
        const base = String(slug || '').trim() || fallback;
        let clean = base
            .replace(/[\\/:*?"<>|#%{}[\]^~`]/g, '-')
            .replace(/[\u0000-\u001f\u0080-\u009f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^[.-]+/, '')
            .replace(/[.-]+$/, '');

        // Windows also reserves device names followed by an extension.
        if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(clean)) clean = 'post-' + clean;
        clean = Array.from(clean).slice(0, 120).join('').replace(/[.-]+$/, '');

        return (clean || fallback) + '.md';
    }

    function sanitizeTable(table, extension = false) {
        const clean = table.cloneNode(true);
        const allowedTags = new Set(('table caption colgroup col thead tbody tfoot tr th td p div span br strong em b i u s del code pre blockquote ul ol li a img h1 h2 h3 h4 h5 h6 sup sub' +
            (extension ? ' hr figure figcaption audio video source' : '')).split(' '));
        const attributes = {
            a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'],
            th: ['colspan', 'rowspan', 'scope', 'abbr'], td: ['colspan', 'rowspan'],
            col: ['span'], colgroup: ['span'], ol: ['start', 'reversed'],
            audio: ['src', 'title'], video: ['src', 'title'], source: ['src', 'type'],
        };
        clean.querySelectorAll('script, style, iframe, object, embed, link, meta, base, noscript' +
            (extension ? ', svg, math, template' : '')).forEach((node) => node.remove());
        for (const node of [...(clean.nodeType === 1 ? [clean] : []), ...clean.querySelectorAll('*')]) {
            const tag = node.nodeName.toLowerCase();
            if (!allowedTags.has(tag)) {
                node.replaceWith(...node.childNodes);
                continue;
            }
            for (const attr of [...node.attributes]) {
                if (!(attributes[tag] || []).includes(attr.name)) node.removeAttribute(attr.name);
            }
            for (const attr of ['href', 'src']) {
                if (!node.hasAttribute(attr)) continue;
                const url = node.getAttribute(attr).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
                const allowed = attr === 'href' ? /^(https?:|mailto:|tel:)/i : /^https?:/i;
                if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !allowed.test(url)) node.removeAttribute(attr);
            }
        }
        return clean;
    }

    function convertTable(table, td, fragments) {
        const clean = sanitizeTable(table);
        const rows = [...clean.rows];
        const width = rows[0]?.cells.length || 0;
        const header = rows.length && (rows[0].parentNode.nodeName === 'THEAD' || [...rows[0].cells].every((cell) => cell.nodeName === 'TH'));
        const complex = !width || clean.querySelector('caption, table, pre') || rows.some((row, index) =>
            row.cells.length !== width || [...row.cells].some((cell) =>
                cell.colSpan !== 1 || cell.rowSpan !== 1 || (cell.nodeName === 'TH' && (!header || index > 0))
            )
        );
        if (complex) {
            for (const node of clean.querySelectorAll('span')) {
                const fragment = fragments?.get(node.textContent);
                if (!fragment || node.childElementCount) continue;
                const template = document.createElement('template');
                template.innerHTML = fragment.html;
                node.replaceWith(template.content);
            }
            return '\n\n' + clean.outerHTML + '\n\n';
        }

        const lines = rows.map((row) => '| ' + [...row.cells].map((cell) =>
            td.turndown(cell).trim().replace(/\|/g, '\\|').replace(/[ \t]*\n+[ \t]*/g, '<br>')
        ).join(' | ') + ' |');
        if (!header) lines.unshift('| ' + Array(width).fill('').join(' | ') + ' |');
        lines.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |');
        return '\n\n' + lines.join('\n') + '\n\n';
    }

    function findOmittedBlocks(blocks, selected = []) {
        const omitted = new Set();
        function visit(block) {
            if (selected.some((entry) => entry.blockNames.includes(block.name))) return;
            const children = block.innerBlocks || [];
            if (block.name === 'core/block' || (!['core/more', 'core/nextpage'].includes(block.name) &&
                !wp.blocks.serialize([block]).replace(/<!--[\s\S]*?-->/g, '').trim())) {
                const type = wp.blocks.getBlockType(block.name);
                omitted.add(type?.title || block.name);
            }
            children.forEach(visit);
        }
        blocks.forEach(visit);
        return [...omitted];
    }

    function convertHtml(html, fragments) {
        assertExporterReady();
        const template = document.createElement('template');
        template.innerHTML = html;
        template.content.querySelectorAll('script, style').forEach((node) => node.remove());
        const td = new window.TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_' });
        td.addRule('media', {
            filter: ['audio', 'video'],
            replacement: (content, node) => {
                const label = node.nodeName === 'AUDIO' ? __('Audio', 'simple-export-md') : __('Video', 'simple-export-md');
                const sources = [node.getAttribute('src'), ...[...node.querySelectorAll('source[src]')].map((source) => source.getAttribute('src'))];
                const urls = [...new Set(sources)].flatMap((source) => {
                    if (!source || !/^https?:\/\//i.test(source) || /[\u0000-\u0020\u007f-\u009f]/.test(source)) return [];
                    try {
                        const url = new URL(source);
                        if (url.username || url.password) return [];
                        return [url.href.replace(/[()]/g, (char) => char === '(' ? '%28' : '%29')];
                    } catch (error) { return []; }
                });
                return '\n\n' + [content.trim(), ...urls.map((url) => '[' + label + '](' + url + ')')].filter(Boolean).join('\n\n') + '\n\n';
            },
        });
        td.addRule('preformatted', {
            filter: (node) => node.nodeName === 'PRE' && !node.querySelector('code'),
            replacement: (content, node) => {
                const text = node.textContent;
                const length = (text.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length + 1), 3);
                const fence = '`'.repeat(length);
                return '\n\n' + fence + '\n' + text + (text.endsWith('\n') ? '' : '\n') + fence + '\n\n';
            },
        });
        td.addRule('wpFigure', { filter: ['figure', 'figcaption'], replacement: (content) => '\n\n' + content + '\n\n' });
        td.addRule('table', { filter: 'table', replacement: (content, node) => convertTable(node, td, fragments) });
        if (fragments) td.addRule('extension', {
            filter: (node) => node.nodeName === 'SPAN' && !node.childElementCount && fragments.has(node.textContent),
            replacement: (content, node) => fragments.get(node.textContent).markdown,
        });
        return td.turndown(template.innerHTML);
    }

    function downloadMarkdown(markdown, filename) {
        const anchor = document.createElement('a');
        const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
        let clicked = false;
        try {
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            clicked = true;
        } finally {
            anchor.remove();
            // Give the browser time to consume successful downloads; failures need no delay.
            if (clicked) setTimeout(() => URL.revokeObjectURL(url), 10000);
            else URL.revokeObjectURL(url);
        }
    }

    function assertExporterReady() {
        if (typeof window.TurndownService !== 'function') {
            throw new Error(__('Markdown exporter is not ready. Please reload the editor.', 'simple-export-md'));
        }
    }

    function assertClipboardReady() {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error(__('Clipboard is not available in this browser.', 'simple-export-md'));
        }
    }

    async function copyMarkdown(prepared) {
        let write;
        try {
            const data = prepared.then((markdown) => new Blob([markdown], { type: 'text/plain' }));
            // Native clipboard implementations may reject before consuming the promised data.
            data.catch(() => {});
            // Start the clipboard write during the click gesture, even if an adapter is still fetching data.
            write = typeof window.ClipboardItem === 'function' && typeof navigator.clipboard.write === 'function'
                ? navigator.clipboard.write([new window.ClipboardItem({
                    'text/plain': data,
                })])
                : prepared.then((markdown) => navigator.clipboard.writeText(markdown));
        } catch (error) { write = Promise.reject(error); }
        // A rejected clipboard permission must not leave an unfinished adapter running behind enabled controls.
        const results = await Promise.allSettled([prepared, write]);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    }

    function exposeTestHelpers() {
        if (!window.SIMPLE_EXPORT_MD_TESTS) {
            return;
        }

        window.simpleExportMdInternals = {
            buildFrontMatter,
            buildTermsQuery,
            buildTermsQueries,
            selectTerms,
            retryTerms,
            convertHtml,
            findOmittedBlocks,
            downloadMarkdown,
            getEditedPostState,
            normalizeTermIds,
            normalizeTitle,
            sanitizeFilename,
            yamlArray,
            yamlString,
            getExporters,
            applicableExporters,
            prepareExport,
            sanitizeSvg,
            copyMarkdown,
        };
    }

    exposeTestHelpers();

    function Panel() {
        const editorState = useSelect((select) => {
            return getEditedPostState(select('core/editor'));
        }, []);

        const blocks = useSelect(selectPostBlocks, []);
        const catIdsKey = editorState.categories.join(',');
        const tagIdsKey = editorState.tags.join(',');

        const cats = useSelect(
            (select) => selectTerms(select, 'category', editorState.categories),
            [catIdsKey]
        );

        const tags = useSelect(
            (select) => selectTerms(select, 'post_tag', editorState.tags),
            [tagIdsKey]
        );

        const [busy, setBusy] = useState(false);
        const [notice, setNotice] = useState(null);
        const [dismissedWarnings, setDismissedWarnings] = useState('');
        const [choices, setChoices] = useState({});
        const [exportersRevision, setExportersRevision] = useState(0);
        const [resolvedWarnings, setResolvedWarnings] = useState(null);
        const running = useRef(false);
        const exporters = useMemo(() => getExporters(), [exportersRevision]);
        const applicable = useMemo(() => applicableExporters(exporters, blocks), [exporters, blocks]);
        const choicesKey = JSON.stringify(choices);
        const omitted = useMemo(() => resolvedWarnings?.blocks === blocks && resolvedWarnings.choicesKey === choicesKey &&
            resolvedWarnings.revision === exportersRevision ? resolvedWarnings.omitted :
            findOmittedBlocks(blocks, activeExporters(applicable, choices)), [blocks, applicable, choicesKey, resolvedWarnings, exportersRevision]);
        const warningsKey = JSON.stringify(omitted);
        const termsLoading = cats.isLoading || tags.isLoading;
        const termsError = cats.error || tags.error;
        const disabled = busy || termsLoading || termsError;

        useEffect(() => {
            const changed = (name) => {
                if (name === EXPORTERS_HOOK) setExportersRevision((revision) => revision + 1);
            };
            wp.hooks.addAction('hookAdded', 'simple-export-md/exporters', changed);
            wp.hooks.addAction('hookRemoved', 'simple-export-md/exporters', changed);
            // Catch registration between the first render and this subscription.
            setExportersRevision((revision) => revision + 1);
            return () => {
                wp.hooks.removeAction('hookAdded', 'simple-export-md/exporters');
                wp.hooks.removeAction('hookRemoved', 'simple-export-md/exporters');
            };
        }, []);

        useEffect(() => { setChoices({}); setResolvedWarnings(null); }, [editorState.id]);

        useEffect(() => {
            if (notice?.status !== 'success') return undefined;
            const timer = setTimeout(() => setNotice(null), 2400);
            return () => clearTimeout(timer);
        }, [notice]);

        const showMessage = useCallback((type, text) => {
            setNotice((previous) => ({ status: type, text, id: (previous?.id || 0) + 1 }));
        }, []);

        const buildMarkdown = useCallback(async () => {
            if (termsLoading || termsError) throw new Error(__('Could not load all categories and tags. Please retry.', 'simple-export-md'));
            // Build metadata before awaiting an extension, using the same editor snapshot as the body.
            const fm = buildFrontMatter(editorState, cats.records, tags.records);
            const result = await prepareExport(blocks, editorState, applicable, choices);
            setResolvedWarnings({ blocks, choicesKey, revision: exportersRevision, omitted: result.omitted });
            return fm + result.body + '\n';
        }, [blocks, editorState, cats.records, tags.records, termsLoading, termsError, applicable, choicesKey, exportersRevision]);

        async function handleCopy() {
            if (running.current) return;
            running.current = true;
            try {
                setBusy(true);
                assertClipboardReady();
                await copyMarkdown(buildMarkdown());
                setDismissedWarnings('');
                showMessage('success', __('Markdown copied to clipboard.', 'simple-export-md'));
            } catch (e) {
                showMessage('error', e?.message || __('Failed to copy Markdown.', 'simple-export-md'));
            } finally {
                running.current = false;
                setBusy(false);
            }
        }

        async function handleDownload() {
            if (running.current) return;
            running.current = true;
            try {
                setBusy(true);
                const filename = sanitizeFilename(editorState.slug, editorState.id);
                const md = await buildMarkdown();
                setDismissedWarnings('');
                downloadMarkdown(md, filename);
                showMessage('success', __('Markdown file generated and downloaded.', 'simple-export-md'));
            } catch (e) {
                showMessage('error', e?.message || __('Failed to download Markdown.', 'simple-export-md'));
            } finally {
                running.current = false;
                setBusy(false);
            }
        }

        const busyLabel = termsLoading
            ? __('Loading terms...', 'simple-export-md')
            : __('Processing...', 'simple-export-md');

        return h(
            PluginDocumentSettingPanel,
            {
                name: 'simple-export-md',
                title: __('Export to Markdown', 'simple-export-md'),
                className: 'simple-export-md',
            },

            termsError && h(Notice, { status: 'error', isDismissible: false },
                h('p', {}, __('Could not load all categories and tags. Please retry.', 'simple-export-md')),
                h(Button, { onClick: () => {
                    retryTerms('category', editorState.categories);
                    retryTerms('post_tag', editorState.tags);
                }, disabled: busy || termsLoading }, __('Retry loading terms', 'simple-export-md'))
            ),

            applicable.map((entry) => h(SelectControl, {
                key: entry.id,
                label: entry.label,
                value: entry.formats.some((format) => format.value === choices[entry.id]) ? choices[entry.id] : '',
                options: [{ value: '', label: __('Standard export', 'simple-export-md') }, ...entry.formats],
                disabled: busy,
                onChange: (value) => {
                    setChoices((previous) => ({ ...previous, [entry.id]: value }));
                    setDismissedWarnings('');
                },
            })),

            omitted.length > 0 && dismissedWarnings !== warningsKey && h(Notice, {
                status: 'warning', isDismissible: true, onRemove: () => setDismissedWarnings(warningsKey),
            },
                h('p', {}, __('Markdown will omit content from these blocks:', 'simple-export-md')),
                h('ul', {}, omitted.map((name) => h('li', { key: name }, name)))
            ),

            notice && h(
                'div',
                { key: notice.id, className: 'simple-export-md-notice-wrap' },
                h(Notice, { status: notice.status, isDismissible: true, onRemove: () => setNotice(null), children: notice.text })
            ),

            h(
                'div',
                { className: 'simple-export-md-buttons' },
                h(Button, { isPrimary: true, onClick: handleDownload, disabled }, busy || termsLoading ? busyLabel : __('Download .md', 'simple-export-md')),
                h(Button, { isPrimary: true, onClick: handleCopy, disabled }, busy || termsLoading ? busyLabel : __('Copy Markdown', 'simple-export-md'))
            )
        );
    }

    registerPlugin('simple-export-md', { render: Panel });
})(window.wp);
