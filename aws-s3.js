// example require
// var bucket = require('aws-s3').init(KEY, PASS, BUCKET);

// example get
// bucket().get(objectName)

var crypto = require('crypto'),
    http = require('http');

function init(key, pass, bucket, options) {
    options = options || {};
    
    return function createInstance(newBucket, newOptions) {
        bucket = newBucket || bucket;
        options = newOptions || options;
        
        return new S3(key, pass, bucket, options);
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
        
        if (err) return self._failureCbk(err); 
        
        self._successCbk(responseData);
    });
    
    return this;
};

S3.prototype.put = function(key, data, options) {
    var self = this,
        options = options || {},
        file = { data: data };
    
    file.headers = options.headers || {};
    file.meta = options.meta || {};
    file.buffer = options.binaryBuffer || data;
    
    for (var k in file.meta) file.headers['x-amz-meta-' + k] = file.meta[k];
    
    file.headers['x-amz-acl'] = self._acl;
	file.headers['x-amz-storage-class'] = self._storageType;
    
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
    if (arguments.length == 4) { cbk = data; } // these simplify the call proc 
    
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