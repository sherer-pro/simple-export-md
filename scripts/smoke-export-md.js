const fs = require('fs');
const vm = require('vm');

function createTemplateMock() {
    return {
        content: {
            textContent: '',
        },
        set innerHTML(value) {
            this.content.textContent = String(value).replace(/<[^>]*>/g, '');
        },
    };
}

const sandbox = {
    console,
    document: {
        createElement(tagName) {
            if (tagName === 'template') {
                return createTemplateMock();
            }
            return {};
        },
    },
    navigator: {},
    window: {
        SIMPLE_EXPORT_MD_TESTS: true,
    },
    wp: {
        plugins: {
            registerPlugin() {},
        },
        editPost: {
            PluginDocumentSettingPanel: function PluginDocumentSettingPanel() {},
        },
        components: {
            Button: function Button() {},
            Notice: function Notice() {},
        },
        data: {
            useSelect() {
                return {};
            },
        },
        i18n: {
            __(text) {
                return text;
            },
        },
        element: {
            createElement() {},
            useState(initialValue) {
                return [initialValue, function noop() {}];
            },
            useCallback(callback) {
                return callback;
            },
            useEffect() {},
        },
        blocks: {
            serialize() {
                return '';
            },
        },
    },
};

sandbox.window.wp = sandbox.wp;
sandbox.window.document = sandbox.document;
sandbox.window.navigator = sandbox.navigator;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('assets/export-md.js', 'utf8'), sandbox);

const helpers = sandbox.window.simpleExportMdInternals;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

assert(helpers, 'Expected test helpers to be exposed');
assert(helpers.yamlString('a"b') === '"a\\"b"', 'yamlString should JSON-quote scalar values');
assert(helpers.yamlArray(['one', 'two']) === '["one", "two"]', 'yamlArray should emit quoted inline arrays');
assert(helpers.sanitizeFilename('../bad:name', 42) === 'bad-name.md', 'sanitizeFilename should remove unsafe path characters');
assert(helpers.sanitizeFilename('', 42) === 'post-42.md', 'sanitizeFilename should use post id fallback');
assert(helpers.normalizeTitle({ rendered: '<strong>Hello</strong>' }) === 'Hello', 'normalizeTitle should strip rendered HTML');
assert(helpers.sanitizeFilename('CON.notes', 42) === 'post-CON.notes.md', 'Windows device names must be prefixed');
assert(helpers.sanitizeFilename('a'.repeat(119) + '😀', 42).endsWith('😀.md'), 'Filename truncation must preserve Unicode characters');
assert(!helpers.sanitizeFilename('a'.repeat(119) + '.x', 42).endsWith('..md'), 'Trim punctuation after truncation');
assert(JSON.stringify(helpers.normalizeTermIds([1, '1', 2, 0, -1, null, 'bad'])) === '[1,2]', 'Normalize positive unique term IDs');

for (const size of [0, 100, 101, 201]) {
    const ids = Array.from({ length: size }, (_, index) => index + 1).reverse();
    const requests = [];
    const core = {
        getEntityRecords(kind, taxonomy, query) {
            requests.push(query);
            return query.include.slice().reverse().map((id) => ({ id, name: 'term-' + id }));
        },
        hasFinishedResolution: () => true,
        getResolutionError: () => null,
    };
    const result = helpers.selectTerms(() => core, 'category', ids);
    assert(!result.isLoading && !result.error, 'All terms should resolve for ' + size);
    assert(JSON.stringify(result.records.map((term) => term.id)) === JSON.stringify(ids), 'Preserve selected order for ' + size);
    assert(requests.every((query) => query.include.length <= 100), 'Chunk REST requests for ' + size);
    assert(requests.length === Math.ceil(size / 100), 'Avoid unnecessary requests for ' + size);
}

for (const scenario of ['loading', 'failed', 'missing']) {
    const core = {
        getEntityRecords: () => scenario === 'missing' ? [] : null,
        hasFinishedResolution: () => scenario !== 'loading',
        getResolutionError: () => scenario === 'failed' ? new Error('REST failed') : null,
    };
    const result = helpers.selectTerms(() => core, 'category', [1]);
    assert(result.isLoading === (scenario === 'loading'), 'Loading state: ' + scenario);
    assert(result.error === (scenario !== 'loading'), 'Reject incomplete metadata: ' + scenario);
}

const invalidated = [];
sandbox.wp.data.dispatch = () => ({ invalidateResolution: (selector, args) => invalidated.push([selector, args]) });
helpers.retryTerms('post_tag', Array.from({ length: 201 }, (_, index) => index + 1));
assert(invalidated.length === 3 && invalidated.every((entry) => entry[1][1] === 'post_tag'), 'Retry every query for the selected taxonomy');

const frontMatter = helpers.buildFrontMatter(
    {
        title: 'Hello: World',
        slug: 'hello-world',
        date: '2026-06-27T12:00:00',
    },
    [{ name: 'News' }],
    [{ name: 'Security' }]
);

assert(frontMatter.includes('title: "Hello: World"'), 'front matter should quote title');
assert(frontMatter.includes('slug: "hello-world"'), 'front matter should quote slug');
assert(frontMatter.includes('categories: ["News"]'), 'front matter should include categories');
assert(frontMatter.includes('tags: ["Security"]'), 'front matter should include tags');

console.log('export-md smoke tests passed');
