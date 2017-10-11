/**
 * @fileoverview WindowScope.
 */

"use strict";
var EXPORTED_SYMBOLS = ["WindowScope"];

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import('resource://slimerjs/slConsole.jsm');
Cu.import('resource://slimerjs/slDebug.jsm');
Cu.import('resource://slimerjs/jsModuleResolver.jsm');  // JSModuleResolver.
const { loadSubScript } = Cc['@mozilla.org/moz/jssubscript-loader;1']
	                  .getService(Ci.mozIJSSubScriptLoader);

/**
 * Browser content window scope. Execution scope for user modules that is
 * possibly close to that of a real browser.
 * 
 * The role of this class is to load and run designated scripts in a window
 * scope that behaves in the same way as the global scope of page scripts
 * in a browser. The goal is to test scripts in their target execution
 * environment - browser.
 *
 * Specifically,
 *  - The global object is a {@code Window} object.
 *  - Built-in browser JavaScript global objects are available, eg.
 *      {@code WebSocket}, {@code console}.
 *
 * Additionally, special global objects are defined:
 *  - {@code require()} CommonJS module import mechanism.
 *  - {@code slimer} For controlling the browser process {@see slimer.jsm}.
 *
 * {@code require()} implementation loads each module into a dedicated subscope
 * of the window scope. This achieves module isolation *and* sharing of
 * the window scope.
 *
 * Modules are loaded via {@code Services.scriptloader.loadSubScript()}.
 * *
 * @param {!Window} window Window object. The scope that modules are loaded into.
 * @param {Array<!String>=} opt_jsPath Directories where to resolve module paths
 *     imported via (passed to) {@code require()}.
 * @constructor
 */
var WindowScope = function(window, opt_jsPath) {
  this._window = window;
  // Cache of modules loaded via require in user code.
  // Module uri -> module exports.
  this._modules = {};
  // For compatibility with prepareLoader. TODO: remove.
  this.modules = this._modules;

  /** @private {JSModuleResolver} Resolves JS module ids to file URIs. */
  this._jsModuleResolver =
    new JSModuleResolver(opt_jsPath ? [''].concat(opt_jsPath) : ['']);
  
  this._createGlobals();
};

/**
 * Creates special symbols in the global window scope:
 * {@code console}, {@code require}, {@code slimer}.
 */ 
WindowScope.prototype._createGlobals = function() {
  // Create 'console'.
  _exportObject(new slConsole(), this._window, {defineAs: 'console'});

  // Create 'require'.
  Cu.exportFunction(
    this._require.bind(this), this._window, {defineAs: 'require'});

  // Create 'slimer'.
  // TODO: Remove duplication with prepareLoader().
  // TODO: More work is needed to properly pass these objects to
  // a less-privileged scope.
  Cu.import('resource://slimerjs/slimer-sdk/slimer.jsm');  // slimer
  _exportObject(slimer, this._window, {defineAs: 'slimer'});
  // Cu.import('resource://slimerjs/slimer-sdk/phantom.jsm');  // phantom
  // _exportObject(phantom, this._window, {defineAs: 'phantom'});
};

/**
 * Loads given module into window scope. Executes its code.
 *
 * To be called from chrome code, specifically from slimer setup code.
 * The signature is that expected by slimer setup code.
 * 
 * @param {!Loader} loaderUnused.
 * @param {!{id: String, uri: String}} module Module to load.
 */
WindowScope.prototype.load = function(loaderUnused, module) {
  this.loadFromURI(module.uri);
};

/**
 * Loads given script into window scope. Executes its code.
 *
 * To be called from chrome code.
 *
 * @param {!String} uri Script to load.
 */
WindowScope.prototype.loadFromURI = function(uri) {
  loadSubScript(uri, this._window);
};

/**
 * Loads given CommonJS module into window scope. Executes its code.
 *
 * Implementation of {@code require()}. Called from user code.
 * 
 * @param {!String} modulePath Path to a CommonJS module, possibly without .js.
 *    The path is resolved wrt. directories passed via {@code --js-path} flag.
 * @return {!Object} Exported symbols, value of the module's
 *   {@code module.exports} object.
 */
WindowScope.prototype._require = function(modulePath) {
  // Find the module file.
  var moduleUri = this._jsModuleResolver.resolveModuleIdToUri(modulePath);
  if (DEBUG_REQUIRE) {
    slDebugLog('require(\'' + modulePath + '\') -> ' + moduleUri);
  }

  if (!(moduleUri in this._modules)) {
    // Module not loaded yet. Load and cache.
    // Create a dedicated module scope nested inside window scope.
    var moduleId = '__module__' + _uriToId(moduleUri);
    var moduleScope = Cu.createObjectIn(this._window, {defineAs: moduleId});
    // Create a placeholder for the require()'d module's exports.
    var module = Cu.createObjectIn(moduleScope, {defineAs: 'module'});
    var module_exports = Cu.createObjectIn(module, {defineAs: 'exports'});
    // In module scope, create a reference to module.exports named exports.
    // Equivalent to 'var exports = module.exports' in module scope.
    // https://stackoverflow.com/a/16383925/2131969
    moduleScope.exports = module_exports;
    // Load the module.
    loadSubScript(moduleUri, moduleScope);
    // Cache the module - cache its exports.
    this._modules[moduleUri] = module.exports;
    if (DEBUG_REQUIRE) {
      slDebugLog('require(\'' + modulePath + '\') module.exports = { '
                 + Object.keys(module.exports).join(', ') + ' }');
    }
  }

  return this._modules[moduleUri];
};


/**
 * Exports an object into a less privileged scope, allowing the code in the
 * less privileged scope to call the object's methods.
 *
 * Note: This is a working equivalent of {@code Components.utils.cloneInto()}.
 * It is modeled after {@code Components.utils.exportFunction()}, which works.
 * {@code cloneInto()} does not seem to work with {@code Window} object.
 *
 * @param {!Object} obj Object to export.
 * @param {!Object} targetScope Object to attach the exported object to.
 * @param {!Object} opt_options Optional parameters. defineAs.
 */
var _exportObject = function(obj, targetScope, opt_options) {
  var exportedObj = Cu.createObjectIn(targetScope, opt_options);
  Object.assign(exportedObj, obj);
  exportedObj.__proto__ =
    Cu.cloneInto(obj.__proto__, targetScope, {cloneFunctions: true});
  Cu.makeObjectPropsNormal(exportedObj);
};


/**
 * Generates a valid JS variable name from a file uri.
 * Strips 'file://' prefix, if any, replaces invalid chars with underscores.
 * 
 * @param {!String} uri
 * @return {!String} Valid JS variable name.
 */
var _uriToId = function(uri) {
  return uri.replace(/(file:\/\/)/, '').replace(/[^a-zA-Z0-9_]/g, '_');
};
