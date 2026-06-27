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
