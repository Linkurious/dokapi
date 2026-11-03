'use strict';

const fs = require('fs-extra');
const path = require('path');
const Utils = require('./Utils');
const AbstractGenerator = require('./AbstractGenerator');

const INTERNAL_LINK_RE = /(^|[^!])(\[[^\]]*])\(\/([a-z0-9-]*)(?:\/?(#[a-z0-9-]+))?\/?\)/g;
const HASH_LINK_RE = /(^|[^!])(\[[^\]]*])\((#[a-zA-Z0-9-]+)\)/g;
const IMAGE_RE = /(!\[[^\]]*])\(([^)]+?)\)/g;
// internal links that are left once supported ones were rewritten: root-relative or relative
// inline links ("[a](/b)", "[a](./b/)"), and reference definitions ("[a]: /b")
const LEFTOVER_LINK_RE = new RegExp(
  '\\]\\((?:/|\\.{1,2}/)[^)]*\\)|' + // inline
  '^ {0,3}\\[[^\\]]+\\]:[ \\t]*<?(?:/|\\.{1,2}/)\\S*', // reference definition
  'm'
);

// code that must be left as is (no link validation or rewriting): fenced blocks, then inline spans
const FENCED_CODE_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE_RE = /(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const MASK = String.fromCharCode(0);

/**
 * Replaces code (fenced blocks and inline spans) by placeholders, so that links in code samples
 * are neither validated nor rewritten (the HTML generators only look at actual links either).
 *
 * @param {string} markdown
 * @returns {{masked: string, restore: function(string): string}}
 */
function maskCode(markdown) {
  const codes = [];
  const mask = code => `${MASK}${codes.push(code) - 1}${MASK}`;
  const masked = markdown.replace(FENCED_CODE_RE, mask).replace(INLINE_CODE_RE, mask);
  const placeholderRe = new RegExp(`${MASK}(\\d+)${MASK}`, 'g');
  return {masked, restore: text => text.replace(placeholderRe, (m, i) => codes[Number(i)])};
}

/**
 * Generates plain Markdown (variables resolved, links made absolute) for LLM consumption:
 * - one "<key>.md" file per entry ("index.md" for the main entry);
 * - "llms.txt": index of all pages (see https://llmstxt.org);
 * - "llms-full.txt": all pages concatenated.
 *
 * Images are not copied: they are referenced like the "site" output does ("images/<key>__<file>"),
 * so the generated files are meant to be placed next to the "site" output.
 */
class MarkdownGenerator extends AbstractGenerator {

  /**
   * @param {DokapiBook} book
   * @param {string} target
   * @param {string} projectSources
   * @param {string} [baseUrl] Public URL of the site output (used to make links absolute).
   */
  constructor(book, target, projectSources, baseUrl) {
    super(book, path.resolve(target, 'markdown'), projectSources, '');
    this.baseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : undefined;
  }

  $generate() {
    this.log('Generating Markdown content...');

    // "index.md" is the file of the main entry
    this.forEntries(entry => {
      if (entry.key === 'index') {
        throw new Error(
          'Entry key "index" is reserved by the Markdown output (it is the file name of the main ' +
          `entry): rename the key of the entry "${entry.name}".`
        );
      }
    });

    /** @type {Array<{entry: DokapiEntry, title: string, markdown: string}>} */
    const pages = [];
    this.forEntries(entry => {
      const markdown = this.generateMarkdown(entry);
      fs.writeFileSync(path.resolve(this.target, this.pageFile(entry.key)), markdown);
      if (!entry.hidden) {
        pages.push({entry, title: this.entryTitle(entry), markdown});
      }
    });

    fs.writeFileSync(path.resolve(this.target, 'llms.txt'), this.generateLlmsTxt());
    fs.writeFileSync(
      path.resolve(this.target, 'llms-full.txt'),
      pages.map(p => p.markdown.trim()).join('\n\n---\n\n') + '\n'
    );
  }

  /**
   * @param {string} key
   * @returns {string}
   */
  pageFile(key) {
    return key === '' ? 'index.md' : `${key}.md`;
  }

  /**
   * @param {string} file path relative to the output folder
   * @returns {string} absolute URL if a base URL is known, else the (relative) path
   */
  url(file) {
    return this.baseUrl ? `${this.baseUrl}/${file}` : file;
  }

  /**
   * @param {DokapiEntry} entry
   * @returns {string}
   */
  entryTitle(entry) {
    return entry.parent ? `${entry.parent.name}: ${entry.name}` : entry.name;
  }

  /**
   * @param {DokapiEntry} entry
   * @returns {string}
   */
  generateMarkdown(entry) {
    /** @type {RenderContext} */
    const context = {pathToRoot: this.pathToRoot(entry), currentKey: entry.key};

    let body;
    const mdPath = entry.content ? this.book.resolveContent(entry.content) : undefined;
    if (mdPath && Utils.isFile(mdPath)) {
      body = this.$getMarkdownContent(mdPath, this.$makeEntryVariables(entry), context);
    } else {
      body = this.makeMarkdownIndex(entry.children || []);
    }

    // links in code samples are literal: neither validated nor rewritten
    const {masked, restore} = maskCode(body);
    this.$checkInternalLinks(masked, entry.content || '[generated]');
    body = restore(this.fixMarkdownLinks(masked, context)).replace(/\u200B/g, '').trim();

    const source = this.baseUrl
      ? `Source: ${this.baseUrl}/${entry.key ? entry.key + '/' : ''}\n\n`
      : '';
    return `# ${this.entryTitle(entry)}\n\n${source}${body}\n`;
  }

  /**
   * Same as the HTML generators: breaks the build on broken internal links.
   *
   * @param {string} markdown
   * @param {string} mdPath
   */
  $checkInternalLinks(markdown, mdPath) {
    const re = new RegExp(INTERNAL_LINK_RE.source, 'g');
    Utils.forEachMatch(markdown, re, (before, text, key) => {
      if (!this.entryKeys.has(key)) {
        throw new Error(`Broken internal link "/${key}" in file "${mdPath}"`);
      }
    });
  }

  /**
   * @param {string} mdBody
   * @param {RenderContext} context
   * @returns {string}
   */
  fixMarkdownLinks(mdBody, context) {
    // links to other entries
    mdBody = mdBody.replace(
      new RegExp(INTERNAL_LINK_RE.source, 'g'),
      (m, before, text, key, anchor) =>
        `${before}${text}(${this.url(this.pageFile(key))}${anchor || ''})`
    );

    // links to the current entry (absolute, so they stay valid when pages are concatenated)
    mdBody = mdBody.replace(
      new RegExp(HASH_LINK_RE.source, 'g'),
      (m, before, text, anchor) =>
        `${before}${text}(${this.url(this.pageFile(context.currentKey))}${anchor})`
    );

    // images (not copied: same location as in the "site" output)
    mdBody = mdBody.replace(
      new RegExp(IMAGE_RE.source, 'g'),
      (m, alt, src) => /^https?:\/\//.test(src)
        ? m
        : `${alt}(${this.url(`images/${context.currentKey}__${src}`)})`
    );

    // like the HTML generators, only inline links "/entry-key" and "/entry-key/#anchor" are
    // supported: reject the other internal forms (relative links, reference definitions)
    const leftover = mdBody.match(LEFTOVER_LINK_RE);
    if (leftover) {
      throw new Error(
        `Unexpected link URL: "${leftover[0].trim()}" in entry "${context.currentKey}" ` +
        '(internal links must be inline links of the form "/entry-key" or "/entry-key/#anchor")'
      );
    }
    return mdBody;
  }

  /**
   * Code files are always injected as code blocks (no HTML "<textarea>" in Markdown).
   *
   * @param {string} referenceKey
   * @param {string} filePath
   * @param {object} variableOverrides
   * @param {RenderContext} context
   * @returns {string}
   * @private
   */
  _getFileRefValue(referenceKey, filePath, variableOverrides, context) {
    const ext = Utils.getExtension(filePath);
    const fileBody = this.resolveVariables(
      filePath,
      fs.readFileSync(filePath, {encoding: 'utf8'}),
      variableOverrides,
      context,
      false
    );
    return '\n```' + ext + '\n' + fileBody + '\n```\n';
  }

  /**
   * @param {DokapiEntry} entry
   * @param {RenderContext} context
   * @returns {string}
   */
  $generateMissingContentHtml(entry, context) {
    return '';
  }

  /**
   * @returns {string} the "llms.txt" index
   */
  generateLlmsTxt() {
    const config = this.book.config;
    const link = entry => {
      const target = this.url(this.pageFile(entry.key));
      return `- [${this.entryTitle(entry)}](${target})`;
    };

    const lines = [`# ${config.name}`, ''];
    lines.push(
      `> Markdown version of the "${config.name}" documentation` +
      (this.baseUrl ? ` (HTML version: ${this.baseUrl}/).` : '.'),
      ''
    );

    lines.push(`## ${config.main.name}`, '', link(this._mainEntry), '');

    config.index.forEach(entry => {
      if (entry.hidden) { return; }
      lines.push(`## ${entry.name}`, '');
      if (entry.content) { lines.push(link(entry)); }
      (entry.children || []).filter(c => !c.hidden).forEach(child => lines.push(link(child)));
      lines.push('');
    });

    return lines.join('\n');
  }
}

module.exports = MarkdownGenerator;
