/*
 * 	Alex Bosworth 
 * 
 * 	A straightforward S3 library
 * 
 *  USE: var s3 = new S3(AWS_KEY, AWS_SECRET, {defaultBucket : MY_BUCKET});
 *       s3.put(KEY, {data:{},headers:{}}, [bucket]);
 *       s3.get(KEY, [bucket]).on('success', function(data) { console.log(data); });
 *       (more operations: buckets, info, list)
 *  
 *  EVENTS: on('complete'): returns raw response
 *          on(statusCode): returns response data (json parsed if json header)
 *          on('success') : shortcut to on('200')
 *          on('failure') : catches all status codes above 300
 *
 *  Tips:
 *  x-amz-storage-class: (STANDARD | REDUCED_REDUNDANCY)
 *  x-amz-acl: (private | public-read | public-read-write | authenticated-read | 
 *              bucket-owner-read | bucket-owner-full-control )
 * 
 *  REQUIRES: xml2js, node-jquery
 */
 
require.paths.unshift(__dirname);

var crypto = require('crypto'), 
	http = require('http'),		 
	EventEmitter = require('events').EventEmitter,
	fs = require('fs'),
	net = require('net'),
	sys = require('sys'),
	$ = require('node-jquery'),
	querystring = require('querystring'),
	xml2js = require('vendor/xml2js');
	
process.on('uncaughtException', function (err) {
	console.log(err.stack);
	
	console.log('uncaught Exception: ' + err);
});

var S3 = function(awsAccessKey, awsSecretKey, options){
	this._awsSecretKey = awsSecretKey;
	this._awsAccessKey = awsAccessKey;
	
	options = options || {};
	
	this._defaultBucket = options.defaultBucket || null     // default working bucket
	
	this._storageType = options.storageType || 'STANDARD';	// reduced is also an option
	this._acl = options.acl || 'private';					// secure by default	
	
	this.tries = 0;
};

S3.prototype = new EventEmitter;
S3.prototype.constructor = S3;

// Usage: s3.put('movies/titanic.avi', {data:titanicBlob, headers:{type:'movie'}})
S3.prototype.put = function(key, file, bucket) { 
	// file is an object {data:<string>, headers:<object>}
	// bucket is optional - can use default bucket
	// shortcuts: pass file as a string or file[data] as an object to auto-create headers
	if (!file) throw new Error('no file specified');
	if (!key) throw new Error('no path specified');
		
	var s3 = this;
	
	var retry = $.proxy(function() { 
		return this.s3.put(this.key, this.file, this.bucket);
	}, {s3:s3, key:key, file:file, bucket:bucket});
	
	bucket = bucket || this._defaultBucket;
	
	if (typeof(file) != 'object') file = {'data':file};
	
	if (!file.headers) file.headers = {};
		
	if (file.binaryBuffer) { // easy, no need to convert anything
	    file.data = file.binaryBuffer;
    } 
    else if (typeof(file.data) != 'string') {
		file.data = new Buffer(JSON.stringify(file.data), encoding='utf8');
		
		file.headers['Content-Type'] = "application/json; charset=utf-8;";
	}
    else file.data = new Buffer(file.data, encoding = 'binary');
	
	file.headers = file.headers || {};
	
	if (file.meta) {
		var k;
		
		for (k in file.meta) file.headers['x-amz-meta-' + k] = file.meta[k];
	}
	
	try {			    
		var resource = '/' + bucket + '/' + key;
		var headers = s3._getPutHeaders(bucket + '.s3.amazonaws.com', file.data,
			file.headers);
			
		// add the amazon authorization header 
		s3._addAuthorizationHeader(headers, 'PUT', resource);

		var client = this.httpClient(headers);
		
		client.on('error', function(err) { 
			console.log('error' + err + ' - retrying in 5 seconds');
			setTimeout(retry, 5 * 1000, retry); });
		
		var req = client.request('PUT', '/' + key, headers);
		
		req.on('error', function(err) { 
			console.log('put req error'); 
			console.log(err); });
			
		req.write(file.data, 'utf8');
		
		req.end();
		
		var data = "";

		req.on('response', function(response) {		
			if (response.statusCode == '100') return;

			response.on('data', function(chunk) {
				data += chunk;
			});
			
			response.on('end', function() {				
				s3.emit('complete', response, data);
			});
			
			if (response.statusCode == '200') {
				response.on('end', function() {
                    s3.emit('success', data, response.headers)
				});
			}
			
            if (response.statusCode >= '300') {
                s3.emit('failure', data, response.headers);
            }
		});
	} catch(err) {
	    this.emit('failure');
		this.emit('error', err);
	}
	
	return this;
};


S3.prototype.httpClient = function(headers) {    
	return http.createClient(80, $.cacheDns(headers.Host));
}

S3.prototype.buckets = function() { 
	var data = "", s3 = this;
	
	try {
		var headers = s3._getGetHeaders('s3.amazonaws.com');
		
		s3._addAuthorizationHeader(headers, 'GET', '/');
		
		var req = this.httpClient(headers).request('GET', '/', headers);
		
		req.end();
				
		req.on('response', function(r) { 		    
			r.on('data', function(chunk) {
				data += chunk;
			});
			
			r.on('end', function() { 
				var xmlParser = new xml2js.Parser();
				
				xmlParser.on('end', function(result) {
					s3.emit('complete', result)
				});

				xmlParser.parseString(data); 			    				
			});
		});
	} catch(err) {
		this.emit('error', err);
	}
	
	return this;
}

S3.prototype.list = function(prefix, delimiter, bucket) { 
	var data = "", s3 = this;
	
	bucket = bucket || this._defaultBucket;
	
	try {
		var headers = s3._getGetHeaders(bucket + '.s3.amazonaws.com');
						
		s3._addAuthorizationHeader(headers, 'GET', '/' + bucket + '/');
		
		var args = {};
		
		if (prefix) { args.prefix = prefix; }
		if (delimiter) { args.delimiter = delimiter; }
				
		var req =  this.httpClient(headers).
			request('GET', '/?' + querystring.stringify(args), headers);
				
		req.end(); 
				
		req.on('response', function(r) { 
			r.on('data', function(chunk) {
				data += chunk;
			});
			
			r.on('end', function() { 				
				var xmlParser = new xml2js.Parser();
				
				xmlParser.on('end', function(response) {	
					var results = [],
						prefixes = response['CommonPrefixes'] || [],
						contents = response['Contents'] || [];
															
					for (var i = 0, dir; dir = prefixes[i]; i++) {
						results.push({
							type : 'dir',
							name : dir.Prefix
						})
					}
					
					for (var i = 0, file; file = contents[i]; i++) {
						results.push({
							type : 'file',
							key : file.Key,
							lastModified : file.LastModified,
							size : parseInt(file.Size),
							storageClass : file.StorageClass,
							owner : file.Owner
						});
					}						
					
					s3.emit('complete', response);
					
					if (results.length) s3.emit('success', results, response.IsTruncated);
					
					return 
				});

				xmlParser.parseString(data);
			});
		});
	} catch(err) {
		this.emit('error', err);
	}
	
	return this;
};

S3.prototype.info = function(key, bucket) { 
	var data = "", s3 = this;
	
	bucket = bucket || this._defaultBucket;
	
	try {
		var headers = s3._getGetHeaders(bucket + '.s3.amazonaws.com'); 

		// add the amazon authorization header 
		s3._addAuthorizationHeader(headers, 'HEAD', '/' + bucket + '/' + key);
		
		var req = this.httpClient(headers).request('HEAD', '/' + key, headers);
		
		req.end();
		
		req.on('response', function(response) {					    
			s3.emit('complete', response);
			s3.emit(response.statusCode.toString(), response.headers);
						
			if (response.statusCode == '200') {
				s3.emit('success', response.headers);
			}
			else if (response.statusCode >= 300) {
				s3.emit('failure', response);
			}
		});
	} catch(err) {	    
		this.emit('error', err);
	}
	
	return this;
};

// emits: complete 
S3.prototype.get = function(key, bucket) { 
	var data = "", 
	    s3 = this;
	
	var retry = $.proxy(function() { 	    
	    this.s3.tries++;
	    
		return this.s3.get(this.key, this.bucket);
	}, {s3: s3, key: key, bucket: bucket});
	
	bucket = bucket || this._defaultBucket;
	
	try {
		var headers = s3._getGetHeaders(bucket + '.s3.amazonaws.com'); 

		// add the amazon authorization header 
		s3._addAuthorizationHeader(headers, 'GET', '/' + bucket + '/' + key);
		
		var error = function(err) { console.log('get req issue'); console.log(err); };
		
		var client = this.httpClient(headers);
				
		client.on('error', function(err) { 
		    console.log('GET FAILURE: ' + err + ' try #' + s3.tries);
		    
		    if (s3.tries > 5) return console.log('GIVING UP ON S3 GET');
		    
			setTimeout(retry, (s3.tries + 1) * 5 * 1000); });
		
		var req = client.request('GET', '/' + key, headers);		
				
		req.on('error', error);
		
		req.end();

		req.on('response', function(response) {		
            response.setEncoding(encoding = 'utf8');

			response.on('data', function(chunk) {
				data += chunk;
			});

			response.on('end', function() {					
				response.data = data;
				
				if (/^application.json\b/.test(response.headers['content-type'])) {
					try {
						response.data = JSON.parse(data);
					} catch(err) { }
				}

				s3.emit('complete', response, response.data);
				
				s3.emit(response.statusCode.toString(), response.data);
				
				if (response.statusCode == 200) {
					s3.emit('success', response.data, response.headers);
				}
				else if (response.statusCode >= 300) {
					s3.emit('failure', response, response.data);
				}
			});
		});
	} catch(err) {
		console.log('uncaught err');
		console.log(err);
		
		this.emit('error', err);
	}
	
	return this;
};

// will modify the passed headers object to include an Authorization signature
S3.prototype._addAuthorizationHeader = function(headers, method, resource) {
	var awsSecretKey = this._awsSecretKey, 
		awsAccessKey = this._awsAccessKey;
		
	var canonicalizedAmzHeaders = this._getCanonicalizedAmzHeaders(headers);	
					
	var stringToSign = (function(headers, method, canonicalizedAmzHeaders, resource) {
		var date = headers.Date || new Date().toUTCString();

		//make sure we have a content type
		var contentType = headers['Content-Type'] || '';
		
		var md5 = headers['Content-MD5'] || '';

		//return the string to sign.
		return stringToSign = 
			method + "\n" + 
			md5 + "\n" +
			contentType + "\n" +    	// (optional)
			date + "\n" +				// only include if no x-amz-date
			canonicalizedAmzHeaders +	// can be blank
			resource;
	})(headers, method, canonicalizedAmzHeaders, resource);
		
	var hmac = crypto.createHmac('sha1', awsSecretKey);
	hmac.update(stringToSign);
	
	// append the headers to the supplied headers object
	headers.Authorization = 'AWS ' + awsAccessKey+':'+hmac.digest(encoding = 'base64');
	
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

S3.prototype._getGetHeaders = function(host){
	var instance = this;
	return {
		'Date': new Date().toUTCString(),
		'Host': host
	};
};

// returns the headers for a put request
S3.prototype._getPutHeaders = function(host, data, customHeaders){
	var instance = this;
	
	var hash = crypto.createHash('md5').update(data).digest(encoding = 'base64');

	return $.extend({
        'Content-Length': data.length,
		'Content-MD5' : hash,
		'Date': new Date().toUTCString(),
		'Host': host, 	
		'x-amz-acl': instance._acl,
		'x-amz-storage-class': instance._storageType
	}, customHeaders);
};

// export the s3 library
exports.S3 = S3;
