(function (wp) {
    const { registerPlugin } = wp.plugins;
    const { PluginDocumentSettingPanel } = wp.editPost;
    const { Button, Notice } = wp.components;
    const { useSelect } = wp.data;
    const { __ } = wp.i18n;
    const { createElement: h, useState, useCallback, useEffect } = wp.element;

    const TERM_QUERY_BASE = {
        per_page: 100,
        orderby: 'include',
    };

    function normalizeTermIds(value) {
        return Array.isArray(value) ? value.filter(Boolean) : [];
    }

    function buildTermsQuery(ids) {
        return {
            ...TERM_QUERY_BASE,
            include: ids,
        };
    }

    function selectTerms(select, taxonomy, ids) {
        if (!ids.length) {
            return {
                isLoading: false,
                records: [],
            };
        }

        const query = buildTermsQuery(ids);
        const args = ['taxonomy', taxonomy, query];
        const core = select('core');
        const records = core.getEntityRecords(...args);
        const hasFinished = typeof core.hasFinishedResolution === 'function'
            ? core.hasFinishedResolution('getEntityRecords', args)
            : Array.isArray(records);

        return {
            isLoading: !hasFinished,
            records: Array.isArray(records) ? records : [],
        };
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
        const clean = base
            .replace(/[\\/:*?"<>|#%{}[\]^~`]/g, '-')
            .replace(/[\u0000-\u001f\u0080-\u009f]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^[.-]+/, '')
            .replace(/[.-]+$/, '')
            .slice(0, 120);

        return (clean || fallback) + '.md';
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
        const [message, setMessage] = useState('');
        const [status, setStatus] = useState(null); // 'success' | 'error' | null
        const [visible, setVisible] = useState(false);
        const termsLoading = cats.isLoading || tags.isLoading;
        const disabled = busy || termsLoading;

        useEffect(() => {
            if (!message || !status) {
                setVisible(false);
                return undefined;
            }

            let clearTimer;
            const showTick = requestAnimationFrame(() => setVisible(true));
            const hideTimer = setTimeout(() => {
                setVisible(false);
                clearTimer = setTimeout(() => {
                    setStatus(null);
                    setMessage('');
                }, 220);
            }, 2400);

            return () => {
                cancelAnimationFrame(showTick);
                clearTimeout(hideTimer);
                clearTimeout(clearTimer);
            };
        }, [message, status]);

        const showMessage = useCallback((type, text) => {
            setStatus(type);
            setMessage(text);
        }, []);

        const buildMarkdown = useCallback(() => {
            assertExporterReady();

            const html = wp.blocks.serialize(blocks);
            const td = new window.TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
                emDelimiter: '_',
            });

            td.addRule('wpFigure', {
                filter: ['figure', 'figcaption'],
                replacement: (content) => '\n\n' + content + '\n\n',
            });

            const body = td.turndown(html);
            const fm = buildFrontMatter(editorState, cats.records, tags.records);
            return fm + body + '\n';
        }, [blocks, editorState, cats.records, tags.records]);

        async function handleCopy() {
            try {
                setBusy(true);
                assertClipboardReady();
                const md = buildMarkdown();
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
                const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = sanitizeFilename(editorState.slug, editorState.id);
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 10000);
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

            status && message && h(
                'div',
                { className: 'simple-export-md-notice-wrap' },
                h(
                    'div',
                    { className: 'simple-export-md-notice-transition' + (visible ? ' is-visible' : '') },
                    h(Notice, { status, isDismissible: false, children: message })
                )
            ),

            h(
                'div',
                { className: 'simple-export-md-buttons' },
                h(Button, { isPrimary: true, onClick: handleDownload, disabled }, disabled ? busyLabel : __('Download .md', 'simple-export-md')),
                h(Button, { isPrimary: true, onClick: handleCopy, disabled }, disabled ? busyLabel : __('Copy Markdown', 'simple-export-md'))
            )
        );
    }

    registerPlugin('simple-export-md', { render: Panel });
})(window.wp);
