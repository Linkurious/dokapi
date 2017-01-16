#!/usr/bin/env node
'use strict';

const Utils = require('./classes/Utils');
const DokapiParser = require('./classes/DokapiParser');

class Dokapi {

  /**
   * @param {object} options
   * @param {string} options.input Input folder path
   * @param {string} options.output Output folder path
   * @param {string} options.outputType Output type ("site" or "page")
   * @param {boolean} options.watch Whether to keep watching the input folder and re-generate the output on changes.
   * @param {boolean} options.createMissing Whether to create missing referenced markdown files.
   * @param {boolean} options.refreshProject Whether to refresh the copy (clone) of the code project.
   * @param {object} [logger]
   * @param {function(string)} [logger.info]
   * @param {function(string)} [logger.error]
   */
  constructor(options, logger) {
    if (!logger) { logger = {}; }

    /** @type {function} */
    this.$logInfo = logger.info || console.log;

    /** @type {function} */
    this.$logError = logger.error || logger.info || console.error;

    this.options = options;
  }

  printInfo(msg) {
    this.$logInfo(msg);
  }

  printError(error, printStack) {
    this.$logError('\x1b[31m' + error.message + '\x1b[0m');
    if (printStack) {
      this.$logError('\x1b[214m' + error.stack + '\x1b[0m');
    }
  }

  /**
   * Debounce `fn` of `duration` milliseconds.
   * Prevents `fn` to be called more than once every `duration` milliseconds.
   *
   * @param {number} duration Debounce duration in milliseconds.
   * @param {function} fn The function to debounce.
   * @returns {Function} The debounced wrapper to `fn`.
   * @protected
   */
  static $debounce(duration, fn) {
    let active = false;
    return function() {
      const orgThis = this;
      const orgArgs = Array.prototype.slice.call(arguments, 0);

      // first call of the sequence
      if (!active) {
        active = true;
        setTimeout(() => {
          active = false;
          fn.apply(orgThis, orgArgs);
        }, duration);
      }
    };
  }

  /**
   * @param {string} folder
   * @param {function} action Called when `folder` changes
   */
  $watch(folder, action) {
    const watch = require('watch');
    watch.watchTree(folder, Dokapi.$debounce(100, () => {
      this.printInfo('Watched folder changed...');
      try {
        action();
      } catch(e) {
        this.printInfo('GENERATION FAILED');
        this.printError(e);
      }
    }));
  }

  $generate() {
    const t = Date.now();
    const book = DokapiParser.parse(this.options.input);
    book.log = m => {
      this.printInfo(' * ' + m);
    };
    book.generate(
      this.options.outputType,
      this.options.output,
      this.options.refreshProject,
      this.options.createMissing
    );
    book.log(`Generated in ${((Date.now() - t) / 1000).toFixed(2)}s :)`);
  }

  run() {
    this.printInfo('Dokapi generator:');
    for (let k of ['input', 'output', 'outputType', 'watch', 'createMissing', 'refreshProject']) {
      this.printInfo(' - ' + k + ': ' + this.options[k]);
    }

    if (this.options.watch) {
      this.$watch(this.options.input, () => this.$generate());
    } else {
      this.$generate();
    }
  }
}

if (require.main === module) {
  // called directly

  const cli = require('commander');
  cli
    .option('-i, --input <directory>', 'Set the input directory')
    .option('-o, --output <directory>', 'Set the output directory')
    .option('-w, --watch', 'Watch the input and re-generate the output on changes')
    .option('-c, --create-missing', 'Create missing referenced Markdown files')
    .option('-r, --refresh-project', 'Force to re-clone the input project')
    .option('-t, --output-type <type>', 'Choose the output type', 'site')
    .parse(process.argv);
  const dokapi = new Dokapi(cli);

  try {
    dokapi.run();
  } catch(e) {
    dokapi.printError(e);
    process.exit(1);
  }
} else {
  // required as a module
  module.exports = Dokapi;
}
