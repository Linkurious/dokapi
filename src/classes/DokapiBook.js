'use strict';

const fs = require('fs-extra');
const path = require('path');
const Utils = require('./Utils');
const SiteGenerator = require('./SiteGenerator');
const PdfGenerator = require('./PdfGenerator');

/**
 * @typedef {object} DokapiEntry
 * @property {string} key Entry key
 * @property {string} name Entry name
 * @property {boolean|undefined} hidden Whether this entry is hidden (not show in menu and single-page)
 * @property {string} content Markdown file path
 * @property {DokapiEntry|undefined} parent Parent entry (if any)
 * @property {DokapiEntry|undefined} next Next entry (if any)
 * @property {DokapiEntry|undefined} previous Previous entry (if any)
 * @property {DokapiEntry[]|undefined} children Sub-entries
 */

/**
 * @typedef {object} Variable
 * @property {string} key Unique key of the variable.
 * @property {string} text Text content of this variable.
 * @property {string} file JS file in which this variable is defined.
 * @property {boolean|undefined} builtin Whether this is a builtin variable (true = will not fail if not used).
 */

/**
 * @typedef {object} Reference
 * @property {string} key Variable key to which this reference points to.
 * @property {string} file Markdown file in which the reference was found.
 */

class DokapiBook {
  /**
   *
   * @param {string} rootDir
   * @param {Object} config
   * @param {string} config.project
   * @param {boolean} [config.skipProjectVariables=false]
   * @param {string} config.name
   * @param {string} config.assets
   * @param {boolean} [config.numbering]
   * @param {boolean} [config.externalLinksToBlank]
   * @param {string} config.siteTemplate HTML template file for site output
   * @param {string} config.pageTemplate HTML template file for page output
   * @param {string} config.previousLink
   * @param {string} config.nextLink
   * @param {object} config.main
   * @param {string} config.main.content path to main-entry MD file
   * @param {string} [config.main.name="Introduction"] name of the main-entry
   * @param {DokapiEntry[]} config.index
   * @param {Object<String>} config.variables
   * @param {string[]} referencedContent
   * @param {object} [options]
   * @param {string} [options.annotation="dokapi"] The annotation used to extract code variables.
   */
  constructor(rootDir, config, referencedContent, options) {
    this.rootDir = rootDir;

    this.config = config;
    if (!this.config.main.name) { this.config.main.name = 'Introduction'; }
    if (!this.config.previousLink) { this.config.previousLink = 'Previous'; }
    if (!this.config.nextLink) { this.config.nextLink = 'Next'; }

    /** @type {string[]} */
    this.referencedContent = referencedContent;
    this.options = Utils.defaults(options, {annotation: 'dokapi'});

    this._assignKeys();
    this.checkOrphanContent();
  }

  /**
   * @returns {string}
   */
  static get CONFIG_FILE() { return 'dokapi.json'; }

  /**
   * @returns {string}
   */
  static get CONTENT_DIR() { return 'content'; }

  checkOrphanContent() {
    // check that all content files in `rootDir`/content are referenced in `config`
    const markdownContent = Utils.getAllFiles(this._path(DokapiBook.CONTENT_DIR), /\.md$/);
    const notReferenced = Utils.difference(markdownContent, this.referencedContent);
    if (notReferenced.length > 0) {
      throw new Error('Some Markdown files are not referenced:\n' + notReferenced.join('\n'));
    }
  }

  /**
   * @param {string} relativePath
   * @param {string} [subPath]
   * @returns {string} path resolved in `rootDir`
   */
  _path(relativePath, subPath) {
    if (subPath !== undefined) {
      return path.resolve(this.rootDir, relativePath, subPath);
    } else {
      return path.resolve(this.rootDir, relativePath);
    }
  }

  /**
   * @param {string} content relative content path
   * @returns {string} absolute path
   */
  resolveContent(content) {
    return this._path(DokapiBook.CONTENT_DIR, content);
  }

  /**
   * Automatically assign keys to entries in this.config.index that do not have one.
   * Checks that entry keys are unique.
   */
  _assignKeys() {
    // assign default keys and check uniqueness
    const keys = new Set();
    const ensureEntryKey = (entry) => {
      if (entry.key === undefined) {
        entry.key = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      }
      if (keys.has(entry.key)) {
        throw new Error('Duplicate entry key in index: ' + entry.key);
      } else {
        keys.add(entry.key);
      }
    };
    this.config.index.forEach(mainEntry => {
      ensureEntryKey(mainEntry);
      if (!mainEntry.children) { return; }
      mainEntry.children.forEach(subEntry => {
        ensureEntryKey(subEntry);
      });
    });
  }

  _checkMarkdownFiles(createMissing) {
    this.log(`Check all markdown files (creating missing: ${createMissing})...`);
    this.referencedContent.forEach(filePath => {
      if (createMissing && !fs.existsSync(filePath)) {
        fs.ensureFileSync(filePath);
        fs.writeFileSync(filePath, `<!-- todo: ${path.basename(filePath)} -->`, {encoding: 'utf8'});
      } else {
        Utils.check.file('file', filePath);
      }
    });
  }

  /**
   * @param {string} outputType 'site' or 'page'
   * @param {string} outputDir Output directory
   * @param {boolean} [forceDownloadProject=false]
   * @param {boolean} [createMissingMarkdown=false]
   */
  generate(outputType, outputDir, forceDownloadProject, createMissingMarkdown) {
    Utils.check.values('outputType', outputType, ['page', 'site'], true);

    // if the output dir does not exist, create it
    if (!fs.existsSync(outputDir)) {
      fs.emptyDirSync(outputDir);
    }

    // check that the output is a directory (if it existed already)
    Utils.check.dir('output', outputDir);

    // noinspection PointlessBooleanExpressionJS
    this._checkMarkdownFiles(!!createMissingMarkdown);

    // get project code
    const projectSources = this._getProjectSources(outputDir, forceDownloadProject);

    let generator;
    if (outputType === 'site') {
      generator = new SiteGenerator(this, outputDir, projectSources);
    } else if (outputType === 'page') {
      generator = new PdfGenerator(this, outputDir, projectSources);
    } else {
      throw new Error(`Unknown output type: ${outputType}.`);
    }
    generator.generate();
  }

  /**
   * @param {string} outputDir
   * @param {boolean} forceDownloadProject
   * @return {string} project sources directory
   * @private
   */
  _getProjectSources(outputDir, forceDownloadProject) {
    if (!this.config.project) {
      this.projectType = 'none';
    } else if (this.config.project.startsWith('git@')) {
      this.projectType = 'github';
      const projectSourcesTarget = path.resolve(outputDir, 'project');
      if (!fs.existsSync(projectSourcesTarget) || forceDownloadProject) {
        this.log(`Cloning project code (${this.config.project}) to ${projectSourcesTarget}...`);
        Utils.gitClone(this.config.project, projectSourcesTarget);
      } else {
        this.log(`Using cached copy of project from ${projectSourcesTarget}...`);
      }
      return projectSourcesTarget;
    } else {
      this.projectType = 'local';
      const projectSourcePath = path.isAbsolute(this.config.project)
        ? this.config.project
        : path.resolve(this.rootDir, this.config.project);
      this.log(`Using local project sources at "${projectSourcePath}".`);
      Utils.check.dir('config.project', projectSourcePath);
      return projectSourcePath;
    }
  }

  /**
   * @param {string} projectSources
   * @returns {Map.<string, Variable>}
   */
  getDefinedVariables(projectSources) {
    const annotation = this.options.annotation;

    /** @type {Map<string, Variable>} */
    const variables = new Map();

    if (this.projectType === 'none') {
      this.log('Skipping code variable extraction (no code project).');
    } else {

      if (!this.config.skipProjectVariables) {
        this.log(`Extracting @${annotation} variable from project code...`);
        Utils.getAllFiles(projectSources, /\.js$/, /node_modules/).forEach(jsFile => {
          Utils.extractComments(jsFile).forEach(comment => {
            if (!(annotation in comment.keys)) {
              return;
            }
            let key = comment.keys[annotation];
            let text = comment.lines.join('\n');
            variables.set(key, {text: text, key: key, file: jsFile, markdown: true});
          });
        });
      }

      // extract package.json string variables
      const packagePath = path.resolve(projectSources, 'package.json');
      const packageInfo = fs.readJsonSync(packagePath, {encoding: 'utf8'});
      for (let key in packageInfo) {
        if (!packageInfo.hasOwnProperty(key) || typeof packageInfo[key] !== 'string') {
          continue;
        }
        let varKey = 'package.' + key;
        variables.set(
          varKey,
          {key: varKey, text: packageInfo[key], builtin: true, markdown: false, file: packagePath}
        );
      }

      variables.set(
        'config.name',
        {
          key: 'config.name',
          text: this.config.name,
          builtin: true,
          markdown: false,
          file: path.resolve(this.rootDir, DokapiBook.CONFIG_FILE)
        }
      );
    }

    // loading builtin variables
    Object.keys(this.config.variables).forEach(variableKey => {
      variables.set(variableKey, {
        key: variableKey + '',
        text: this.config.variables[variableKey],
        builtin: true,
        file: DokapiBook.CONFIG_FILE,
        markdown: false
      });
    });

    // generating the current timestamp (in milliseconds)
    variables.set('now', {
      key: 'menu',
      text: Date.now() + '',
      builtin: true,
      markdown: false,
      file: DokapiBook.CONFIG_FILE
    });

    // resolve variables inside variables (once)
    variables.forEach(v => {
      Utils.forReferences(v.text, referenceKey => {
        if (variables.has(referenceKey)) {

          //console.log('BEFORE: ' + v.text);

          v.text = v.text.replace(
            new RegExp('\\{\\{' + referenceKey + '}}', 'g'),
            variables.get(referenceKey).text
          );

          //console.log('AFTER: ' + v.text);
        }
      });
    });

    return variables;
  }

  /**
   * @returns {Map.<string, Reference>}
   */
  getVariableReferences() {
    /** @type {Map<string, Reference>} */
    const references = new Map();

    this.log('Extract block references from markdown files...');
    this.referencedContent.forEach(mdFile => {
      const mdBody = fs.readFileSync(mdFile, {encoding: 'utf8'});
      Utils.forReferences(mdBody, referenceKey => {
        references.set(referenceKey, {file: mdFile, key: referenceKey});
      });
    });

    return references;
  }

  // noinspection JSMethodCanBeStatic
  /**
   * @param {string} referenceKey
   * @returns {boolean}
   */
  isFileRef(referenceKey) {
    return referenceKey.startsWith('file:') || referenceKey.startsWith('editfile:');
  }

  // noinspection JSMethodCanBeStatic
  /**
   * @param {string} referrerPath
   * @param {string} fileReference
   * @returns {string} the target file path (guaranteed to exist)
   */
  getFileRefPath(referrerPath, fileReference) {
    const templateFolder = path.dirname(referrerPath);
    // strip file reference prefix, then resolve absolute path (relative to containing file)
    const filePath = path.resolve(
      templateFolder,
      fileReference.substr(fileReference.indexOf(':') + 1)
    );
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch(e) {
      throw new ReferenceError(
        `Could not resolve file reference: "${fileReference}" for "${referrerPath}": ${e.message}`
      );
    }
    if (!stat.isFile()) {
      throw new ReferenceError(
        `Target of file reference: "${fileReference}" in "${referrerPath}" is not a file.`
      );
    }
    return filePath;
  }

  /**
   * @param {Map<string, Variable>} variables
   * @param {Map<string, Reference>} references
   */
  checkVariableIntegrity(variables, references) {
    this.log('Checking variables/references integrity...');
    const errors = [];
    for (let reference of references.values()) {
      if (reference.key.startsWith('entry.')) {
        // ignore entry-specific variables

      } else if (this.isFileRef(reference.key)) {
        // check file reference
        this.getFileRefPath(reference.file, reference.key);

      } else if (!variables.has(reference.key)) {
        errors.push(`Reference "${reference.key}" used in "${reference.file}" is never defined.`);
      }
    }
    for (let variable of variables.values()) {
      // don't fail if a builtin variable is not used
      if (variable.builtin) { continue; }
      if (!references.has(variable.key)) {
        errors.push(`Variable "${variable.key}" defined in "${variable.file}" is never used.`);
      }
    }
    if (errors.length) {
      throw new Error(errors.join('\n'));
    }
  }

  // noinspection JSMethodCanBeStatic
  log(msg) {
    console.log(msg);
  }

  /**
   * @returns {string}
   */
  _generateMarkdownMainMenu() {
    //this.log(`Generating main menu...`);
    const bullet = this.config.numbering ? '1.' : '-';
    return `${bullet} [${this.config.main.name}](/)\n${
      this.__generateMarkdownMenu('', bullet, this.config.index)
    }`;
  }

  /**
   * @param {string} indent The indentation level
   * @param {string} bullet '-' or '1.'
   * @param {DokapiEntry[]} entries
   * @returns {string} html
   * @private
   */
  __generateMarkdownMenu(indent, bullet, entries) {
    return entries.reduce((menu, entry) => {
      if (entry.hidden) { return menu; }
      return menu + indent + `${bullet} [${entry.name}](/${entry.key})\n` +
        (entry.children ? this.__generateMarkdownMenu(indent + '   ', bullet, entry.children) : '');
    }, '');
  }
}

module.exports = DokapiBook;
