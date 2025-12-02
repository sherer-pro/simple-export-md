(function (wp) {
    const { registerPlugin } = wp.plugins;
    const { PluginDocumentSettingPanel } = wp.editPost;
    const { Button, Notice } = wp.components;
    const { useSelect } = wp.data;
    const { __ } = wp.i18n;
    const { createElement: h, useState, useCallback, useEffect } = wp.element;

    function injectStylesOnce() {
        if (document.getElementById('simple-export-md-styles')) return;
        const style = document.createElement('style');
        style.id = 'simple-export-md-styles';
        style.type = 'text/css';
        style.appendChild(document.createTextNode(
            '.simple-export-md-buttons{display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap}' +
            '.simple-export-md-notice-wrap{margin-bottom:8px}' +
            '.simple-export-md-notice-transition{opacity:0;transform:translateY(4px);transition:opacity .18s ease-out,transform .18s ease-out}' +
            '.simple-export-md-notice-transition.is-visible{opacity:1;transform:translateY(0)}'
        ));
        document.head.appendChild(style);
    }
    injectStylesOnce();

    function buildFrontMatter(post, cats, tags) {
        const lines = ['---'];
        if (post?.title) lines.push('title: ' + JSON.stringify(post.title));
        if (post?.slug)  lines.push('slug: ' + post.slug);
        if (post?.date)  lines.push('date: ' + post.date);
        if (cats?.length) lines.push('categories: [' + cats.map(c => JSON.stringify(c.name)).join(', ') + ']');
        if (tags?.length) lines.push('tags: [' + tags.map(t => JSON.stringify(t.name)).join(', ') + ']');
        lines.push('---\n');
        return lines.join('\n');
    }

    function Panel() {
        const post   = useSelect(s => s('core/editor').getCurrentPost(), []);
        const blocks = useSelect(s => s('core/block-editor').getBlocks(), []);

        const catIds = post?.categories || [];
        const tagIds = post?.tags || [];

        const cats = useSelect(
            s => catIds.length ? s('core').getEntityRecords('taxonomy', 'category', { include: catIds }) : [],
            [catIds.join(',')]
        ) || [];

        const tags = useSelect(
            s => tagIds.length ? s('core').getEntityRecords('taxonomy', 'post_tag', { include: tagIds }) : [],
            [tagIds.join(',')]
        ) || [];

        const [busy, setBusy]       = useState(false);
        const [message, setMessage] = useState('');
        const [status, setStatus]   = useState(null); // 'success' | 'error' | null
        const [visible, setVisible] = useState(false);

        useEffect(() => {
            if (!message || !status) {
                setVisible(false);
                return;
            }
            const showTick = requestAnimationFrame(() => setVisible(true));
            const hideTimer = setTimeout(() => {
                setVisible(false);
                const CLEAR_DELAY_MS = 220;
                const clearTimer = setTimeout(() => {
                    setStatus(null);
                    setMessage('');
                }, CLEAR_DELAY_MS);
                return () => clearTimeout(clearTimer);
            }, 2400);

            return () => {
                cancelAnimationFrame(showTick);
                clearTimeout(hideTimer);
            };
        }, [message, status]);

        const showMessage = useCallback((type, text) => {
            setStatus(type);
            setMessage(text);
        }, []);

        const buildMarkdown = useCallback(() => {
            const html = wp.blocks.serialize(blocks);
            /* global TurndownService */
            const td = new TurndownService({
                headingStyle: 'atx',
                codeBlockStyle: 'fenced',
                emDelimiter: '_',
            });

            td.addRule('wpFigure', {
                filter: ['figure', 'figcaption'],
                replacement: (content) => '\n\n' + content + '\n\n',
            });

            const body = td.turndown(html);
            const fm = buildFrontMatter(post, cats, tags);
            return fm + body + '\n';
        }, [blocks, post, cats, tags]);

        async function handleCopy() {
            try {
                setBusy(true);
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
                a.download = (post?.slug || 'post') + '.md';
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 10000);
                showMessage('success', __('Markdown file generated and downloaded.', 'simple-export-md'));
            } catch (e) {
                showMessage('error', e?.message || __('Failed to download Markdown.', 'simple-export-md'));
            } finally {
                setBusy(false);
            }
        }

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
                h(Button, { isPrimary: true, onClick: handleDownload, disabled: busy }, busy ? __('Processing…', 'simple-export-md') : __('Download .md', 'simple-export-md')),
                h(Button, { isPrimary: true, onClick: handleCopy,     disabled: busy }, busy ? __('Processing…', 'simple-export-md') : __('Copy Markdown', 'simple-export-md'))
            )
        );
    }

    registerPlugin('simple-export-md', { render: Panel });
})(window.wp);
