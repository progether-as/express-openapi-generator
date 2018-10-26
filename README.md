# express-openapi-generator

This is a code generator for [express-openapi](https://github.com/kogosoftwarellc/open-api/tree/master/packages/express-openapi). To generate (and update) an express-openapi project from a [OpenApi v2](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/2.0.md) specification file.

## Install & usage

Use within your server module:

    npm install express-openapi-generator
    ./node_modules/.bin/apigen -a api-doc.yml -t .
    
Install globally and use anywhere:
    
    npm install -g express-openapi-generator
    apigen -a api-doc.yml -t ../path/to/server/code

## Current limitations

- Changed or deleted api endpoints will not automatically be deleted
- The code is mainly untested

## Advantages

- The endpoint code is updated by modifying the AST of the endpoint file. Custom extensions of the code will be kept over updated, allowing the generator to be run multiple times.  
