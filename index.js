const {loadApiDoc, isFileReadable, isFileWritable, readFile, readJsonFile, writeFile, writeFileWithFormatting, copyFile} = require('./lib/io');
const recursive = require('recursive-readdir');
const path = require('path');
const package = require('./package.json');
const yaml = require('js-yaml');
const fs = require('fs');
const recast = require('recast');
const cli = require('cli');

// plugins
cli.enable('help', 'version');

// name + version
cli.setApp('express-openapi-generator', package.version);

const options = cli.parse({
    apiDoc: ['a', 'An OpenApi v2 specification file or url', 'string'],
    targetFolder: ['t', 'Target folder', 'directory', '.']
});

if (!options.apiDoc || !options.targetFolder) {

}

loadApiDoc(options.apiDoc)
    .then(apiDoc => {

        copyTemplatesIfUnset(options.targetFolder, apiDoc)
            .then(() => modifyIndex(options.targetFolder, apiDoc))
            .then(() => readStructure(options.targetFolder))
            .then((existingFiles) => {
                return generateFromApiDoc(existingFiles, apiDoc)
            })
            .then(generatedFiles => {

                const replacer = (key, value) => {
                    return key !== 'content' ? value : '--removed--';
                };

                console.log(
                    '__generated',
                    JSON.stringify(generatedFiles, null, 4)
                );

                return generatedFiles;

            })
            .then(generatedFiles => {

                // TODO calculate diffs

                return generatedFiles;

            })
            .then(generatedFiles => {
                return writeStructure(generatedFiles, options.targetFolder);
            })
            .then(() => {
                return installDependencies(options.targetFolder)
            });
    })
    .then(() => {
        console.log('DONE!');
    })
    .catch(err => {
        // log all errors
        console.error(err);
    });

async function installDependencies(targetFolder) {

    const defaultPackage = await readJsonFile('./template/package.json');

    const filePath = path.resolve(targetFolder);
    const packageFilePath = path.join(filePath, 'package.json');

    isFileReadable(packageFilePath)
        .then((readable) => {
            if (readable) {
                return readJsonFile(packageFilePath)
            }
        })
        .then(existingPackage => {

            if (!existingPackage) {
                return writeFile(packageFilePath, JSON.stringify(defaultPackage, null, 4));
            }

            existingPackage.dependencies = ensureDependencies(defaultPackage.dependencies, existingPackage.dependencies);
            existingPackage.devDependencies = ensureDependencies(defaultPackage.devDependencies, existingPackage.devDependencies);

            return writeFile(packageFilePath, JSON.stringify(existingPackage, null, 4));

        });

    function ensureDependencies(sourceDependencyObject, targetDependencyObject = {}) {

        Object.entries(sourceDependencyObject).forEach(([module, version]) => {

            if (!targetDependencyObject.hasOwnProperty(module)) {
                targetDependencyObject[module] = version;
            }

        });

        return targetDependencyObject;

    }

}

/**
 *
 * @param targetFolder
 * @param apiDoc
 * @returns {Promise<T | never>}
 */
function modifyIndex(targetFolder, apiDoc) {

    const apiDocVersion = getVersion(apiDoc);
    const outputPath = path.resolve(targetFolder);

    const indexFile = path.join(outputPath, 'src/index.js');

    return readFile(indexFile)
        .then(index => recast.parse(index))
        .then(ast => {

            // The below code will modify the AST
            // by adding an import for the current version
            // and subsequently calling it with the app instance as argument

            // If you choose to use recast.builders to construct new AST nodes, all builder
            // arguments will be dynamically type-checked against the Mozilla Parser API.
            const b = recast.types.builders;
            const n = recast.types.namedTypes;

            const initFunction = ast.program.body.find(item => {
                return n.FunctionDeclaration.check(item)
                    && item.id.name === 'initializeApiVersions';
            });

            if (initFunction) {

                // Good documentation: http://btmills.github.io/parserapi/

                const initFunctionBody = initFunction.body.body;

                const hasCurrentVersion = initFunctionBody.some(item => {
                    return n.ExpressionStatement.check(item)
                        && item.expression.callee.name === apiDocVersion;
                });

                if (!hasCurrentVersion) {

                    console.log('INFO: adding version to index.js');

                    const versionIdentifier = b.identifier(apiDocVersion);

                    // add import
                    const importDeclaration = b.importDeclaration(
                        [b.importDefaultSpecifier(versionIdentifier)],
                        b.literal(`./api/${apiDocVersion}`)
                    );
                    ast.program.body.splice(1, 0, importDeclaration);

                    /*
                     * Add call to version initialization
                     * (apiDocVersion) => `${apiDocVersion}(app);`
                     */
                    const expression = b.expressionStatement(
                        b.callExpression(versionIdentifier, [b.identifier('app')])
                    );
                    initFunctionBody.push(expression);

                }

            }

            return ast;

        })
        .then(ast => {
            return recast.print(ast).code;
        })
        .then(code => {
            writeFile(indexFile, code, 'utf8', (err) => {
                if (err) {
                    throw err;
                }
            });
        });

}

function copyTemplatesIfUnset(targetFolder, apiDoc) {

    const apiDocVersion = getVersion(apiDoc);
    const outputPath = path.resolve(targetFolder);
    const inputPath = path.join(__dirname, './template');

    return new Promise((resolve, reject) => {

        recursive(inputPath, (err, files) => {

            if (err) {
                // fail
                return;
            }

            const copyDefinition = files.map(f => {
                return {
                    source: f,
                    target: path.join(
                        outputPath,
                        templatePathReplacements(path.relative(inputPath, f), apiDocVersion)
                    )
                };
            });

            console.log(copyDefinition);

            const copyOps = copyDefinition.map(({source, target}) => copyFile(source, target));

            resolve(Promise.all(copyOps));

        });

    });

}

function templatePathReplacements(targetFilePath, apiDocVersion) {
    return targetFilePath.replace(/#version/, apiDocVersion);
}

function generateFromApiDoc(existingFiles, apiDoc) {

    return new Promise(async (resolve, reject) => {

        const output = [];

        try {

            output.push(...generateBaseApiDoc(existingFiles, apiDoc));
            output.push(...await generateEndpoints(existingFiles, apiDoc));

        } catch (e) {
            reject(e);
        }

        resolve(output);

    });

}

function generateEndpoints(existingFiles, apiDoc) {

    // get api version a simple vX string
    const version = getVersion(apiDoc);

    // Sources:
    // http://btmills.github.io/parserapi
    // https://doc.esdoc.org/github.com/mason-lang/esast/class/src/ast.js~VariableDeclarator.html
    // https://developer.mozilla.org/en-US/docs/Mozilla/Projects/SpiderMonkey/Parser_API

    const b = recast.types.builders;
    const n = recast.types.namedTypes;

    // iterate over paths (e.g. endpoints)
    // and return promises with the endpoint file changes
    const endpointPromises = Object.entries(apiDoc.paths)
        .map(async ([endpoint, methods]) => {

            const relPath = `src/api/${version}/paths${endpoint}.js`;
            let ast = '';

            if (existingFiles.has(relPath)) {
                // read ast from file
                ast = recast.parse(await readFile(existingFiles.get(relPath).abs));
            } else {
                // create an empty
                ast = recast.parse('');
            }

            // ensure we have a default export
            const defaultExport = (function getDefaultExport(ast) {

                let defaultExport = ast.program.body.find(item => {
                    return n.ExportDefaultDeclaration.check(item);
                });

                if (!defaultExport) {

                    defaultExport = b.exportDefaultDeclaration(
                        b.functionDeclaration(
                            // id
                            b.identifier('endpoint'),
                            // params
                            [],
                            // body
                            b.blockStatement(
                                []
                            )
                        )
                    );

                    ast.program.body.push(defaultExport);

                }

                // need to do this again, returning the generated defaultExport
                // wont work as anticipated
                return ast.program.body.find(item => {
                    return n.ExportDefaultDeclaration.check(item);
                });

            })(ast);

            // process the parameters property
            Object.entries(methods)
                .filter(([method]) => method === 'parameters')
                .forEach(([method, spec]) => {

                    console.log(`Processing endpoint "${method}:${endpoint}" ${spec.summary}`);

                    // ObjectExpression
                    const parameters = (function getParameters(defaultExport) {

                        // get the variables declaration containing the parameters variable
                        let parameterVariableDeclaration = defaultExport.declaration.body.body
                            .find(item => {
                                return n.VariableDeclaration.check(item) &&
                                    item.declarations.some(d => d.id.name === 'parameters');
                            });

                        // parameter variable
                        let parameterVariable = parameterVariableDeclaration
                            && parameterVariableDeclaration.declarations.find(d => d.id.name === 'parameters');

                        // if parameter not set, or has wrong type, create new
                        if (!parameterVariable || !n.ArrayExpression.check(parameterVariable.init)) {

                            parameterVariable = b.variableDeclarator(
                                b.identifier('parameters'),
                                b.arrayExpression([])
                            );

                            const index = defaultExport.declaration.body.body.findIndex(item => {
                                return n.VariableDeclaration.check(item) &&
                                    item.declarations.some(d => d.id.name === 'parameters');
                            });

                            const start = index >= 0 ? index : 0;
                            const deletion = index >= 0 ? 1 : 0;

                            defaultExport.declaration.body.body.splice(start, deletion,
                                b.variableDeclaration(
                                    'const',
                                    [parameterVariable]
                                )
                            );

                        }

                        // the arrayExpression
                        return parameterVariable.init;

                    })(defaultExport);

                    // check each spec parameter is present
                    spec.forEach((specParameter) => {

                        // check if a matching property exists in the array
                        const propertyIndex = parameters.elements.findIndex(obj => {
                            return n.ObjectExpression.check(obj)
                                && obj.properties.some(p => p.key.name === 'in' && p.value.value === specParameter.in)
                                && obj.properties.some(p => p.key.name === 'name' && p.value.value === specParameter.name);
                        });

                        let index = parameters.elements.length,
                            deletion = 0;

                        if (propertyIndex >= 0) {

                            // object exists => merge
                            const currentProps = parameters.elements[propertyIndex].properties;

                            Object.entries(specParameter).forEach(([key, value]) => {

                                const current = currentProps.find(p => p.key.name === key);

                                if (current) {
                                    // overwrite value
                                    current.value.value = value;
                                } else {

                                    currentProps.push(b.property(
                                        'init',
                                        b.identifier(key),
                                        b.literal(value)
                                    ));

                                }

                            });

                        } else {

                            // object does not exist => create

                            const entries = Object.entries(specParameter).map(([key, value]) => {
                                return b.property(
                                    'init',
                                    b.identifier(key),
                                    b.literal(value)
                                );
                            });

                            parameters.elements.push(
                                b.objectExpression(entries)
                            );

                        }

                    });

                });

            // process the method properties
            Object.entries(methods)
                .filter(([method]) => method !== 'parameters')
                .forEach(([method, spec]) => {

                    console.log(`Endpoint "${method}:${endpoint}" ${spec.summary}`);

                    const methodFunction = (function getMethodFunction(defaultExport) {

                        let methodFunction = defaultExport.declaration.body.body.find(item => {
                            return n.FunctionDeclaration.check(item) &&
                                item.id.name === method.toUpperCase();
                        });


                        if (!methodFunction) {

                            // this is only ever written once
                            methodFunction = b.functionDeclaration(
                                b.identifier(method.toUpperCase()),
                                [
                                    b.identifier('req'),
                                    b.identifier('res')
                                ],
                                b.blockStatement(
                                    [
                                        // create an empty parameters object
                                        b.variableDeclaration(
                                            'const',
                                            [b.variableDeclarator(
                                                b.identifier('parameters'),
                                                b.objectExpression([])
                                            )]
                                        ),
                                        // create a default "501 - Not Implemented" response
                                        b.expressionStatement(
                                            b.callExpression(
                                                b.memberExpression(
                                                    b.callExpression(
                                                        b.memberExpression(
                                                            b.identifier('res'),
                                                            b.identifier('status'),
                                                            false
                                                        ),
                                                        [b.literal(501)]
                                                    ),
                                                    b.identifier('send'),
                                                    false
                                                ),
                                                [b.literal('Not Implemented')]
                                            )
                                        )
                                    ]
                                )
                            );

                            (methodFunction.comments = []).push(
                                b.line(` ${method.toUpperCase()} on "${endpoint}"`)
                            );

                            methodFunction.async = true;

                            defaultExport.declaration.body.body.push(methodFunction);

                        }

                        const methodParameters = (function getParameters(methodFunction) {

                            // get the variables declaration containing the parameters variable
                            let parameterVariableDeclaration = methodFunction.body.body
                                .find(item => {
                                    return n.VariableDeclaration.check(item) &&
                                        item.declarations.some(d => d.id.name === 'parameters');
                                });

                            // parameter variable
                            let parameterVariable = parameterVariableDeclaration
                                && parameterVariableDeclaration.declarations.find(d => d.id.name === 'parameters');

                            // if parameter not set, or has wrong type, create new
                            if (!parameterVariable || !n.ObjectExpression.check(parameterVariable.init)) {

                                parameterVariable = b.variableDeclarator(
                                    b.identifier('parameters'),
                                    b.objectExpression([])
                                );

                                const index = methodFunction.body.body.findIndex(item => {
                                    return n.VariableDeclaration.check(item) &&
                                        item.declarations.some(d => d.id.name === 'parameters');
                                });

                                const start = index >= 0 ? index : 0;
                                const deletion = index >= 0 ? 1 : 0;

                                console.log('rewriting endpoint method parameters');

                                methodFunction.body.body.splice(start, deletion,
                                    b.variableDeclaration(
                                        'const',
                                        [parameterVariable]
                                    )
                                );

                            }

                            // the arrayExpression
                            return parameterVariable.init;

                        })(methodFunction);

                        // update parameters
                        const specParameters = spec.parameters || [];

                        const specToCode = specParameters.map(specParameter => {

                            let astProperty = null;

                            switch (specParameter.in) {
                                case 'query':
                                    astProperty = b.property('init',
                                        b.identifier(specParameter.name),
                                        b.memberExpression(
                                            b.memberExpression(
                                                b.identifier('req'),
                                                b.identifier('query'),
                                                false
                                            ),
                                            b.identifier(specParameter.name),
                                            false
                                        )
                                    );
                                    break;
                                case 'path':
                                    astProperty = b.property('init',
                                        b.identifier(specParameter.name),
                                        b.memberExpression(
                                            b.memberExpression(
                                                b.identifier('req'),
                                                b.identifier('params'),
                                                false
                                            ),
                                            b.identifier(specParameter.name),
                                            false
                                        )
                                    );
                                    break;
                                case 'header':
                                    astProperty = b.property('init',
                                        b.identifier(specParameter.name),
                                        b.callExpression(
                                            b.memberExpression(
                                                b.identifier('req'),
                                                b.identifier('get'),
                                                false
                                            ),
                                            [b.literal(specParameter.name)]
                                        )
                                    );
                                    break
                                case 'body':
                                    astProperty = b.property('init',
                                        b.identifier(specParameter.name),
                                        b.memberExpression(
                                            b.identifier('req'),
                                            b.identifier('body'),
                                            false
                                        )
                                    );
                                    break;
                                case 'formData':
                                    new Error('formData parameters not implemented');
                            }

                            return {
                                spec: specParameter,
                                ast: astProperty
                            };

                        });

                        function getParameterSource(expression) {

                            try {

                                // req/path are two memberExpressions
                                // body is only one memberExpression
                                // header is a memberExpression wrapped in a callExpression
                                const name = (
                                    (expression.callee && expression.callee.property)
                                    || (expression.object && expression.object.property)
                                    || expression.property
                                ).name;

                                if (name === 'get') {
                                    return 'header';
                                }

                                return name;

                            } catch (e) {
                                return undefined;
                            }

                        }

                        specToCode.forEach(({spec: param, ast}) => {

                            // check if a matching property exists in the array
                            const propertyIndex = methodParameters.properties.findIndex(obj => {
                                return obj.key.name === param.name
                                    && getParameterSource(obj.value) === param.in
                            });

                            let index = methodParameters.properties.length,
                                deletion = 0;

                            if (propertyIndex >= 0) {
                                methodParameters.properties.splice(propertyIndex, 1, ast);
                            } else {
                                // object does not exist => create
                                methodParameters.properties.push(ast);
                            }

                        });

                        return methodFunction;

                    })(defaultExport);

                    (function addMethodDocumentation(container, spec) {

                        // documentation is always overwritten in total

                        const methodDocumentation = b.expressionStatement(
                            b.assignmentExpression(
                                '=',
                                b.memberExpression(
                                    b.identifier(method.toUpperCase()),
                                    b.identifier('apiDoc')
                                ),
                                recast.parse('var i = ' + JSON.stringify(spec)).program.body[0].declarations[0].init
                            )
                        );

                        (function setComment(node, comment) {

                            // multi line comments are possible

                            const lines = comment.split('\n');
                            const comments = lines.map(line => b.line(' ' + line));
                            node.comments = comments;

                        })(methodDocumentation, 'Documentation for method ' + method.toUpperCase());

                        const findMethodDocumentation = s => {
                            return n.ExpressionStatement.check(s)
                                && n.AssignmentExpression.check(s.expression)
                                && n.MemberExpression.check(s.expression.left)
                                && s.expression.left.object.name === method.toUpperCase();
                        };

                        (function findAndReplace(parentNodeList, nodeQuery, nodeReplacement) {

                            const currentIndex = parentNodeList.findIndex(nodeQuery);
                            const index = currentIndex >= 0 ? currentIndex : parentNodeList.length;
                            const deletion = currentIndex >= 0 ? 1 : 0;

                            parentNodeList.splice(index, deletion, nodeReplacement);

                        })(container.body, findMethodDocumentation, methodDocumentation);

                    })(defaultExport.declaration.body, spec);

                });

            // add return statement
            const httpMethods = Object.entries(methods)
                .filter(([method]) => method !== 'parameters')
                .map(([method]) => method.toUpperCase());
            (function ensureReturnStatement(defaultExport, methods) {

                // find existing return
                let returnStatement = defaultExport.declaration.body.body.find(s => {
                    return n.ReturnStatement.check(s);
                });

                if (!returnStatement) {

                    // add new
                    returnStatement = b.returnStatement(
                        b.objectExpression([])
                    );

                    (returnStatement.comments = []).push(
                        b.line(' Export supported endpoint HTTP methods')
                    );

                    defaultExport.declaration.body.body.push(returnStatement);

                }

                //returnStatement.comment = '// Test';
                returnStatement.argument.properties = methods.map(m => b.property('init', b.identifier(m), b.identifier(m)))

            })(defaultExport, httpMethods);

            return {
                rel: relPath,
                content: recast.print(ast).code
            };

        });

    return Promise.all(endpointPromises);

}

function generateBaseApiDoc(existingFiles, apiDoc) {

    // get api version a simple vX string
    const version = getVersion(apiDoc);

    const baseApiDoc = Object.assign({}, apiDoc, {
        paths: []
    });

    const relPath = `src/api/${version}/base-api-doc.yml`;

    if (existingFiles.has(relPath)) {
        console.log('Warning: Will overwrite', relPath);
    }

    return [{
        rel: relPath,
        content: yaml.safeDump(baseApiDoc)
    }];

}

function getVersion(apiDoc) {
    const apiDocVersion = apiDoc && apiDoc.info && apiDoc.version || '1.0.0';
    return 'v' + apiDocVersion.split('.')[0];
}

async function readStructure(targetFolder) {

    // read in the current directory structure
    return new Promise(async (resolve, reject) => {

        const directoryPath = path.resolve(targetFolder);
        if (await isFileWritable(directoryPath)) {

            recursive(
                directoryPath,
                [(file, stats) => {
                    // ignore node_modules
                    return stats.isDirectory && path.basename(file) === 'node_modules';
                }],
                (err, files) => {

                    if (err) {
                        return reject(err);
                    }

                    const mapped = files.map(filePath => {
                        return {
                            abs: filePath,
                            rel: path.relative(targetFolder, filePath),
                            get: () => new Promise((resolve, reject) => {

                                fs.readFile(filePath, 'utf8', (err, content) => {

                                    if (err) {
                                        console.error('Cannot open file', filePath);
                                        return reject(err);
                                    }

                                    resolve(content);

                                });

                            })
                        };
                    });

                    const lookupMap = new Map(mapped.map(f => [f.rel, f]));

                    // shortcut to get a file
                    mapped.get = function (relPath) {
                        return lookupMap.get(relPath);
                    };

                    // shortcut to check a file exists
                    mapped.has = function (relPath) {
                        return lookupMap.has(relPath);
                    };

                    resolve(mapped);

                });

        }

    });

}

async function writeStructure(generatedFiles, baseFolder) {

    const baseFilePath = path.resolve(baseFolder);

    // write updated directory structure
    const writeOps = generatedFiles.map(file => {

        const filePath = path.join(baseFilePath, file.rel);
        return writeFileWithFormatting(filePath, file.content);

    });

    return Promise.all(writeOps);

}
