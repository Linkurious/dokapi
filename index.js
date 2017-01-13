#!/usr/bin/env node
'use strict';

const path = require('path');
const cli = require('commander');
const Utils = require('./src/classes/Utils');
const DokapiParser = require('./src/classes/DokapiParser');

const printError = (e, stack) => {
  console.log('\x1b[31m' + (stack ? e.stack : e.message) + '\x1b[0m');
};

cli
  .option('-i, --input <directory>', 'Set the input directory')
  .option('-o, --output <directory>', 'Set the output directory')
  .option('-w, --watch', 'Watch the input and re-generate the output on changes')
  .option('-c, --create-missing', 'Create missing referenced Markdown files')
  .option('-r, --refresh-project', 'Force to re-clone the input project')
  .option('-t, --output-type <type>', 'Choose the output type', 'site')
  .parse(process.argv);

try {
  Utils.check.dir('input', cli.input);
  Utils.check.dir('output', cli.output);
  Utils.check.values('output-type', cli.outputType, ['pdf', 'site'], true);
} catch(e) {
  printError(e);
  process.exit(1);
}

console.log('MDoc generator:');
for (let k of ['input', 'output', 'outputType', 'watch', 'createMissing', 'refreshProject']) {
  console.log(' - ' + k + ': ' + cli[k]);
}

/**
 * @param {number} duration
 * @param {function} fn
 * @returns {Function}
 */
const debounce = (duration, fn) => {
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
};

const doGenerate = () => {
  const t = Date.now();
  const book = DokapiParser.parse(cli.input);
  book.log = function(m) { console.log(' * ' + m); };
  book.generate(cli.outputType, cli.output, cli.refreshProject, cli.createMissing);
  book.log(`Generated in ${((Date.now() - t) / 1000).toFixed(2)}s :)`);
};

const doWatch = (folder, action) => {
  const watch = require('watch');
  watch.watchTree(folder, debounce(100, () => {
    console.log('Watched folder changed...');
    try {
      action();
    } catch(e) {
      console.log('GENERATION FAILED');
      printError(e, true);
    }
  }));
};

if (cli.watch) {
  doWatch(cli.input, doGenerate);
} else {
  doGenerate();
}
