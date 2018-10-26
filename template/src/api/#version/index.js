import {initialize} from 'express-openapi';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import express from 'express';
import bodyParser from 'body-parser';
import swaggerUI from 'swagger-ui-dist';

const swaggerUiAssetPath = swaggerUI.getAbsoluteFSPath();
const inDevelopmentMode = /^development$/i.test(process.env.NODE_ENV);

const HTTP_STATUS_CODE_TO_TEXT = {
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'Request-URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Requested Range Not Satisfiable',
    417: 'Expectation Failed',
    418: 'I\'m a teapot',
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    444: 'Connection Closed Without Response',
    451: 'Unavailable For Legal Reasons',
    499: 'Client Closed Request',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    510: 'Not Extended',
    511: 'Network Authentication Required',
    599: 'Network Connect Timeout Error'
};


export default (app) => {

    // initialize api
    initialize({

        // the express instance
        app: app,

        // NOTE: If using yaml it's necessary to use "fs" e.g.
        // apiDoc: fs.readFileSync(path.resolve(__dirname, './api-v1/api-doc.yml'), 'utf8'),
        apiDoc: yaml.safeLoad(fs.readFileSync(path.resolve(__dirname, './base-api-doc.yml'), 'utf8')),

        // optional dependency injection
        dependencies: {},

        // mount path
        paths: path.join(__dirname, './paths/'),

        // security & paths
        pathSecurity: [],

        // security middleware - performing the actual authentication
        securityHandlers: {},

        // Allows middleware and path handlers to return promises.
        promiseMode: true,

        // take care of requestBody parsing
        consumesMiddleware: {

            'application/json': bodyParser.json(),

            'text/text': bodyParser.text(),

            'multipart/form-data': function (req, res, next) {

                multer().any()(req, res, function (err) {

                    if (err) return next(err);

                    (req.files || []).forEach(function (f) {
                        req.body[f.fieldname] = f;
                    });

                    return next();

                });

            }

        },

        // Adds a route at args.apiDoc.basePath + args.docsPath. The route will respond with args.apiDoc.
        exposeApiDocs: true,

        // the route under which the api will be published
        docsPath: '/api-docs',

        // generalized error handling
        // Note: 4 arguments (no more, no less) must be defined in
        // your errorMiddleware function. Otherwise the function
        // will be silently ignored.
        errorMiddleware: function (err, req, res, next) { // eslint-disable-line no-unused-vars

            console.error('ERROR:', err);

            const statusCode = err.statusCode || err.status || 500;
            const statusMessage = HTTP_STATUS_CODE_TO_TEXT[statusCode] || HTTP_STATUS_CODE_TO_TEXT[500];

            const responseBody = {
                status: statusCode,
                message: err.message || statusMessage
            };

            if (inDevelopmentMode) {
                if (err.stack) {
                    responseBody.stacktrace = err.stack.split('\n')
                }
            }

            if (statusCode === 400) {
                responseBody.validationErrors = err.errors;
            }

            res.format({

                'text/plain': () => res.status(statusCode).send(JSON.stringify(responseBody, null, 4)),

                'text/html': () => res.status(statusCode).send(errorToHtml(statusCode, statusMessage, responseBody)),

                'application/json': () => res.status(statusCode).json(responseBody),

            });

        }

    });

// server the swagger ui
    console.log('serving swagger from', swaggerUiAssetPath, 'at /api/client');

    const swaggerIndex = fs.readFileSync(`${swaggerUiAssetPath}/index.html`, 'utf8');

    /**
     * The api url is hardcoded in swagger-ui-dist. We can fix this by
     * manually replacing the url. Doing this per request, allows us
     * to dynamically set the host name and base path
     *
     * @param req
     * @param res
     */
    function modifySwagger(req, res) {

        const host = req.hostname;
        const basePath = req.get('X-PROXY-BASE');
        const version = 'v1';

        const modified = swaggerIndex.replace(
            'https://petstore.swagger.io/v2/swagger.json',
            `https://${host}${basePath}${version}/api-docs`);

        res.send(modified);

    }

    app.get('/api/client', modifySwagger);
    app.get('/api/client/index.html', modifySwagger);
    app.use('/api/client', express.static(swaggerUiAssetPath));

};

function errorToHtml(statusCode, statusMessage, responseBody) {
    return `<html>
<head>
    <title>${statusCode}: ${statusMessage}</title>
</head>
<body>
    <h1>Error: ${statusCode}</h1>
    <h2>${responseBody.message}</h2>
    <pre>${JSON.stringify(responseBody, null, 4)}</pre>
</body>
</html>`;
}
