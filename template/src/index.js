import express from 'express';

const app = express();

const inDevelopmentMode = /^development$/i.test(process.env.NODE_ENV);

if (inDevelopmentMode) {
    console.log(`
===================================================

              !!!  CAUTION  !!!
    SERVER IS RUNNING IN DEVELOPMENT MODE

===================================================`);
}

initializeApiVersions();

module.exports = app;

/**
 * Package the api initialization in a function for
 * easy modification.
 */
function initializeApiVersions() {
}
