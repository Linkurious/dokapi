'use strict';

const fs = require('fs-extra');
const os = require('node:os');
const path = require('node:path');
const {describe, it, before, after} = require('node:test');
const assert = require('node:assert/strict');
const Dokapi = require('../src/dokapi');

const BASE_URL = 'https://example.com/doc';

/**
 * @param {string} dir
 * @param {Object<string>} files content files (relative to "content/") to write
 * @param {object} [config] overrides for dokapi.json
 */
function makeBook(dir, files, config) {
  fs.ensureDirSync(path.resolve(dir, 'assets'));
  fs.writeFileSync(path.resolve(dir, 'site-template.html'), '<html>{{entry.html.body}}</html>');
  fs.writeFileSync(path.resolve(dir, 'page-template.html'), '<html>{{body}}</html>');
  fs.writeJsonSync(path.resolve(dir, 'dokapi.json'), Object.assign({
    name: 'Test Doc',
    variables: {product: 'Acme'},
    assets: 'assets',
    siteTemplate: 'site-template.html',
    pageTemplate: 'page-template.html',
    main: {content: 'main.md'},
    index: [
      {name: 'Intro', key: 'intro', content: 'intro.md', children: [
        {name: 'Child', key: 'child', content: 'child.md'}
      ]},
      {name: 'Hidden', key: 'hidden', hidden: true, content: 'hidden.md'},
      {name: 'Group', key: 'group', children: [
        {name: 'Leaf', key: 'leaf', content: 'leaf.md'}
      ]}
    ]
  }, config));
  for (const [file, body] of Object.entries(files)) {
    fs.outputFileSync(path.resolve(dir, 'content', file), body);
  }
}

const FILES = {
  'main.md': 'Welcome to {{product}}.\n\nSee [intro](/intro) and [the child](/child/#sec).\n',
  'intro.md': [
    '## Details',
    '',
    'Use {{product}}. Escaped: \\{{not.a.variable}}',
    '',
    '![a picture](pic.png)',
    '',
    '[here](#details), [main](/) and [google](https://google.com)',
    '',
    '{{editfile:snippet.js}}',
    ''
  ].join('\n'),
  'snippet.js': 'const p = "{{product}}";',
  'pic.png': 'not really a png',
  'child.md': 'The child.\n',
  'hidden.md': 'Secret hidden content.\n',
  'leaf.md': 'The leaf.\n'
};

/**
 * @param {string} input
 * @param {string} output
 * @param {string} [baseUrl]
 */
function run(input, output, baseUrl) {
  new Dokapi(
    {input, output, outputType: 'markdown', baseUrl},
    {info: () => {}, error: () => {}}
  ).run();
}

describe('markdown output', () => {
  let tmp;
  let out;

  before(() => {
    tmp = fs.mkdtempSync(path.resolve(os.tmpdir(), 'dokapi-md-'));
    makeBook(path.resolve(tmp, 'book'), FILES);
    run(path.resolve(tmp, 'book'), path.resolve(tmp, 'out'), BASE_URL);
    out = path.resolve(tmp, 'out', 'markdown');
  });

  after(() => fs.removeSync(tmp));

  const read = file => fs.readFileSync(path.resolve(out, file), 'utf8');

  it('should generate one file per entry, including hidden ones', () => {
    for (const f of ['index', 'intro', 'child', 'hidden', 'group', 'leaf']) {
      assert.ok(fs.existsSync(path.resolve(out, f + '.md')), f);
    }
  });

  it('should resolve variables and keep escaped references', () => {
    const intro = read('intro.md');
    assert.match(intro, /Use Acme\./);
    assert.match(intro, /Escaped: \{\{not\.a\.variable}}/);
    assert.match(read('index.md'), /Welcome to Acme\./);
  });

  it('should add a title and the source URL', () => {
    assert.match(read('child.md'), /^# Intro: Child\n\nSource: https:\/\/example\.com\/doc\/child\/\n/);
    assert.match(read('index.md'), /^# Test Doc\n\nSource: https:\/\/example\.com\/doc\/\n/);
  });

  it('should make internal links and images absolute', () => {
    const intro = read('intro.md');
    assert.match(intro, /\[here]\(https:\/\/example\.com\/doc\/intro\.md#details\)/);
    assert.match(intro, /\[main]\(https:\/\/example\.com\/doc\/index\.md\)/);
    assert.match(intro, /!\[a picture]\(https:\/\/example\.com\/doc\/images\/intro__pic\.png\)/);
    assert.match(intro, /\[google]\(https:\/\/google\.com\)/);
    const main = read('index.md');
    assert.match(main, /\[intro]\(https:\/\/example\.com\/doc\/intro\.md\)/);
    assert.match(main, /\[the child]\(https:\/\/example\.com\/doc\/child\.md#sec\)/);
  });

  it('should inject code files as code blocks', () => {
    const intro = read('intro.md');
    assert.match(intro, /```js\nconst p = "Acme";\n```/);
    assert.doesNotMatch(intro, /<textarea/);
  });

  it('should generate an index for entries without content', () => {
    assert.match(read('group.md'), /\[Leaf]\(https:\/\/example\.com\/doc\/leaf\.md\)/);
  });

  it('should generate llms.txt without hidden entries', () => {
    const llms = read('llms.txt');
    assert.match(llms, /^# Test Doc\n/);
    assert.match(llms, /- \[Intro: Child]\(https:\/\/example\.com\/doc\/child\.md\)/);
    assert.match(llms, /## Group\n\n- \[Group: Leaf]/);
    assert.doesNotMatch(llms, /hidden/i);
  });

  it('should generate llms-full.txt in menu order without hidden entries', () => {
    const full = read('llms-full.txt');
    assert.ok(full.indexOf('# Test Doc') < full.indexOf('# Intro\n'));
    assert.ok(full.indexOf('# Intro\n') < full.indexOf('# Intro: Child'));
    assert.ok(full.indexOf('# Intro: Child') < full.indexOf('# Group: Leaf'));
    assert.doesNotMatch(full, /Secret hidden content/);
  });
});

describe('markdown output without base URL', () => {
  it('should use relative links', () => {
    const tmp = fs.mkdtempSync(path.resolve(os.tmpdir(), 'dokapi-md-'));
    try {
      makeBook(path.resolve(tmp, 'book'), FILES);
      run(path.resolve(tmp, 'book'), path.resolve(tmp, 'out'));
      const main = fs.readFileSync(path.resolve(tmp, 'out', 'markdown', 'index.md'), 'utf8');
      assert.match(main, /\[intro]\(intro\.md\)/);
      assert.doesNotMatch(main, /Source:/);
    } finally {
      fs.removeSync(tmp);
    }
  });

  it('should use "baseUrl" from dokapi.json', () => {
    const tmp = fs.mkdtempSync(path.resolve(os.tmpdir(), 'dokapi-md-'));
    try {
      makeBook(path.resolve(tmp, 'book'), FILES, {baseUrl: BASE_URL + '/'});
      run(path.resolve(tmp, 'book'), path.resolve(tmp, 'out'));
      const main = fs.readFileSync(path.resolve(tmp, 'out', 'markdown', 'index.md'), 'utf8');
      assert.match(main, /\[intro]\(https:\/\/example\.com\/doc\/intro\.md\)/);
    } finally {
      fs.removeSync(tmp);
    }
  });
});

describe('markdown output errors', () => {
  const failing = (files, expected) => {
    const tmp = fs.mkdtempSync(path.resolve(os.tmpdir(), 'dokapi-md-'));
    try {
      makeBook(path.resolve(tmp, 'book'), Object.assign({}, FILES, files));
      assert.throws(
        () => run(path.resolve(tmp, 'book'), path.resolve(tmp, 'out'), BASE_URL),
        expected
      );
    } finally {
      fs.removeSync(tmp);
    }
  };

  it('should fail on broken internal links', () => {
    failing({'child.md': 'See [nowhere](/nope).\n'}, /Broken internal link "\/nope"/);
  });

  it('should fail on unresolved variables', () => {
    failing({'child.md': 'See {{undefined.variable}}.\n'}, /undefined\.variable/);
  });

  it('should fail on malformed internal links', () => {
    failing({'child.md': 'See [x](/Some/Path).\n'}, /Unexpected link URL/);
  });
});
