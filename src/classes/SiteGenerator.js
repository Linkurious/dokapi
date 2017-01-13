/**
 * LINKURIOUS CONFIDENTIAL
 * Copyright Linkurious SAS 2012 - 2016
 *
 * - Created by david on 2016-12-29.
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const Utils = require('./Utils');
const AbstractGenerator = require('./AbstractGenerator');

class SiteGenerator extends AbstractGenerator {

  /**
   * @param {Dokapi} book
   * @param {string} target
   * @param {string} projectSources
   */
  constructor(book, target, projectSources) {
    super(
      book,
      path.resolve(target, 'site'),
      projectSources,
      fs.readFileSync(book._path(book.config.siteTemplate), {encoding: 'utf8'})
    );
  }

  /**
   *
   */
  $generate() {
    this.log('Generating HTML content from Markdown templates...');
    this.generateHtmlFile(
      this.target,
      this.getMainEntry()
    );

    this.forEntries(entry => {
      // make entry dir + file
      let entryTargetPath = path.resolve(this.target, entry.key);
      fs.emptyDirSync(entryTargetPath);
      this.generateHtmlFile(entryTargetPath, entry);
    });

    const assetsSource = this.book._path(this.book.config.assets);
    const assetsTarget = path.resolve(this.target, path.basename(assetsSource));
    this.log(`Copying assets from "${assetsSource}"...`);
    fs.copySync(assetsSource, assetsTarget);

    this.copyImages();
  }

  /**
   * @param {string} targetPath
   * @param {Entry} entry
   */
  generateHtmlFile(targetPath, entry) {
    fs.writeFileSync(
      path.resolve(targetPath, 'index.html'),
      this.generateHtml(entry)
    );
  }

  /**
   * @param {Entry} entry
   * @param {RenderContext} context
   * @returns {string}
   */
  $generateMissingContentHtml(entry, context) {
    return this.renderMarkdown(this.makeMarkdownIndex(entry.children), context);
  }
}

module.exports = SiteGenerator;
