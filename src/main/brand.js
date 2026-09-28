// The product's identity, in one place for the main process and the build
// scripts. Packaging repeats it in package.json and the electron-builder
// configs; src/test/packaging.test.js keeps them in step.

export const PRODUCT_NAME = 'Append HMI Web';
export const PUBLISHER = 'Append Automation';
export const APP_ID = 'com.appendautomation.hmiweb';

export const WINDOWS_EXE = PRODUCT_NAME + '.exe';
export const LINUX_EXECUTABLE = 'append-hmi-web';

export const HOMEPAGE_URL = 'https://github.com/AppendAutomation/AppendHMIWeb';

// 8080 and 8088 are often taken on plant PCs (other web servers, Ignition);
// 8480 is above 1024, so no administrator rights are needed to listen on it
export const DEFAULT_PORT = 8480;
