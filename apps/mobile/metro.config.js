// Metro configuration for a monorepo.
//
// Without this, Metro watches only apps/mobile and cannot resolve
// @language-srs/core from packages/core — the workspace symlink points outside
// the project root, which Metro ignores by default.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the whole workspace so edits in packages/core trigger a reload.
config.watchFolders = [workspaceRoot];

// Resolve from the app first, then the workspace root where npm hoists.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Stop Metro walking further up the filesystem, which can pick up a second copy
// of React and produce the "two Reacts" hook errors.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
