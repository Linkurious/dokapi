'use strict';

const fs = require('fs-extra');
const path = require('path');
const Utils = require('./Utils');
const AbstractGenerator = require('./AbstractGenerator');

class PdfGenerator extends AbstractGenerator {

  /**
   * @param {DokapiBook} book
   * @param {string} target
   * @param {string} projectSources
   */
  constructor(book, target, projectSources) {
    super(
      book,
      path.resolve(target, 'page'),
      projectSources,
      `
       <h1 style="page-break-before: always"><a id="{{entry.key}}__">&nbsp;</a>{{entry.title}}</h1>
       {{entry.html.body}}`
    );
  }

  /**
   *
   */
  $generate() {
    // single page template
    const htmlTemplatePath = this.book._path(this.book.config.pageTemplate);
    const htmlTemplate = fs.readFileSync(htmlTemplatePath, {encoding: 'utf8'});
    const templateParts = htmlTemplate.split('{{body}}', 2);

    const targetFile = path.resolve(this.target, 'index.html');
    const context = {
      pathToRoot: '.',
      currentKey: ''
    };

    /** @type {number} */
    const htmlFd = fs.openSync(targetFile, 'a');
    const appendHtml = (str) => fs.writeSync(htmlFd, str);

    this.log('Generating HTML content from Markdown templates...');

    // html template (prefix)
    appendHtml(
      this.fixLinksRoot(
        this.resolveVariables(htmlTemplatePath, templateParts[0], {}, context),
        '.'
      )
    );

    this.forEntries((entry) => {
      // don't print hidden entries
      if (entry.hidden) { return; }

      appendHtml(this.generateHtml(entry));
    });

    // html template (suffix)
    appendHtml(
      this.fixLinksRoot(
        this.resolveVariables(htmlTemplatePath, templateParts[1], {}, context),
        '.'
      )
    );

    fs.closeSync(htmlFd);

    const assetsSource = this.book._path(this.book.config.assets);
    const assetsTarget = path.resolve(this.target, path.basename(assetsSource));
    this.log(`Copying assets from "${assetsSource}"...`);
    fs.copySync(assetsSource, assetsTarget);

    this.copyImages();

    // todo: use https://www.npmjs.com/package/pdfcrowd to generate a PDF with working anchor links
    // this.log(`Generating PDF file...`);
    // const options = { format: 'Letter' };
    // const html = fs.readFileSync(targetFile, {encoding: 'utf8'});
    // pdf.create(html, options).toFile(path.resolve(this.target, 'index.pdf'), function(err, res) {
    //   if (err) return console.log(err);
    //   console.log(res);
    // });
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
   * @param {DokapiEntry} entry
   * @returns {string}
   */
  pathToRoot(entry) {
    return '.';
  }

  generateHtml(entry) {
    // skip empty entries in page mode
    if (!entry.content) { return ''; }

    const html = super.generateHtml(entry);
    // - fix title anchors
    // - will not break page anchors: they already contain "__" at the end and will not match
    return html.replace(
      /<a id="([a-z0-9-]+)"\s(class="deep-link")\shref="#[a-z0-9-]+"/g,
      '<a id="' + entry.key + '__$1" $2 href="#' + entry.key + '__$1"'
    );
  }

  fixMarkdownLinks(mdBody, context) {
    //var mbBody = super.fixMarkdownLinks(mdBody, context);

    // fix internal links (make anchors)
    mdBody = mdBody.replace(/([^!]\[[^\]]*?])\(\/([^)]+?)(?:\/#([^)]+?))?\)/ig, '$1(#$2__$3)');

    // fix image links (relative to "images" folder)
    mdBody = mdBody.replace(
      /(!\[[^\]]*])\(([^)]+?)\)/ig,
      `$1(${context.pathToRoot}/images/${context.currentKey}__$2)`
    );

    return mdBody;
  }

  $checkInternalLinks(htmlBody, mdPath) {
    Utils.forEachMatch(htmlBody, /\shref="#([^"_]+?)__([^"]*)"/ig, key => {
      if (!this.entryKeys.has(key)) {
        throw new Error(`Broken internal link "${key}" in file "${mdPath}"`);
      }
    });
  }
}

module.exports = PdfGenerator;
