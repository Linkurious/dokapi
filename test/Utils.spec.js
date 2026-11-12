/**
 * LINKURIOUS CONFIDENTIAL
 * Copyright Linkurious SAS 2012 - 2019
 *
 * - Created on 2019-05-09.
 */
'use strict';

const Utils = require('../src/classes/Utils');
const {describe, it} = require('node:test');
const assert = require('node:assert/strict');

describe('Utils.forReferences', () => {

  it('should be empty none from empty string', () => {
    const rs = [];
    Utils.forReferences('', (r) => rs.push(r));
    assert.deepEqual(rs, []);
  });

  it('should find a normal ref', () => {
    const rs = [];
    Utils.forReferences('{{abc}}', (r) => rs.push(r));
    assert.deepEqual(rs, ['abc']);
  });

  it('should find two normal refs', () => {
    const rs = [];
    Utils.forReferences('{{abc}} lol {{def}}', (r) => rs.push(r));
    assert.deepEqual(rs, ['abc', 'def']);
  });

  it('should find two consecutive refs', () => {
    const rs = [];
    Utils.forReferences('{{abc}}{{def}}', (r) => rs.push(r));
    assert.deepEqual(rs, ['abc', 'def']);
  });

  it('should find two consecutive refs with line break', () => {
    const rs = [];
    Utils.forReferences('{{abc}}\n{{def}}', (r) => rs.push(r));
    assert.deepEqual(rs, ['abc', 'def']);
  });

  it('should ignore escaped refs', () => {
    const rs = [];
    Utils.forReferences('{{abc}} lol \\{{def}}', (r) => rs.push(r));
    assert.deepEqual(rs, ['abc']);
  });

});
