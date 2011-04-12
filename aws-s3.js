/*
 *
 * example require
 * var bucket = require('aws-s3').init(KEY, PASS, BUCKET);
 *
 * example get
 * bucket().get(objectName).complete(func(){}).success(func(){}).failure(func(){});
 *
 * Set up the callbacks by chaining functions off the bucket object
 *
 * .complete(func(){}) < fires immediately and includes err, response, [responseData]
 * .success(func(){}) < if there is no failure, returns [responseData (cleaned)]
 * .failure(func(){}) < any failure returns err here.
 *
 * example put
 * bucket().put(objectName, data, [options])
 *
 * options can include <headers> <meta> <binaryBuffer> 
 */

var crypto = require('crypto'),
    http = require('http'),
    xml2js = require('./vendor/xml2js'); // https://github.com/maqr/node-xml2js.git
    queryStringify = require('querystring').stringify;
    
function xmlParse(xmlString, cbk) {
    var xmlParser = new xml2js.Parser();
	
	xmlParser.on('end', function(result) { cbk(result); })

	xmlParser.parseString(xmlString); 			    				    
}

function init(key, pass, bucket, options) {
    options = options || {};
    
    return function createInstance(newBucket, newOptions) {
        return new S3(key, pass, newBucket || bucket, newOptions || options);
    };
}

function S3(key, pass, bucket, options) {
    this._key = key;
    this._pass = pass;
    this._bucket = bucket;
    
    this._acl = options.acl || 'private';
    this._storageType = options.storageType || 'STANDARD';
    
    this._successCbk = new Function();
    this._failureCbk = new Function();
    this._completeCbk = new Function();
    
    return this;
}

S3.prototype.head = function(key) {
    var self = this;
    
    self._request('HEAD', key, function headResponse(err, response) {
        self._completeCbk(err, response);
        
        if (err) return self._failureCbk(err);
        
        return self._successCbk(response.headers);
    });
    
    return this;
}

S3.prototype.del = function(key) { 
    var self = this;
    
    self._request('DELETE', key, function delResponse(err, response, responseData) {
        self._completeCbk(err, response, responseData);
        
        if (err) return self._failureCbk(err);
        
        return self._successCbk();
    });
    
    return this;
};

S3.prototype.get = function(key) {
    var self = this;
        
    self._request('GET', key, function getResponse(err, response, responseData) {
        self._completeCbk(err, response, responseData);
        
        if (response.statusCode != 200) return self._failureCbk(responseData);        
        if (err) return self._failureCbk(err); 
        
        self._successCbk(responseData);
    });
    
    return this;
};

// use bucket().list('dirname/', '/', 500)
S3.prototype.list = function(prefix, delimiter, count) {
    var self = this,
        results = [];
    
    var args = {
        prefix: prefix || '',
        delimiter: delimiter || '',
        count: count || 1000
    };
    
    if (count > 1000) args.count = 1000;
    
    var list = function() {
        self._request('GET', '', {}, args, function listResponse(err, response, data) {
            self._completeCbk(err, response, data);
                
            if (response.statusCode != 200) err = data;
        
            if (err) return self._failureCbk(err);
            
            xmlParse(data, function parsedListResponse(xml) {
                var prefixes = xml.CommonPrefixes || [],
    				contents = xml.Contents || [];
				
    			prefixes.forEach(function(dir) {
    				results.push({
    					type: 'dir',
    					name: dir.Prefix
    				});
    			});
			
    			contents.forEach(function(file) { 
    				results.push({
    					type: 'file',
    					key: file.Key,
    					lastModified: new Date(file.LastModified),
    					size: parseInt(file.Size),
    				});			    
    		    });
    		    
                self._successCbk(results);
            })
        });        
    };
    
    list();
    
    return this;
}

S3.prototype._streamingPut = function(key, stream, headers) {
    var self = this,
        parts = {},
        uploadId,
        headers = headers || {},
        partNumber = 1,
        paused = false;
        
    var pauseStream = function() { 
        paused = true; 
        stream.pause(); 
    };
    
    var resumeStream = function() { 
        if (!paused) return; 
        
        paused = false; 
        
        stream.resume(); 
    };
    
    var numCurrentlyUploading = function() {
        var count = 0;

        for (var part in parts) if (!part[parts]) count++;

        return count;
    };
        
    pauseStream();
            
    self._request('POST', key + '?uploads', headers, function(err, response, data) {
        uploadId = data.match(/UploadId.(.*)..UploadId/)[1],
        finishUpload = false; // signals ends of the stream
                
        resumeStream();
        
        var uploadPart = new Buffer(5251337),
            writtenLength = 0;
        
        stream.on('data', function(chunk) {
            var offset = 0; // where to split a chunk if necessary
                
            if (writtenLength + chunk.length > uploadPart.length) {                
                // create a copy of the uploadBuffer that can get flushed to S3
                var flushBuffer = new Buffer(uploadPart.length);
                
                uploadPart.copy(flushBuffer);
                
                // the chunk must be split in twain
                offset = flushBuffer.length - writtenLength;
                
                chunk.copy(flushBuffer, writtenLength, 0, offset + 1);

                flushUploadPart(partNumber, flushBuffer); // send to S3
                
                // reset to start
                partNumber++;
                uploadPart = new Buffer(uploadPart.length);
                writtenLength = 0;
            }
            
            chunk.copy(uploadPart, writtenLength, offset);
            
            writtenLength+= (chunk.length - offset);
            
            if (numCurrentlyUploading() > 10) pauseStream();
        });
        
        var flushUploadPart = function(partNum, part) {
            var md5Hash = crypto.createHash('md5');            
            
            parts[partNum] = false; // signals part is not completely uploaded
                        
            var args = {
                partNumber: partNum,
                uploadId: uploadId };
            
            var reqHeaders = {
                'Content-MD5': md5Hash.update(part).digest('base64'),
                'Content-Length': part.length };
                            
            self._request('PUT', key + '?' + queryStringify(args), reqHeaders, part,
            function completePartUpload(err, response) {
                if (numCurrentlyUploading() < 10) resumeStream();
                
                if (err) console.log(err);

                parts[partNum] = response.headers.etag;
                                
                if (!finishUpload) return;
                
                // check all the parts for etags, this means they are complete
                for (var part in parts) if (!parts[part]) return;
                
                self._completeMultipartUpload(key, uploadId, parts);
            });
        };
                
        stream.on('end', function() { 
            flushUploadPart(partNumber, uploadPart.slice(0, writtenLength));            
            
            finishUpload = true;
        });
    });    
    
    return self;
}

S3.prototype._completeMultipartUpload = function(key, uploadId, parts) {
    var self = this,
        xml = '<CompleteMultipartUpload>';
        
    uploadId = encodeURIComponent(uploadId);
    
    for (var part in parts) { 
        xml+= '<Part>' +
            '<PartNumber>' + part + '</PartNumber>' +
            '<ETag>' + parts[part] + '</ETag>' + 
            '</Part>';
    }
    
    xml = new Buffer(xml + '</CompleteMultipartUpload>', 'binary');
    
    var reqHeaders = {
        'Content-Length': xml.length
    };
    
    self._request('POST', key + '?uploadId=' + uploadId, reqHeaders, xml, 
    function completeMultipartUploadResponse(err, response, data) {
        self._completeCbk(err, response, data);
        
        if (err) return self._failureCbk(err);
        
        return self._successCbk();
    });
};

S3.prototype.put = function(key, data, options) {
    var self = this,
        options = options || {},
        file = { data: data };
            
    file.headers = options.headers || {};
    file.meta = options.meta || {};
    file.buffer = options.binaryBuffer || data;
    
    for (var k in file.meta) file.headers['x-amz-meta-' + k] = file.meta[k];
    
    file.headers['x-amz-acl'] = options.acl || self._acl;
	file.headers['x-amz-storage-class'] = options.storageType || self._storageType;
	
	if (options.readStream) return this._streamingPut(key, data, file.headers);
    
    if (options.binaryBuffer) {
        file.buffer = data;
    }
    else if (typeof(data) == 'string') {
        file.buffer = new Buffer(data, 'binary');
    }
    else {
        file.buffer = new Buffer(JSON.stringify(data), 'binary');
        file.headers['Content-Type'] = "application/json; charset=utf-8;";
    }	
    
    var md5Hash = crypto.createHash('md5');
    	    
    file.headers['Content-Length'] = file.buffer.length;
	file.headers['Content-MD5'] = md5Hash.update(file.buffer).digest('base64');
	
    self._request('PUT', key, file.headers, file.buffer,     
    function postResponseCbk(err, response, responseData) {        
        self._completeCbk(err, response, responseData);
        
        if (err) return self._failureCbk(err);
                        
        return self._successCbk(response);
    });
    
    return this;
}

S3.prototype.success = function(cbk) {
    this._successCbk = cbk;
    
    return this;
};

S3.prototype.failure = function(cbk) {
    this._failureCbk = cbk;
    
    return this;
};

S3.prototype.complete = function(cbk) {
    this._completeCbk = cbk;
    
    return this;
};

S3.prototype._getCanonicalizedAmzHeaders = function(headers) {
	var canonicalizedHeaders = [];
	
    for (header in headers) {
		// pull out amazon headers
		if (/x-amz-/i.test(header)) {
			var value = headers[header];
			
			if (value instanceof Array) {
				value = value.join(',');
			}
			
			canonicalizedHeaders.push(header.toString().toLowerCase() + ':' + value);
		}
	}
	
	var result = canonicalizedHeaders.sort().join('\n')
	
	if (result) {
		result += '\n';
	}
	
	return result;
};

S3.prototype._getAuthorizationHeader = function(headers, method, resource) {
    var self = this,
        canonicalizedAmzHeaders = this._getCanonicalizedAmzHeaders(headers);	
        
    resource = '/' + self._bucket + '/' + resource;
					
	var stringToSign = (function(headers, method, canonicalizedAmzHeaders, resource) {
		var date = headers.Date || new Date().toUTCString();

		//make sure we have a content type
		var contentType = headers['Content-Type'] || '',
		    md5 = headers['Content-MD5'] || '';

		//return the string to sign.
		return stringToSign = 
			method + "\n" + 
			md5 + "\n" +
			contentType + "\n" +    	// (optional)
			date + "\n" +				// only include if no x-amz-date
			canonicalizedAmzHeaders +	// can be blank
			resource;
	})(headers, method, canonicalizedAmzHeaders, resource);
	
	var hmac = crypto.createHmac('sha1', self._pass); hmac.update(stringToSign);
	
	return 'AWS ' + self._key + ':' + hmac.digest('base64');
};

// <http verb> <resource path> <request headers> <request data> <cbk>
// can skip the request data/headers and just put in a callback if there is no req stuff.
S3.prototype._request = function(method, path, headers, data, cbk) {
    var self = this;
    
    if (arguments.length == 3) { cbk = headers; headers = {}; }
    if (arguments.length == 4) { cbk = data; data = null; } // these simplify the call proc 
    
    cbk = cbk || new Function();
    
    headers = headers || {};
        
    headers['Date'] = new Date().toUTCString(),
    headers['Host'] = self._bucket + '.s3.amazonaws.com';
    headers['Authorization'] = self._getAuthorizationHeader(headers, method, path);
    
    var req = http.request({
        host: self._bucket + '.s3.amazonaws.com',
        port: 80,
        path: '/' + path,
        headers: headers,
        method: method
    }, 
    
    function receivedResponse(res) {
        var body = '';
        
        res.on('data', function(chunk) { body+= chunk; });        
        
        res.on('end', function() { cbk(null, res, body); })
    }).
    
    on('error', function errorInS3Request(err) {
        cbk(err);
    });
    
    if (data && data.length) req.write(data);

    req.end();
};

exports.init = init;

exports.get = exports.put = function() { throw new Error('Use init first'); };