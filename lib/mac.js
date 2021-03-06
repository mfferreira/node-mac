/*!
 * HTTP MAC Authentication Scheme
 * Based on RFC-Draft: http://tools.ietf.org/html/draft-hammer-oauth-v2-mac-token-05
 * Copyright(c) 2011 Eran Hammer-Lahav <eran@hueniverse.com>
 * MIT Licensed
 */


// Load required dependencies

var Crypto = require('crypto');
var URL = require('url');


// MAC authentication

/*
 * credentialsFunc    - required function to lookup the set of MAC credentials based on the provided credentials id.
 *                      The credentials include the MAC key, MAC algorithm, and other attributes (such as username)
 *                      needed by the application. This function is the equivalent to verifying the username and
 *                      password in Basic auth (since it is the only credentials lookup preformed).
 *
 *                      Syntax: function (id, cookie, callback), where callback takes a single object value with the
 *                      following keys: 'key' (required), 'algorithm' (required), and 'issued' (optional) which is
 *                      expressed as the number of milliseconds since January 1, 1970 00:00:00 GMT.
 *
 *                      If no credentials are found, call callback(null). The object is returned after
 *                      authentication is complete so add to the object any other values needed by the application
 *                      post-authentication based on the credentials id (e.g. username).
 */


/*
 * Options:
 * 
 * isHTTPS            - optional Boolean, set to true when used with an HTTPS service. The scheme is needed
 *                      when calculating the default port number if none is present in the Host header field.
 *                      Defaults to false.
 * 
 * hostHeader         - optional header field name, used to override the default 'Host' header when used
 *                      behind a cache of a proxy. Apache2 changes the value of the 'Host' header while preserving
 *                      the original (which is what the module must verify) in the 'x-forwarded-host' header field.
 * 
 * checkNonce         - optional function for checking if the received nonce have been used before. The function is
 *                      called only after the MAC is validated since calculating the MAC is typically less expensive
 *                      than checking the nonce. Nonce verification is important when a replay of a captured request
 *                      is an issue and no transport layer security is used (such as HTTPS).
 *                      Syntax: function (id, issued, nonce, callback), where callback takes a single
 *                      Boolean value, true for valid and false for bad nonce or age. If left undefined or if the MAC
 *                      credentials returned by credentialsFunc do not include 'issued', no nonce checking is performed.
 * 
 * bodyHashMode       - optional string, one of ['ignore', 'validate', 'require']. 'ignore' will not validate any
 *                      body hash provided by the client. 'validate' will check the body hash if included. 'require'
 *                      will require any POST / PUT requests, with or without an entity-body to include a 'bodyhash'
 *                      value, and validate the hash. Defaults to 'validate'. Requires connect.bodyParser() to set
 *                      req.rawBody for any mode other than 'ignore'.
 */

exports.authenticate = function (req, res, credentialsFunc, arg1, arg2) {

    var callback = (arg1 ? arg2 : arg1);
    var options = (arg2 ? arg1 : {});

    // Parse HTTP Authorization header

    if (req.headers.authorization) {

        var attributes = exports.parseHeader(req.headers.authorization);

        // Verify MAC authentication scheme

        if (attributes) {

            // Verify required header attributes

            if (attributes.id &&
                attributes.nonce &&
                attributes.mac) {

                // Check for body hash attribute if required

                if (attributes.bodyhash ||
                    options.bodyHashMode !== 'require' ||
                    (req.method !== 'POST' && req.method !== 'PUT')) {

                    // Obtain host and port information

                    var hostHeader = (options.hostHeader ? req.headers[options.hostHeader.toLowerCase()] : req.headers.host);
                    if (hostHeader) {

                        var hostHeaderRegex = /^(?:(?:\r\n)?[\t ])*([^:]+)(?::(\d+))*(?:(?:\r\n)?[\t ])*$/; // Does not support IPv6
                        var hostParts = hostHeaderRegex.exec(hostHeader);

                        if (hostParts &&
                            hostParts.length > 2 &&
                            hostParts[1]) {

                            var host = hostParts[1];
                            var port = (hostParts[2] ? hostParts[2] : (options.isHTTPS ? 443 : 80));

                            // Look for cookie with same name as attributes.id

                            var cookie; // TODO

                            // Fetch MAC credentials

                            credentialsFunc(attributes.id, cookie, function (credentials) {

                                if (credentials &&
                                    credentials.key &&
                                    credentials.algorithm &&
                                    (credentials.algorithm === 'hmac-sha-1' || credentials.algorithm === 'hmac-sha-256')) {

                                    // Calculate MAC

                                    var mac = exports.calculateMAC(attributes.nonce, req.method, req.url, host, port, attributes.bodyhash, attributes.ext, credentials.key, credentials.algorithm);

                                    if (mac === attributes.mac) {

                                        // Check nonce combination

                                        var checkNonceFunc = (options.checkNonce && credentials.issued ? options.checkNonce : function (id, issued, nonce, callback) { callback(true); });
                                        checkNonceFunc(attributes.id, credentials.issued, attributes.nonce, function (isValid) {

                                            if (isValid) {

                                                // Calculate body hash if present

                                                if (attributes.bodyhash &&
                                                    options.bodyHashMode !== 'ignore' &&
                                                    req.rawBody) {                          // Note: req.rawBody requires connect.bodyParser()

                                                    // Lookup hash function

                                                    var hashMethod = '';
                                                    switch (credentials.algorithm) {

                                                        case 'hmac-sha-1': hashMethod = 'sha1'; break;
                                                        case 'hmac-sha-256': hashMethod = 'sha256'; break;
                                                    }

                                                    var bodyHash = Crypto.createHash(hashMethod).update(internals.utf8Encode(req.rawBody)).digest('base64');
                                                    if (bodyHash === attributes.bodyhash) {

                                                        // Successful authentication
                                                        callback(true, credentials);
                                                    }
                                                    else {

                                                        // Error: Mismatching body hash
                                                        callback(false, credentials, 'Bad body hash');
                                                    }
                                                }
                                                else {

                                                    // Successful authentication
                                                    callback(true, credentials);
                                                }
                                            }
                                            else {

                                                // Invalid nonce
                                                callback(false, credentials, 'Invalid nonce');
                                            }
                                        });
                                    }
                                    else {

                                        // Error: Bad MAC
                                        callback(false, credentials, 'Bad MAC');
                                    }
                                }
                                else {

                                    // Error: Invalid credentials
                                    callback(false, credentials, 'Invalid credentials');
                                }
                            });
                        }
                        else {

                            // Error: Bad Host header field
                            callback(false, null, 'Bad Host header');
                        }
                    }
                    else {

                        // Error: Missing Host header field
                        callback(false, null, 'Missing Host header');
                    }
                }
                else {

                    // Error: Missing body hash attribute
                    callback(false, null, 'Missing required body hash attribute');
                }
            }
            else {

                // Error: Missing authentication attribute
                callback(false, null, 'Missing attributes');
            }
        }
        else {

            // Error: Wrong authentication scheme
            callback(false, null, 'Incorrect authentication scheme');
        }
    }
    else {

        // Error: No authentication
        callback(false, null, 'No authentication');
    }
};


// Return an error WWW-Authenticate header

exports.getWWWAuthenticateHeader = function (message) {

    return 'MAC' + (message ? ' error="' + message + '"' : '');
};


// Calculate the request MAC

exports.calculateMAC = function (nonce, method, URI, host, port, bodyHash, ext, key, algorithm) {

    // Parse request URI

    var uri = URL.parse(URI);

    // Construct normalized req string

    var normalized = nonce + '\n' +
                     method.toUpperCase() + '\n' +
                     uri.pathname + (uri.search || '') + '\n' +
                     host.toLowerCase() + '\n' +
                     port + '\n' +
                     (bodyHash || '') + '\n' +
                     (ext || '') + '\n';

    // Lookup hash function

    var hashMethod = '';
    switch (algorithm) {

        case 'hmac-sha-1': hashMethod = 'sha1'; break;
        case 'hmac-sha-256': hashMethod = 'sha256'; break;
        default: return '';
    }

    // MAC normalized req string

    var hmac = Crypto.createHmac(hashMethod, key).update(normalized);
    var digest = hmac.digest('base64');
    return digest;
};


// Extract attribute from MAC header (strict)

exports.parseHeader = function (header) {

    var headerRegex = /^[Mm][Aa][Cc]\s+(.*)$/;
    var headerParts = headerRegex.exec(header);

    if (headerParts &&
        headerParts.length === 2 &&
        headerParts[1]) {

        var attributes = {};

        var attributesRegex = /(id|nonce|bodyhash|ext|mac)="([^"\\]*)"\s*(?:,\s*|$)/g;
        var verify = headerParts[1].replace(attributesRegex, function ($0, $1, $2) {

            if (attributes[$1] === undefined) {

                attributes[$1] = $2;
                return '';
            }
        });

        if (verify === '') {

            return attributes;
        }
        else {

            // Did not match all parts
            return null;
        }
    }
    else {

        // Invalid header format
        return null;
    }
};


// Generate an Authorization header for a given request

/*
 * credentials is an object with the following keys: 'id, 'key', 'algorithm', 'issued'.
 * 'issued' is expressed as the number of milliseconds since January 1, 1970 00:00:00 GMT.
 */

exports.getAuthorizationHeader = function (method, uri, host, port, credentials, body, ext) {

    // Check request

    if (credentials.id &&
        credentials.key &&
        credentials.algorithm) {

        // Generate nonce

        var nonce = Math.floor(((new Date()).getTime() - (credentials.issued || 0)) / 1000) + ':' + exports.getNonce(8);

        // Calculate body hash

        var bodyhash = '';
        if (body !== null &&
            body !== undefined) {

            var hashMethod;

            switch (credentials.algorithm) {

                case 'hmac-sha-1': hashMethod = 'sha1'; break;
                case 'hmac-sha-256': hashMethod = 'sha256'; break;
                default: return '';                                         // Error: Unknown algorithm
            }

            bodyhash = Crypto.createHash(hashMethod).update(internals.utf8Encode(body)).digest('base64');
        }

        // Calculate signature

        var mac = exports.calculateMAC(nonce, method, uri, host, port, bodyhash, ext, credentials.key, credentials.algorithm);

        // Construct header

        var header = 'MAC id="' + credentials.id +
                     '", nonce="' + nonce +
                     (bodyhash ? '", bodyhash="' + bodyhash : '') +
                     (ext ? '", ext="' + ext : '') +
                     '", mac="' + mac + '"';

        return header;
    }
    else {

        // Invalid credential object
        return '';
    }
};


// Random string

exports.getNonce = function (size) {

    var i;
    var randomSource = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var len = randomSource.length;

    var result = [];

    for (i = 0; i < size; ++i) {

        result[i] = randomSource[Math.floor(Math.random() * len)];
    }

    return result.join('');
};


// Utilities

var internals = {};


// Adapted from http://www.webtoolkit.info/javascript-url-decode-encode.html

internals.utf8Encode = function (string) {

    string = string.replace(/\r\n/g, '\n');
    var utfString = '';

    for (var i = 0, il = string.length; i < il; ++i) {

        var chr = string.charCodeAt(i);
        if (chr < 128) {

            utfString += String.fromCharCode(chr);
        }
        else if ((chr > 127) && (chr < 2048)) {

            utfString += String.fromCharCode((chr >> 6) | 192);
            utfString += String.fromCharCode((chr & 63) | 128);
        }
        else {

            utfString += String.fromCharCode((chr >> 12) | 224);
            utfString += String.fromCharCode(((chr >> 6) & 63) | 128);
            utfString += String.fromCharCode((chr & 63) | 128);
        }
    }

    return utfString;
};

