'use strict';

const fs = require('fs-extra');
const path = require('path');
const child = require('child_process');
const _defaults = require('lodash.defaults');
const marked = require('marked');
const hljs = require('highlight.js');
const hljsCypher = require('highlightjs-cypher');
const Valcheck = require('valcheck').default;
/** @type {function(Array, Array): Array} */
const _difference = require('lodash.difference');

/**
 * @type Valcheck
 */
const checker = new Valcheck(error => {
  throw new Error('Validation error: ' + error);
}, bug => {
  throw new Error('Library usage error: ' + bug);
});

const COMMENT_KEY_RE = /^@(\S+)(?:\s+(.+))?$/;

const MUSTACHE_REFERENCE_RE = /(.?){{([^}]+?)}}/g;

const MUSTACHE_REFERENCE_VALID = /^(?:file:|editfile:)?[a-z0-9.]+$/;

/**
 * Register the code highlighter for markdown renderer
 */
hljs.registerLanguage('cypher', hljsCypher);
marked.setOptions({
  highlight: function(code, lang, callback) {
    try {
      let result;
      if (lang) {
        result = hljs.highlight(code, {language: lang});
      } else {
        result = hljs.highlightAuto(code);
      }
      return result.value;
    } catch(err) {
      throw err;
    }
  }
});

/**
 * Patch the markdown renderer to add anchor links next to H1/H2/H3/H4 headings
 * This matches the github markdown renderer.
 * changes <h1 id="bla">bla</h1> to <h1 id="bla"><a href="#bla"></a>bla</h1>
 */
const renderer = {
  heading(text, level) {
    const escapedText = text.toLowerCase().replace(/[^\w]+/g, '-');
    return '<h' + level + ' class="header"><a aria-hidden="true" id="' +
      escapedText +
      '" class="deep-link" href="#' +
      escapedText +
      '"><span class="deep-link"></span></a>' +
      text + '</h' + level + '>';
  }
};
marked.use({ renderer });

class Utils {

  /**
   * Get all files recursively.
   *
   * @param {string} dir
   * @param {RegExp} regexp
   * @param {RegExp} [excluded]
   * @returns {Array<String>}
   */
  static getAllFiles(dir, regexp, excluded) {
    let files = [];
    const fileNames = fs.readdirSync(dir);
    for (let fileName of fileNames) {
      let filePath = path.resolve(dir, fileName);
      if (excluded && excluded.test(fileName)) {
        // ignore excluded file
        continue;
      }

      // use "lstat" instead of "stat" to avoid following symlinks
      let stat = fs.lstatSync(filePath);
      if (stat.isFile() && fileName.match(regexp)) {
        files.push(filePath);
      } else if (stat.isDirectory()) {
        files = files.concat(Utils.getAllFiles(filePath, regexp));
      }
    }
    return files;
  }

  /**
   * @returns {Valcheck}
   */
  static get check() { return checker; }

  /**
   * Clone git repository into a folder.
   *
   * @param {string} url Repository URL.
   * @param {string} dir Target directory.
   */
  static gitClone(url, dir) {
    let branch = 'master';
    if (url.indexOf('#') !== -1) {
      let ub = url.split('#');
      url = ub[0];
      branch = ub[1];
    }

    fs.emptyDirSync(dir);
    const r = child.spawnSync(
      'git',
      ['clone', `--branch=${branch}`, '--depth=1', url, '.'],
      {cwd: dir, timeout: 5000, stdio: 'pipe'}
    );

    const err = r.output[2];
    if (r.status !== 0) {
      throw new Error('Error while cloning: ' + err);
    }
  }

  /**
   * Extracts block comments from a JS file
   *
   * @param {string} file
   * @returns {Array<{file: string, keys: Object<string>, lines: Array<String>}>}
   */
  static extractComments(file) {
    const comments = [];
    const body = fs.readFileSync(file, {encoding: 'utf8'});

    const re = /^\/\*\*[\r\n]+([\w\W]+?)\*\//gm;
    let match, c, lines, comment;
    while ((match = re.exec(body)) !== null) {
      // extract lines
      c = match[1].trim();
      if (c[0] === '*') { c = c.substr(1); c = c.trim(); }
      lines = c.split(/[\r\n]+\s*[*][ ]?/);

      // extract @keys and lines
      comment = {file: file, keys: {}, lines: []};
      lines.forEach(line => {
        if ((match = COMMENT_KEY_RE.exec(line)) !== null) {
          comment.keys[match[1]] = match[2] ? match[2] : true;
        } else {
          comment.lines.push(line);
        }
      });

      comments.push(comment);
    }

    return comments;
  }

  /**
   * @param {string} body
   * @param {function(string, boolean)} callback called for each Moustache reference
   * @param {boolean} [escaped=false] get escaped references
   */
  static forReferences(body, callback, escaped) {
    const referenceRe = new RegExp(MUSTACHE_REFERENCE_RE.source, 'g');
    let match;
    while ((match = referenceRe.exec(body)) !== null) {
      let before = match[1];
      let ref = match[2];

      if (before === '\\') {
        if (escaped) {
          callback(ref, true);
        }
        continue;
      }

      if (!ref.match(MUSTACHE_REFERENCE_VALID)) {
        throw new ReferenceError(
          `Invalid reference format: "${ref}", must match ${MUSTACHE_REFERENCE_VALID}.`
        );
      }
      callback(ref, false);
    }
  }

  /**
   * @param {string} markdown Markdown content
   * @returns {string} HTML content
   */
  static renderMarkdown(markdown) {

    // hack to fix code highlighting
    markdown = markdown.replace(/```JS(?:ON)?\n/ig, '```js\n');

    // default options from "marked" match our needs
    // see https://marked.js.org/using_advanced#options
    return marked(markdown);
  }

  /**
   * @param {Array} array
   * @param {Array} otherArray
   * @returns {Array}
   */
  static difference(array, otherArray) {
    return _difference(array, otherArray);
  }

  /**
   *
   * @param {object} o
   * @param {object} defaults
   * @returns {object}
   */
  static defaults(o, defaults) {
    if (!o)  { o = {}; }
    return _defaults(o, defaults);
  }

  /**
   *
   * @param {string} p path
   * @returns {boolean}
   */
  static isFile(p) {
    try {
      const stats = fs.statSync(p);
      return stats.isFile();
    } catch(e) {
      return false;
    }
  }

  /**
   *
   * @param {string} string
   * @param {RegExp} re
   * @param {function(string...)} cb
   */
  static forEachMatch(string, re, cb) {
    let match;
    while ((match = re.exec(string)) !== null) {
      cb.apply(undefined, match.slice(1));
    }
  }

  /**
   * @param {string} filePath
   * @returns {string}
   */
  static getExtension(filePath) {
    const ext = path.extname(filePath);
    return ext && ext.length ? ext.slice(1) : '';
  }
}

module.exports = Utils;
