/**
 * @fileoverview JSModuleResolver.
 */

"use strict";
var EXPORTED_SYMBOLS = ["JSModuleResolver"];

const Cu = Components.utils;

Cu.import('resource://slimerjs/slUtils.jsm');  // slUtils


/**
 * Resolves JS module ids to file URIs. Looks for JS files in given directories.
 *
 * @param {!Array<String>} possibleDirs Directories where to look for JS files.
 * @constructor
 */
// TODO: Remove code duplication with resolver in slLaucher.jsm.
var JSModuleResolver = function(possibleDirs) {
  this._possibleDirs = possibleDirs;
};

/**
 * @param {!String} path JS module id, eg. "path/to/module", possibly w/o .js.
 * @return {!String} file URI if found.
 */
JSModuleResolver.prototype.resolveModuleIdToUri = function(moduleId) {
  if (moduleId.startsWith('/')) {
    return 'file://' + moduleId;  // Absolute.
  } else {
    for (var i = 0; this._possibleDirs[i] !== undefined; i++) {
      var possibleFullPaths = [_joinPaths(this._possibleDirs[i], moduleId)];
      if (!possibleFullPaths[0].endsWith('.js')) {
        possibleFullPaths.push(possibleFullPaths[0] + '.js');
      }

      for (var j = 0; possibleFullPaths[j]; j++) {
        if (slUtils.getMozFile(possibleFullPaths[j]).exists()) {
          return 'file://' + possibleFullPaths[j];
        }
      }
    }
    throw new Error('Could not resolve path: ' + moduleId);
  }
};

var _joinPaths = function(dir, path) {
  if (path.startsWith('/')) {
    return path;
  } else if (dir.endsWith('/')) {
    return dir + path;
  } else {
    return dir + '/' + path;
  }
};
