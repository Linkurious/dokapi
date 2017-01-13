'use strict';

const fs = require('fs-extra');
const path = require('path');
const Dokapi = require('./Dokapi');
const Utils = require('./Utils');

class DokapiParser {

  /**
   * Checks that the book.json file is correct.
   * Checks that all referenced files exist.
   *
   * @param {string} inputDirectory
   * @return {Dokapi} the parsed book
   */
  static parse(inputDirectory) {
    Utils.check.dir('input', inputDirectory);
    const configPath = path.resolve(inputDirectory, Dokapi.CONFIG_FILE);
    inputDirectory = path.resolve(inputDirectory);

    let fileContent;
    try {
      fileContent = fs.readFileSync(configPath, {encoding: 'utf8'});
    } catch(e) {
      throw new Error(`Could not read file "${configPath}: ${e.message}`);
    }

    let bookContent;
    try {
      bookContent = JSON.parse(fileContent);
    } catch(e) {
      throw new Error(`Could not parse JSON content of "${configPath}": ${e.message}`);
    }

    const referencedContent = DokapiParser._validate(inputDirectory, bookContent);

    return new Dokapi(inputDirectory, bookContent, referencedContent);
  }

  /**
   * @param {string} rootPath The main directory
   * @param {object} book
   * @return {Array<string>} all referenced files
   * @private
   */
  static _validate(rootPath, book) {
    const referencedFiles = [];

    // check that the .book.json file format is connect
    // check that all files referenced in "content" do exist in `dir`
    const checkFilePath = (key, value) => {
      Utils.check.regexp(key, value, /^[a-z0-9/-]+\.md$/);
      let filePath = path.resolve(rootPath, Dokapi.CONTENT_DIR, value);
      referencedFiles.push(filePath);
    };
    Utils.check.properties('book', book, {
      name: {required: true, type: 'string'},
      project: {required: true, check: 'nonEmpty'},
      description: {required: true, check: checkFilePath},
      variables: {required: true, type: 'object'},
      siteTemplate: {required: true, check: ['file', rootPath]},
      pageTemplate: {required: true, check: ['file', rootPath]},
      numbering: {required: false, type: 'boolean'},
      externalLinksToBlank: {required: false, type: 'boolean'},
      assets: {required: true, check: ['dir', rootPath]},
      index: {
        required: true,
        arrayItem: {
          properties: {
            name: {required: true, type: 'string'},
            key: {required: false, type: 'string'},
            content: {requiredUnless: 'children', check: checkFilePath},
            children: {required: false, arrayItem: {
              properties: {
                name: {required: true, type: 'string'},
                key: {required: false, type: 'string'},
                content: {required: true, check: checkFilePath}
              }
            }}
          }
        }
      }
    });

    return referencedFiles;
  }

}

module.exports = DokapiParser;
