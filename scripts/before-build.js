/**
 * electron-builder beforeBuild hook.
 * On macOS builds, ensures the Python runtime is pre-extracted to
 * resources/python-mac-extracted/ so each binary can be codesigned.
 */

exports.default = async function beforeBuild(context) {
  const platformName = context.platform && context.platform.nodeName;
  if (platformName !== 'darwin') {
    return;
  }
  const { prepare } = require('./prepare-mac-python.js');
  prepare();
};
