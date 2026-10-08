(function (wp) {
    const { registerPlugin } = wp.plugins;
    const { PluginDocumentSettingPanel } = wp.editPost;
    const { Button, Notice } = wp.components;
    const { useSelect } = wp.data;
    const { __ } = wp.i18n;
    const { createElement: h, useState, useCallback, useEffect, useMemo } = wp.element;

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

    function sanitizeTable(table) {
        const clean = table.cloneNode(true);
        const allowedTags = new Set(('table caption colgroup col thead tbody tfoot tr th td p div span br strong em b i u s del code pre blockquote ul ol li a img h1 h2 h3 h4 h5 h6 sup sub').split(' '));
        const attributes = {
            a: ['href', 'title'], img: ['src', 'alt', 'title', 'width', 'height'],
            th: ['colspan', 'rowspan', 'scope', 'abbr'], td: ['colspan', 'rowspan'],
            col: ['span'], colgroup: ['span'], ol: ['start', 'reversed'],
        };
        clean.querySelectorAll('script, style, iframe, object, embed, link, meta, base, noscript').forEach((node) => node.remove());
        for (const node of [clean, ...clean.querySelectorAll('*')]) {
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

    function convertTable(table, td) {
        const clean = sanitizeTable(table);
        const rows = [...clean.rows];
        const width = rows[0]?.cells.length || 0;
        const header = rows.length && (rows[0].parentNode.nodeName === 'THEAD' || [...rows[0].cells].every((cell) => cell.nodeName === 'TH'));
        const complex = !width || clean.querySelector('caption, table, pre') || rows.some((row, index) =>
            row.cells.length !== width || [...row.cells].some((cell) =>
                cell.colSpan !== 1 || cell.rowSpan !== 1 || (cell.nodeName === 'TH' && (!header || index > 0))
            )
        );
        if (complex) return '\n\n' + clean.outerHTML + '\n\n';

        const lines = rows.map((row) => '| ' + [...row.cells].map((cell) =>
            td.turndown(cell).trim().replace(/\|/g, '\\|').replace(/[ \t]*\n+[ \t]*/g, '<br>')
        ).join(' | ') + ' |');
        if (!header) lines.unshift('| ' + Array(width).fill('').join(' | ') + ' |');
        lines.splice(1, 0, '| ' + Array(width).fill('---').join(' | ') + ' |');
        return '\n\n' + lines.join('\n') + '\n\n';
    }

    function findOmittedBlocks(blocks) {
        const omitted = new Set();
        function visit(block) {
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

    function convertHtml(html) {
        assertExporterReady();
        const template = document.createElement('template');
        template.innerHTML = html;
        template.content.querySelectorAll('script, style').forEach((node) => node.remove());
        const td = new window.TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', emDelimiter: '_' });
        td.addRule('wpFigure', { filter: ['figure', 'figcaption'], replacement: (content) => '\n\n' + content + '\n\n' });
        td.addRule('table', { filter: 'table', replacement: (content, node) => convertTable(node, td) });
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
        };
    }

    exposeTestHelpers();

    function Panel() {
        const editorState = useSelect((select) => {
            return getEditedPostState(select('core/editor'));
        }, []);

        const blocks = useSelect((select) => select('core/block-editor').getBlocks(), []);
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
        const omitted = useMemo(() => findOmittedBlocks(blocks), [blocks]);
        const warningsKey = JSON.stringify(omitted);
        const termsLoading = cats.isLoading || tags.isLoading;
        const termsError = cats.error || tags.error;
        const disabled = busy || termsLoading || termsError;

        useEffect(() => {
            if (notice?.status !== 'success') return undefined;
            const timer = setTimeout(() => setNotice(null), 2400);
            return () => clearTimeout(timer);
        }, [notice]);

        const showMessage = useCallback((type, text) => {
            setNotice((previous) => ({ status: type, text, id: (previous?.id || 0) + 1 }));
        }, []);

        const buildMarkdown = useCallback(() => {
            if (termsLoading || termsError) throw new Error(__('Could not load all categories and tags. Please retry.', 'simple-export-md'));
            const body = convertHtml(wp.blocks.serialize(blocks));
            const fm = buildFrontMatter(editorState, cats.records, tags.records);
            return fm + body + '\n';
        }, [blocks, editorState, cats.records, tags.records, termsLoading, termsError]);

        async function handleCopy() {
            try {
                setBusy(true);
                assertClipboardReady();
                const md = buildMarkdown();
                setDismissedWarnings('');
                await navigator.clipboard.writeText(md);
                showMessage('success', __('Markdown copied to clipboard.', 'simple-export-md'));
            } catch (e) {
                showMessage('error', e?.message || __('Failed to copy Markdown.', 'simple-export-md'));
            } finally {
                setBusy(false);
            }
        }

        function handleDownload() {
            try {
                setBusy(true);
                const md = buildMarkdown();
                setDismissedWarnings('');
                downloadMarkdown(md, sanitizeFilename(editorState.slug, editorState.id));
                showMessage('success', __('Markdown file generated and downloaded.', 'simple-export-md'));
            } catch (e) {
                showMessage('error', e?.message || __('Failed to download Markdown.', 'simple-export-md'));
            } finally {
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
