function now() {
	return (new Date).getTime();
}

var window = {},
	jsc = now(),
	rscript = /<script(.|\s)*?\/script>/gi,
	rselectTextarea = /select|textarea/i,
	rinput = /color|date|datetime|email|hidden|month|number|password|range|search|tel|text|time|url|week/i,
	jsre = /=\?(&|$)/,
	rquery = /\?/,
	rts = /(\?|&)_=.*?(&|$)/,
	rurl = /^(\w+:)?\/\/([^\/?#]+)/,
	r20 = /%20/g,
	rtrim = /^(\s|\u00A0)+|(\s|\u00A0)+$/g;	// Used for trimming whitespace

var $ = {
	lib : {
		url : require('url'),
		http : require('http'),
		querystring : require('querystring'),
		dns : require('dns')
	},
	lastModified : {},
	etag : {},
	ajaxSettings : {
		global: true,
		type: "GET",
		contentType: "application/x-www-form-urlencoded",
		processData: true,
		async: true,
		accepts: {
			xml: "application/xml, text/xml",
			html: "text/html",
			script: "text/javascript, application/javascript",
			json: "application/json, text/javascript",
			text: "text/plain",
			_default: "*/*"
		}
	},
	noop: function() {}
};

$.trim = function(text) {
	return (text || "").replace(rtrim, "");
};

$.grep = function( elems, callback, inv ) {
	var ret = [], retVal;
	inv = !!inv;

	// Go through the array, only saving the items
	// that pass the validator function
	for ( var i = 0, length = elems.length; i < length; i++ ) {
		retVal = !!callback( elems[ i ], i );
		if ( inv !== retVal ) {
			ret.push( elems[ i ] );
		}
	}

	return ret;
};

var Store = { 'temp' : {}, 'binds' : {} };

// add to array or... extend object
$.absorb = function(value) {
	var commit = function(key, persist) {
    	key = key.toLowerCase();

		if (this.value instanceof Array) {
			var arr = (Store.temp[key]) ? Store.temp[key] : [];

			arr = this.value.concat(arr);

			Store.temp[key] = [];

			for (var i = 0, v, uniques = {}; v = arr[i]; i++) {
				if (typeof(v) == 'string' || typeof(v) == 'number') {
					if (!uniques[v]) {
						Store.temp[key].push(v);
						uniques[v] = true;
					}
				} else { 
					Store.temp[key].push(v);
				}
			}
		}
		else {
			Store.temp[key] = [$.extend(Store.temp[key], this.value)];
		}

		if (Store.binds[key]) {
			$.each(Store.binds[key], function(i,n) { $(n).trigger('update'); });
		}

		if (typeof(localStorage) != 'undefined' && 
			(localStorage.getItem(key) || persist)) 
			this._safeSetItem(key, Store.temp[key]);

		return Store.temp[key];
	};
	
	return $.proxy(commit, {'value':value});
};

$._safeSetItem = function(key, value) {
    try { 
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { 
        ['Notice: Reducing cache.'].store('warning', false);
        
        for (var i = 0, ll = localStorage.length, name; i < ll; i++) {
            name = localStorage.key(i);
            
            if (name && name.substring(0,14) == 'details:user:@')
                if (![].get(name).token) localStorage.removeItem(name);
            
            if (name && name.substring(0,5) == 'seen:')
                localStorage.removeItem(name);
        }
        
        try { 
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            ['Storage super overflow!!! Wiping Cache.'].store('warning');
            
            localStorage.clear();
            
            localStorage.setItem(key, JSON.stringify(value));
        }
    }
};

$.store = function(value) {
	var commit = function(key, persist) {
    	key = key.toLowerCase();

    	if (persist && typeof(localStorage) != 'undefined') {
        	$._safeSetItem(key, this.value);
    	}

    	Store.temp[key] = this.value;

    	if (Store.binds[key])
        	$.each(Store.binds[key], function(i,n) { $(n).trigger('update'); });

		return this;
	}
	
    return $.proxy(commit, {'value':value});
};

$.$ = function(key) {
	// optimization
    if (Store.temp[key]) return Store.temp[key];

    key = key.toLowerCase();

    var val = Store.temp[key];

    if (typeof(val) != 'undefined') return val // saved in temp var

    if (typeof(localStorage) == 'undefined') return val; // exit early

    val = localStorage.getItem(key);

    if (val === null || typeof(val) == 'undefined') return null; // empty array

    val = JSON.parse(val);
    
    Store.temp[key] = val; //save for repeat access

    return val;
};

$.cacheDns = function(host) { 
	// takes <string> <hostName> 
	
	if (/[a-z]/.test(host) == false) return host; // not a host name
	
	if ($.$('dns:'+host)) return $.$('dns:'+host); // already cached

	$.lib.dns.resolve4(host, $.proxy(function(err, addresses) {
		if (err || !addresses || !addresses.length) return;
		
		$.store(addresses[0])('dns:' + host);
	}, this.url));
		
	return host; // this will be original argument if not cached already...
};

$.httpRequest = function() {
	this.type = 'GET';
	this.onreadystatechange = function() {};
	this.readyState = 0;
	this.status = null;
	this.responseXML = null;
	this.responseText = '';
	
	this.url = '';
	this.headers = {}; // request headers
	this.responseHeaders = {};
};

$.httpRequest.prototype.open = function(type, url) {
	this.readyState = 1;
	
	this.type = type;
	this.url = $.lib.url.parse(url);
	this.headers['host'] = this.url.host;
	
	this.onreadystatechange();
};

$.httpRequest.prototype.setRequestHeader = function(header, value) {
	this.headers[header] = value;
};

$.httpRequest.prototype.abort = function() {
};

$.httpRequest.prototype.getResponseHeader = function(header) {	
	return this.responseHeaders[header];
}

$.httpRequest.prototype.cacheDns = $.cacheDns;

$.httpRequest.prototype.send = function(data) { 	
	this.readyState = 2;
	
	this.headers['date'] = new Date().toUTCString();
	
	var host = this.cacheDns(this.url.host);
	
	this.setRequestHeader('host', this.url.host);
		
	var server = $.lib.http.createClient(80, host);
	
	var path = this.url.pathname + ((this.type == 'GET') ? this.url.search : '');
	
	var request = server.request(this.type, path, this.headers);

	if (data) request.write(data);
			
	request.end();
	
	var err = $.proxy(function(r) { 
		this.status = 500;
		
		this.readyState = 4;
		
		this.onreadystatechange();
	}, this);
	
	server.on('error', err);
	request.on('error', err);
	
	request.on('response', $.proxy(function(r) {
		this.status = r.statusCode;
		this.responseHeaders = r.headers;
				
		r.setEncoding('utf8');

		r.on('data', $.proxy(function(chunk) {
			this.readyState = 3;
						
			if (chunk.length) this.responseText = [this.responseText, chunk].join('');
									
			this.onreadystatechange();
		}, this));
		
		r.on('end', $.proxy(function() { 
			this.readyState = 4;
			
			this.onreadystatechange();
		}, this));
	}, this));
	
	this.onreadystatechange();
};

$.handleError = function( s, hr, status, e ) {
	// If a local callback was specified, fire it
	if ( s.error ) {
		s.error.call( s.context || s, hr, status, e );
	}
};

$.httpData = function( hr, type, s ) {	
	var ct = hr.getResponseHeader("content-type") || "",
		xml = type === "xml" || !type && ct.indexOf("xml") >= 0,
		data = xml ? hr.responseXML : hr.responseText;

	if ( xml && data.documentElement.nodeName === "parsererror" ) {
		throw "parsererror";
	}

	// Allow a pre-filtering function to sanitize the response
	// s is checked to keep backwards compatibility
	if ( s && s.dataFilter ) {
		data = s.dataFilter( data, type );
	}

	// The filter can actually parse the response
	if ( typeof data === "string" ) {
		// Get the JavaScript object, if JSON is used.
		if ( type === "json" || !type && ct.indexOf("json") >= 0 ) {
			data = JSON.parse( data );
		}
	}

	return data;
};

$.httpSuccess = function( hr ) {
	return ( hr.status >= 200 && hr.status < 300 ) ||
			 hr.status === 304 || hr.status === 1223 || hr.status === 0;
};

// Determines if an XMLHttpRequest returns NotModified
$.httpNotModified = function( hr, url ) {
	var lastModified = hr.getResponseHeader("Last-Modified"),
		etag = hr.getResponseHeader("Etag");

	if ( lastModified ) {
		$.lastModified[url] = lastModified;
	}

	if ( etag ) {
		$.etag[url] = etag;
	}

	return hr.status === 304;
};

$.extend = function() {
	// copy reference to target object
	var target = arguments[0] || {}, i = 1, length = arguments.length, deep = false, options, name, src, copy;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !$.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( length === i ) {
		target = this;
		--i;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging object literal values or arrays
				if ( deep && copy && ( $.isPlainObject(copy) || $.isArray(copy) ) ) {
					var clone = src && ( $.isPlainObject(src) || $.isArray(src) ) ? src
						: $.isArray(copy) ? [] : {};

					// Never move original objects, clone them
					target[ name ] = $.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

$.proxy = function(fn, thisObject) { 
    return function() { 
        return fn.apply(thisObject, arguments); 
    } 
};

$.isFunction = function(obj) {
    return toString.call(obj) === "[object Function]";
};

$.isArray = function( obj ) {
    return toString.call(obj) === "[object Array]";
};

$.isPlainObject = function( obj ) {
    // Must be an Object.
    // Because of IE, we also have to check the presence of the constructor property.
    // Make sure that DOM nodes and window objects don't pass through, as well
    if ( !obj || toString.call(obj) !== "[object Object]" || obj.nodeType || 
	 obj.setInterval ) {
	return false;
    }
    
    // Not own constructor property must be Object
    if ( obj.constructor
	 && !hasOwnProperty.call(obj, "constructor")
	 && !hasOwnProperty.call(obj.constructor.prototype, "isPrototypeOf") ) {
	return false;
    }
    
    // Own properties are enumerated firstly, so to speed up,
    // if last one is own, then all properties are own.
    
    var key;
    for ( key in obj ) {}
    
    return key === undefined || hasOwnProperty.call( obj, key );
};

$.isEmptyObject = function( obj ) {
	for ( var name in obj ) {
		return false;
	}
	return true;
};

// args is for internal usage only
$.each = function( object, callback, args ) {
	var name, i = 0, length = object.length, isObj = length === undefined || $.isFunction(object);

	if ( args ) {
		if ( isObj ) {
			for ( name in object ) {
				if ( callback.apply( object[ name ], args ) === false ) {
					break;
				}
			}
		} else {
			for ( ; i < length; ) {
				if ( callback.apply( object[ i++ ], args ) === false ) {
					break;
				}
			}
		}
    // A special, fast, case for the most common use of each
	} else {
		if ( isObj ) {
			for ( name in object ) {
				if ( callback.call( object[ name ], name, object[ name ] ) === false ) {
					break;
				}
			}
		} else {
			for ( var value = object[0];
				i < length && callback.call( value, i, value ) !== false; value = object[++i] ) {}
		}
	}

	return object;
};

// Serialize an array of form elements or a set of
// key/values into a query string
$.param = function( a ) {
	var s = [];
	
	// If an array was passed in, assume that it is an array of form elements.
	if ( $.isArray(a) || a.jquery ) {
		// Serialize the form elements
		$.each( a, function() {
			add( this.name, this.value );
		});
		
	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( var prefix in a ) {
			buildParams( prefix, a[prefix] );
		}
	}

	// Return the resulting serialization
	return s.join("&").replace(r20, "+");

	function buildParams( prefix, obj ) {
		if ( $.isArray(obj) ) {
			// Serialize array item.
			$.each( obj, function( i, v ) {
				if ( /\[\]$/.test( prefix ) ) {
					// Treat each array item as a scalar.
					add( prefix, v );
				} else {
					// If array item is non-scalar (array or object), encode its
					// numeric index to resolve deserialization ambiguity issues.
					// Note that rack (as of 1.0.0) can't currently deserialize
					// nested arrays properly, and attempting to do so may cause
					// a server error. Possible fixes are to modify rack's
					// deserialization algorithm or to provide an option or flag
					// to force array serialization to be shallow.
					buildParams( prefix + "[" + ( typeof v === "object" || $.isArray(v) ? i : "" ) + "]", v );
				}
			});
				
		} else if ( obj != null && typeof obj === "object" ) {
			// Serialize object item.
			$.each( obj, function( k, v ) {
				buildParams( prefix + "[" + k + "]", v );
			});
				
		} else {
			// Serialize scalar item.
			add( prefix, obj );
		}
	}

	function add( key, value ) {
		// If value is a function, invoke it and return its value
		value = $.isFunction(value) ? value() : value;
		s[ s.length ] = encodeURIComponent(key) + "=" + encodeURIComponent(value);
	}
};

$.ajax = function(origSettings) { 
    var s = $.extend(true, {}, $.ajaxSettings, origSettings);

    var jsonp, status, data,
        callbackContext = origSettings && origSettings.context || s,
        type = s.type.toUpperCase();

	// convert data if not already a string
	if ( s.data && s.processData && typeof s.data !== "string" ) {
		s.data = $.param( s.data ); 
	}
			
	if ( s.dataType === "script" && s.cache === null ) {
		s.cache = false;
	}

	if ( s.cache === false && type === "GET" ) {
		var ts = now();

		// try replacing _= if it is there
		var ret = s.url.replace(rts, "$1_=" + ts + "$2");

		// if nothing was replaced, add timestamp to the end
		s.url = ret + ((ret === s.url) ? (rquery.test(s.url) ? "&" : "?") + "_=" + ts : "");
	}
	
	// If data is available, append data to url for get requests
	if ( s.data && type === "GET" ) {
		s.url += (rquery.test(s.url) ? "&" : "?") + s.data;
	}

	// Matches an absolute URL, and saves the domain
	var parts = rurl.exec( s.url ), remote = false; // CHANGE: NO SANDBOX YAY
		
	var requestDone = false;
	
	var httpRequest = new $.httpRequest();
	
	httpRequest.open(type, s.url);
	
	// Set the correct header, if data is being sent
	if ( s.data || origSettings && origSettings.contentType ) {
		httpRequest.setRequestHeader("Content-Type", s.contentType);
	}
	
	// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
	if ( s.ifModified ) {
		if ( $.lastModified[s.url] ) {
			httpRequest.setRequestHeader("If-Modified-Since", $.lastModified[s.url]);
		}

		if ( $.etag[s.url] ) {
			httpRequest.setRequestHeader("If-None-Match", $.etag[s.url]);
		}
	}	

	// Set the Accepts header for the server, depending on the dataType
	httpRequest.setRequestHeader("Accept", s.dataType && s.accepts[ s.dataType ] ?
		s.accepts[ s.dataType ] + ", *" + "/*" :	s.accepts._default );

	// Allow custom headers/mimetypes and early abort
	if ( s.beforeSend && s.beforeSend.call(callbackContext, httpRequest, s) === false ) {
		// close opened socket
		httpRequest.abort();
		return false;
	}
		
	// Wait for a response to come back
	var onreadystatechange = httpRequest.onreadystatechange = function( isTimeout ) {
		var httpRequest = this;
		
		// The request was aborted
		if ( !httpRequest || this.readyState === 0 || isTimeout === "abort" ) {
			requestDone = true;

			if ( this ) {
				this.onreadystatechange = $.noop;
			}
			
		// The transfer is complete and the data is available, or the request timed out
		} else if ( !requestDone && httpRequest && (httpRequest.readyState === 4 || isTimeout === "timeout") ) {
			requestDone = true;
			httpRequest.onreadystatechange = $.noop;
			
			status = isTimeout === "timeout" ?
				"timeout" :
				!$.httpSuccess( httpRequest ) ?
					"error" :
					s.ifModified && $.httpNotModified( httpRequest, s.url ) ?
						"notmodified" :
						"success";

			var errMsg;

			if ( status === "success" ) {				
				// Watch for, and catch, XML document parse errors
				try {
					// process the data (runs the xml through httpData regardless of callback)
					data = $.httpData( httpRequest, s.dataType, s );
				} catch(err) {
					status = "parsererror";
					errMsg = err;
				}
			}
			
			if (s.onAjaxComplete) {
				s.onAjaxComplete.call(callbackContext, httpRequest, status);
			}

			// Make sure that the request was successful or notmodified
			if ( status === "success" || status === "notmodified" ) {
				success();
			} else {
				$.handleError(s, httpRequest, status, errMsg);
			}

			// Fire the complete handlers
			complete();

			if ( isTimeout === "timeout" ) {
				httpRequest.abort();
			}

			httpRequest = null;
		}
	};
	
	// Override the abort handler, if we can
	try {
		var oldAbort = httpRequest.abort;
		httpRequest.abort = function() {
			if ( httpRequest ) {
				oldAbort.call( httpRequest );
			}

			onreadystatechange( "abort" );
		};
	} catch(e) { }

	// Timeout checker
	if ( s.timeout > 0 ) {
		setTimeout(function() {
			// Check to see if the request is still happening
			if ( httpRequest && !requestDone ) {
				onreadystatechange( "timeout" );
			}
		}, s.timeout);
	}
	
	// Send the data
	try {
		if (s.oauthToken)
			httpRequest.setRequestHeader('X-OAuth', s.oauthToken);
		
		httpRequest.send( type === "POST" || type === "PUT" || type === "DELETE" ? s.data : null );
	} catch(e) {
		$.handleError(s, httpRequest, null, e);
		// Fire the complete handlers
		complete();
	}
	
	function success() {
		// If a local callback was specified, fire it and pass it the data		
		
		if ( s.success ) {
			s.success.call( callbackContext, data, status, httpRequest );
		}
	}
	
	function complete() {
		// Process result		
		if ( s.complete ) {
			s.complete.call( callbackContext, httpRequest, status );
		}
	}

	return httpRequest;
}; // end $.ajax

$.getJSON = function(url, callback) {
	return $.ajax({	url: url, dataType: 'json',	success: callback });
};

$.get = function(url, data, callback, type) {
	// shift arguments if data argument was omited
	if ($.isFunction(data)) {
		type = type || callback;
		callback = data;
		data = null;
	}
	
	return $.ajax({
		type: "GET",
		url: url,
		data: data,
		success: callback,
		dataType: type
	});
};

for (i in $) { exports[i] = $[i]; }