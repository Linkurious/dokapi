'use strict';

const fs = require('fs-extra');
const path = require('path');
const Utils = require('./Utils');
const DokapiBook = require('./DokapiBook');

const LINK_MAILTO = /^mailto:[^\s]+$/ig;
const LINK_ABSOLUTE = /^https?:\/\/[^\s]+$/ig;
const LINK_RELATIVE = /^[.]{1,2}\/([a-z0-9-]*)(\/#[a-z0-9-]+)?$/ig;
const LINK_HASH = /^#([a-zA-Z0-9=-]+)$/ig;

/**
 * @typedef {object} RenderContext
 * @property {string} pathToRoot
 * @property {string} currentKey
 */

class AbstractGenerator {

  /**
   * @param {DokapiBook} book
   * @param {string} target
   * @param {string} projectSources
   * @param {string} htmlTemplateBody
   */
  constructor(book, target, projectSources, htmlTemplateBody) {
    //noinspection JSUnresolvedVariable
    this.book = book;
    this.target = target;
    this.projectSources = projectSources;
    this.htmlTemplateBody = htmlTemplateBody;

    this._mainEntry = {name: book.config.name, key: '', content: book.config.main.content};

    // index keys + set parent/prev/next
    this.entryKeys = new Set();
    let previousEntry = undefined;
    this.forEntries((entry, parentEntry) => {
      this.entryKeys.add(entry.key);

      if (parentEntry) {
        entry.parent = parentEntry;
        entry.hidden = entry.hidden || entry.parent.hidden;
      }

      if (previousEntry) {
        entry.previous = previousEntry;
        previousEntry.next = entry;
      }
      if (!entry.hidden) {
        previousEntry = entry;
      }
    });

    // image references
    this.imageReferences = this._getImageReferences();
    this._checkImageReferences();

    // extract variables and references, check integrity
    this.variables = this.book.getDefinedVariables(this.projectSources);
    this.variableReferences = this.book.getVariableReferences();
    this.book.checkVariableIntegrity(this.variables, this.variableReferences);
  }

  copyImages() {
    this.log(`Copying ${this.imageReferences.size} referenced images...`);
    for (let imageRef of this.imageReferences.values()) {
      let target = path.resolve(this.target, 'images', imageRef.key);
      fs.copySync(imageRef.path, target);
    }
  }

  log(msg) {
    this.book.log(msg);
  }

  /**
   * @abstract
   */
  $generate() {
    throw new Error('$generate: not implemented');
  }

  /**
   * @abstract
   */
  generate() {
    this.log(`Generating site in ${this.target}...`);
    fs.emptyDirSync(this.target);

    this.$generate();
  }

  _checkImageReferences() {
    for (let imgRef of this.imageReferences.values()) {
      if (imgRef.url.indexOf('/') !== -1) {
        throw new Error(
          `Illegal image URL (contains a "/"): "${imgRef.url}" in file "${imgRef.file}"`
        );
      }
      if (!fs.existsSync(imgRef.path)) {
        throw new Error(`Broken image reference "${imgRef.url}" in file "${imgRef.file}"`);
      }
    }
  }

  /**
   * @param {function(DokapiEntry, DokapiEntry?)} cb
   */
  forEntries(cb) {
    // main entry
    cb(this._mainEntry);

    // actual entries
    this.book.config.index.forEach(entry => {
      cb(entry);
      if (!entry.children) { return; }
      entry.children.forEach(subEntry => {
        cb(subEntry, entry);
      });
    });
  }

  /**
   * @returns {Map.<string, {key: string, url: string, file: string}>} indexed by absolute path
   */
  _getImageReferences() {
    /** @type {Map.<string, {key: string, url: string, file: string, contentKey: string}>} */
    const referencesByPath = new Map();

    // for collision detection
    const referencesByKey = new Map();

    this.log('Extract image references from markdown files...');

    const extractImageReferences = entry => {
      {
        if (!entry.content) { return; }
        const mdPath = this.book.resolveContent(entry.content);
        const mdBody = fs.readFileSync(mdPath, {encoding: 'utf8'});

        Utils.forEachMatch(mdBody, /!\[[^\]]*]\(([^)]+)\)/g, imageUrl => {
          if (!imageUrl.match(/^[A-Za-z0-9_.-]+$/)) {
            throw new Error(`Invalid image url: "${imageUrl}" in file "${entry.content}"`);
          }

          const imagePath = path.resolve(mdPath, '..', imageUrl);
          const imageRef = {
            key: entry.key + '__' + imageUrl,
            path: imagePath,
            url: imageUrl,
            file: mdPath,
            contentKey: entry.key
          };

          /// check for image collisions on "imageUrl"
          const imageRefCollision = referencesByKey.get(imageRef.key);
          if (imageRefCollision) {
            // two reference with same "key" and same "path" are Ok, just ignore the duplicate ref
            if (imageRef.path === imageRefCollision.path) { return; }

            throw new Error(
              `Image "${imageRef.url}" referenced in "${imageRef.file
              }" collides with other relative reference from "${imageRefCollision.file}".`
            );
          }

          referencesByKey.set(imageRef.key, imageRef);
          referencesByPath.set(imageRef.path, imageRef);
        });
      }
    };

    this.forEntries(entry => extractImageReferences(entry));

    return referencesByPath;
  }

  /**
   * @param {DokapiEntry} entry relative path of a markdown content file
   */
  generateHtml(entry) {

    /** @type {RenderContext} */
    const context = {
      pathToRoot: this.pathToRoot(entry),
      currentKey: entry.key
    };

    // generate variables
    // entry variables
    const entryVarOverrides = this.$makeEntryVariables(entry);
    // main menu variable
    entryVarOverrides.menu = this.renderMarkdown(this.book._generateMarkdownMainMenu(), context);

    // generate HTML body
    let htmlBody;
    const mdPath = this.book.resolveContent(entry.content);
    if (Utils.isFile(mdPath)) {
      // render Markdown template
      htmlBody = this.$getHtmlContent(mdPath, entryVarOverrides, context);
    } else {
      htmlBody = this.$generateMissingContentHtml(entry, context);
      entry.content = '[generated]';
    }

    this.$checkInternalLinks(htmlBody, entry.content);
    entryVarOverrides['entry.html.body'] = htmlBody;

    // render HTML page

    // fix paths in the HTML template
    let htmlPage = this.fixLinksRoot(this.htmlTemplateBody, this.pathToRoot(entry));

    // render HTML template
    htmlPage = this.renderTemplate(
      mdPath, // todo: should be the path to the html template
      htmlPage,
      entryVarOverrides,
      true
    );

    // tag links to current page
    htmlPage = htmlPage.replace(
      new RegExp(`href="([.]{1,2}/${entry.key})"`, 'g'),
      'href="$1" class="current"'
    );

    // removing zero-width spaces used as workaround in renderTemplate
    htmlPage = htmlPage.replace(/\u200B/g, '');

    if (this.book.config.externalLinksToBlank) {
      // make external link open in a new tab
      htmlPage = htmlPage.replace(
        /(href=["']https?:\/\/)/ig,
        'class="external" rel="noopener noreferrer" target="_blank" $1'
      );
    }

    //htmlPage = this.fixLinksRoot(htmlPage);

    return htmlPage;
  }

  //noinspection JSMethodCanBeStatic
  /**
   * Make all links absolute
   *
   * @param {string} html
   * @param {string} pathToRoot
   * @returns {string}
   */
  fixLinksRoot(html, pathToRoot) {
    return html.replace(/(href|src)=(["'])(\/)/ig, `$1=$2${pathToRoot}$3`);
  }

  /**
   * @abstract
   * @param {DokapiEntry} entry
   * @param {RenderContext} context
   * @returns {string}
   */
  $generateMissingContentHtml(entry, context) {
    throw new Error('$generateMissingContentHtml: not implemented');
  }

  /**
   * @param {string} markdownPath Markdown file path
   * @param {object} variableOverrides
   * @param {RenderContext} context
   * @returns {string}
   */
  $getHtmlContent(markdownPath, variableOverrides, context) {
    return this.renderMarkdown(
      this.$getMarkdownContent(markdownPath, variableOverrides, context),
      context
    );
  }

  /**
   * Generate variables that are specific to a given entry
   *
   * @param {DokapiEntry} entry
   * @returns {object} variable overrides for the markdown generator
   */
  $makeEntryVariables(entry) {
    const vars = {
      'entry.key': entry.key,
      'entry.title': entry.parent ? `${entry.parent.name}: ${entry.name}` : entry.name,
      'entry.root.path': this.pathToRoot(entry)
    };

    if (entry.children) {
      vars['entry.menu'] = this.makeMarkdownIndex(entry.children);
    }

    const prev = this.book.config.previousLink;
    vars['entry.previous'] = entry.previous
      ? `<a class="previous" href="${this.pathToRoot(entry)}/${entry.previous.key}">${prev}</a>`
      : `<a class="previous disabledLink" href="#">${prev}</a>`;

    const next = this.book.config.nextLink;
    vars['entry.next'] = entry.next
      ? `<a class="next" href="${this.pathToRoot(entry)}/${entry.next.key}">${next}</a>`
      : `<a class="next disabledLink" href="#">${next}</a>`;

    return vars;
  }

  /**
   *
   * @param {string} mdBody Markdown body
   * @param {RenderContext} context
   * @returns {string}
   */
  renderMarkdown(mdBody, context) {
    mdBody = this.fixMarkdownLinks(mdBody, context);
    return Utils.renderMarkdown(mdBody);
  }

  //noinspection JSMethodCanBeStatic
  /**
   * @param {string} mdBody
   * @param {RenderContext} context
   * @returns {string}
   */
  fixMarkdownLinks(mdBody, context) {
    // prefix links with path to root
    mdBody = mdBody.replace(
      /([^!]\[[^\]]*])\(\/([a-z0-9/#-]*)\)/g,
      `$1(${context.pathToRoot}/$2)`
    );

    if (context.currentKey !== '') {
      // prefix hash-only links with current content-key
      mdBody = mdBody.replace(
        /([^!]\[[^\]]*])\(#([a-z0-9-]+)\)/g,
        `$1(${context.pathToRoot}/${context.currentKey}/#$2)`
      );
    }

    // fix image links (relative to "images" folder)
    mdBody = mdBody.replace(
      /(!\[[^\]]*])\(([^)]+?)\)/ig,
      `$1(${context.pathToRoot}/images/${context.currentKey}__$2)`
    );

    return mdBody;
  }

  /**
   * @param {DokapiEntry[]} entryChildren
   * @return {string} a markdown list of sub-entries with links
   */
  makeMarkdownIndex(entryChildren) {
    const bullet = this.book.config.numbering ? '1.' : '-';
    return entryChildren.reduce((md, child) => {
      return `${md}\n${bullet} [${child.name}](/${child.key})`;
    }, '') + '\n';
  }

  //noinspection JSMethodCanBeStatic
  /**
   * @param {DokapiEntry} entry
   * @returns {string}
   */
  pathToRoot(entry) {
    return entry.key === '' ? '.' : '..';
  }

  /**
   * @param {string} mdPath
   * @param {object} variableOverrides
   * @param {RenderContext} context
   * @returns {string}
   */
  $getMarkdownContent(mdPath, variableOverrides, context) {
    let mdTemplate;
    try {
      mdTemplate = fs.readFileSync(mdPath, {encoding: 'utf8'});
    } catch(e) {
      throw new Error('Could not read file "' + mdPath + '": ' + e.message);
    }
    return this.renderTemplate(
      mdPath,
      mdTemplate,
      variableOverrides,
      context,
      false
    );
  }

  /**
   * @param {string} htmlBody
   * @param {string} mdPath
   * @throws {Error} if an internal link is broken.
   */
  $checkInternalLinks(htmlBody, mdPath) {
    Utils.forEachMatch(htmlBody, /\shref="([^"]+)"/g, url => {
      //console.log('>URL:'+JSON.stringify(url, null, ' '));
      let m;
      LINK_RELATIVE.lastIndex = 0;

      if (url.match(LINK_MAILTO) || url.match(LINK_HASH) || url.match(LINK_ABSOLUTE)) {
        // don't change mail-to/hash/absolute
        // hash links will fix prefixed with content-key in generateHtml
      } else if ((m = LINK_RELATIVE.exec(url))) {
        // remove leading "/" and "#anchor" part, then check for existence in entryKey index
        const entryKey = m[1];
        if (!this.entryKeys.has(entryKey)) {
          throw new Error(`Broken internal link "${url}" (to "${entryKey}") in file "${mdPath}"`);
        }
      } else {
        throw new Error(
          `Unexpected link URL: "${url}" in file "${mdPath}" ` +
          '(internal links must start with "/")'
        );
      }
    });
  }

  /**
   * @param {string} templatePath
   * @param {string} body The template body
   * @param {Object<String>} [variableOverrides={}]
   * @param {RenderContext} context
   * @param {boolean} [renderMarkdown=false]
   * @returns {*}
   */
  renderTemplate(templatePath, body, variableOverrides, context, renderMarkdown) {
    if (!variableOverrides) { variableOverrides = {}; }

    Utils.forReferences(body, referenceKey => {
      let value;

      if (this.book.isFileRef(referenceKey)) {
        const tag = referenceKey.startsWith('editfile:') ? 'textarea' : 'code';
        const filePath = this.book.getFileRefPath(templatePath, referenceKey);
        const ext = Utils.getExtension(filePath);
        let body = fs.readFileSync(filePath, {encoding: 'utf8'});
        if (tag === 'code') {
          value = '\n```' + ext + '\n' + body + '\n```\n';
        } else {
          // adding a zero-width space to prevent the markdown renderer from fucking up
          body = body.replace(/\n/g, '\u200B\n');
          value = '\n<' + tag + ' class="' + ext + '">' + '\n' + body + '\n</' + tag + '>\n';
        }

      } else if (referenceKey in variableOverrides) {
        value = variableOverrides[referenceKey];
      } else if (this.variables.has(referenceKey)) {
        value = this.variables.get(referenceKey).markdown && renderMarkdown
          ? this.renderMarkdown(this.variables.get(referenceKey).text, context)
          : this.variables.get(referenceKey).text;
      } else {
        throw new ReferenceError(
          `Variable reference "${referenceKey}" could not be resolved in "${templatePath}".`
        );
      }

      body = body.replace(new RegExp('\\{\\{' + referenceKey + '}}', 'g'), value);
    });

    return body;
  }

}

module.exports = AbstractGenerator;
