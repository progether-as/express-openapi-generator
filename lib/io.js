const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const mkdirp = require('mkdirp');
const prettier = require("prettier");

async function loadApiDoc(apiDoc) {

    return new Promise(async (resolve, reject) => {

        try {

            const filePath = path.resolve(apiDoc);
            if (await isFileReadable(filePath)) {
                resolve(readSpecFromFile(filePath));
            }
            else if (await isUrlReadable(apiDoc)) {

            }

        } catch (err) {
            reject(err);
        }

    });

}

async function readSpecFromFile(filePath) {

    return readFile(filePath)
        .then(fileContents => {
            return yaml.safeLoad(fileContents);
        });

}

/**
 * Checks if a file is accessible for reading
 *
 * @param {string} filePath - The full path + filename to read
 * @returns {Promise<boolean>} - Returns true if the file is readable
 * and false in all other case. Will always resolve
 */
async function isFileReadable(filePath) {

    return new Promise((resolve, reject) => {

        fs.access(filePath, fs.constants.R_OK, (err) => {

            if (err) {
                return resolve(false);
            }
            resolve(true);

        });

    });

}

async function isFileWritable(filePath) {

    return new Promise((resolve, reject) => {

        fs.access(filePath, fs.constants.W_OK, (err) => {

            if (err) {
                return resolve(false);
            }
            resolve(true);

        });

    });

}

async function isUrlReadable(url) {
    throw new Error('Not Implemented');
}

async function ensureDirectory(filePath) {

    return new Promise((resolve, reject) => {

        mkdirp(path.dirname(filePath), (err) => {
            if (err) {
                return reject(err);
            }
            resolve(filePath);
        });

    });

}

async function readFile(filePath) {

    return new Promise((resolve, reject) => {

        fs.readFile(filePath, 'utf8', (err, fileContents) => {

            if (err) {
                return reject(err);
            }

            resolve(fileContents);

        });

    });

}

async function readJsonFile(filePath) {

    return readFile(filePath)
        .then(fileContents => JSON.parse(fileContents));

}

async function writeFile(filePath, content) {

    return new Promise((resolve, reject) => {

        ensureDirectory(filePath)
            .then(() => {

                fs.writeFile(filePath, content, 'utf8', (err) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve();
                });

            });

    });

}

async function writeFileWithFormatting(filePath, content) {

    const rules = [
        [
            /\.jsx?$/,
            (c) => {
                return prettier.format(c, {
                    semi: true,
                    singleQuote: true,
                    parser: 'babylon',
                    trailingComma: 'all',
                    tabWidth: 4
                })
            }
        ],
        [/.*/, (c) => c]
    ];

    const [, mapping] = rules.find(([rule]) => rule.test(filePath));

    return writeFile(filePath, mapping(content));

}

/**
 * Copy file without checking if the target is accessible
 * or the relevant folder structure exists.
 * @param source
 * @param target
 * @returns {Promise<*>}
 */
async function copyFileUnsafe(source, target) {

    return new Promise((resolve, reject) => {

        fs.copyFile(source, target, (err) => {

            if (err) {
                return reject(err);
            }

            resolve();

        });

    });

}

/**
 * Copy file, will create target folder is necessary
 * @param source
 * @param target
 * @returns {Promise<* | never>}
 */
async function copyFile(source, target) {

    return ensureDirectory(target)
        .then(() => copyFileUnsafe(source, target));

}

module.exports = {
    loadApiDoc,
    readSpecFromFile,
    isFileReadable,
    isFileWritable,
    isUrlReadable,
    ensureDirectory,
    readFile,
    readJsonFile,
    writeFile,
    writeFileWithFormatting,
    copyFile
};
