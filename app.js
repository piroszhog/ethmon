process.title = 'ethmon';

var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var express_logger = require('morgan');

var routes = require('./routes/index');
var miners = require('./routes/miners');

var app = express();

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

// Uncomment after placing your favicon in /public
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(express_logger('dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Make miner data accessible to the router
app.use(function(req, res, next) {
    req.json = {
        "title"       : config.title,
        "animation"   : config.animation,
        "header"      : config.header ? config.header : config.title,
        "miners"      : miners.json,
        "refresh"     : config.web_refresh,
        "tolerance"   : config.tolerance,
        "temperature" : config.temperature,
        "hashrates"   : config.hashrates,
        "updated"     : moment().format("YYYY-MM-DD HH:mm:ss")
    };
    next();
});

app.use('/', routes);
app.use('/miners', miners);

// Catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// Error handlers

// Development error handler will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// Production error handler, no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;

// --------------- BOOT ---------------

var config = require('./config.json');

if (config.use_another_config){ config = require(config.use_another_config); }

var log4js = require('log4js');
var logstashLogger;

if (config.logstash_enable) {
	log4js.configure({
	  "appenders": [
		{
			"host": config.logstash_host,
			"port": config.logstash_port,
			"type": "logstashUDP",
			"logType": "miner_stats",
			"layout": {
				"type": "pattern",
				"pattern": "%m"
			},
			"category": "miner_stats"
		},
        {
            "host": config.logstash_host,
			"port": config.logstash_port,
			"type": "logstashUDP",
			"logType": "miner_errors",
			"layout": {
				"type": "pattern",
				"pattern": "%m"
			},
			"category": "miner_errors"
        }
	  ]
	});
	var statsLogger = log4js.getLogger("miner_stats");
    var errorsLogger = log4js.getLogger("miner_errors");
}

// --------------- /BOOT ---------------

// --------------- REQUESTER ---------------

var net = require('net');
var moment = require('moment');
require("moment-duration-format");

var miners = [];
miners.json = [];

config.miners.forEach(function(item, i, arr) {
    
    // settings
    var m = miners[i] = {};
    var c = config.miners[i];
    var j = miners.json[i];

    m.name = c.name;
    m.host = c.host;
    m.port = c.port;
    m.poll = (typeof c.poll !== 'undefined') ? c.poll : config.miner_poll;
    m.timeout = (typeof c.timeout !== 'undefined') ? c.timeout : config.miner_timeout;

    function hostname() {
        return c.hostname ? c.hostname : (m.host + ':' + m.port);
    }

    // stats
    m.reqCnt = 0;
    m.rspCnt = 0;

    // it was never seen and never found good yet
    c.last_seen = null;
    c.last_good = null;

    // socket
    m.socket = new net.Socket()

    .on('connect', function() {
        var req = '{"id":0,"jsonrpc":"2.0","method":"miner_getstat1"}';
        ++m.reqCnt;
        m.socket.write(req + '\n');
        m.socket.setTimeout(m.timeout);
    })

    .on('timeout', function() {
        m.socket.destroy();
        miners.json[i] = {
            "name"       : m.name,
            "host"       : hostname(),
            "uptime"     : "",
            "eth"        : "",
            "dcr"        : "",
            "eth_hr"     : "",
            "dcr_hr"     : "",
            "temps"      : "",
            "pools"      : "",
            "ver"        : "",
            "target_eth" : "",
            "target_dcr" : "",
            "comments"   : c.comments,
            "offline"    : c.offline,
            "warning"    : null,
            "error"      : 'Error: no response',
            "last_seen"  : c.last_seen ? c.last_seen : 'never'
        };
    })

    .on('data', function(data) {
        ++m.rspCnt;
        c.last_seen = moment().format("YYYY-MM-DD HH:mm:ss");
        m.socket.setTimeout(0);
        var d = JSON.parse(data);
        miners.json[i] = {
            "name"       : m.name,
            "host"       : hostname(),
            "uptime"     : moment.duration(parseInt(d.result[1]), 'minutes').format('d [days,] hh:mm'),
            "eth"        : d.result[2],
            "dcr"        : d.result[4],
            "eth_hr"     : d.result[3],
            "dcr_hr"     : d.result[5],
            "temps"      : d.result[6],
            "pools"      : d.result[7],
            "ver"        : d.result[0],
            "target_eth" : c.target_eth,
            "target_dcr" : c.target_dcr,
            "comments"   : c.comments,
            "offline"    : c.offline,
            "error"      : null
        };
        if (c.target_eth && config.tolerance) {
            if (miners.json[i].eth.split(';')[0] / 1000 < c.target_eth * (1 - config.tolerance / 100)) {
                miners.json[i].warning = 'Low hashrate';
                miners.json[i].last_good = c.last_good ? c.last_good : 'never';
            } else {
                miners.json[i].warning = null;
                c.last_good = moment().format("YYYY-MM-DD HH:mm:ss");
            }
        }
		
		if (statsLogger)
		{
			var jsonWithoutError = {
				"object"		    : config.object_id,
                "socket_response"   : data.toString().trim(),
				"name"			    : m.name,
				"host"			    : hostname(),
				"uptime"		    : miners.json[i].eth.uptime,
				"pools"			    : miners.json[i].pools.split(';'),
				"minerVersion"	    : miners.json[i].ver,
				"offline"		    : miners.json[i].offline,
				"last_good"		    : miners.json[i].last_good,		
				"ethSumHR"		    : parseInt(miners.json[i].eth.split(';')[0], 10),
				"ethAccepted"	    : parseInt(miners.json[i].eth.split(';')[1], 10),
				"ethRejected"	    : parseInt(miners.json[i].eth.split(';')[2], 10),
				"dcrSumHR"		    : parseInt(miners.json[i].dcr.split(';')[0], 10),
				"dcrAccepted"	    : parseInt(miners.json[i].dcr.split(';')[1], 10),
				"dcrRejected"	    : parseInt(miners.json[i].dcr.split(';')[2], 10)
			};

			for (var j = 0; j < miners.json[i].eth_hr.split(';').length; ++j){
				jsonWithoutError["eth" + j.toString() + "hr"] = parseInt(miners.json[i].eth_hr.split(';')[j], 10);
				jsonWithoutError["dcr" + j.toString() + "hr"] = parseInt(miners.json[i].dcr_hr.split(';')[j], 10);
				jsonWithoutError["temp" + j.toString()] = parseInt(miners.json[i].temps.split(';')[j*2], 10);
				jsonWithoutError["fan" + j.toString()] = parseInt(miners.json[i].temps.split(';')[j*2+1], 10);
			}
            
            for (var j = miners.json[i].eth_hr.split(';').length; j < 6; ++j){
				jsonWithoutError["eth" + j.toString() + "hr"] = null;
				jsonWithoutError["dcr" + j.toString() + "hr"] = null;
				jsonWithoutError["temp" + j.toString()] = null;
				jsonWithoutError["fan" + j.toString()] = null;
			}

			statsLogger.info("got stats", jsonWithoutError);
            jsonWithoutError = {};
		}
	
    })

    .on('close', function() {
        setTimeout(poll, m.poll);
    })

    .on('error', function(e) {
        miners.json[i] = {
            "name"       : m.name,
            "host"       : hostname(),
            "uptime"     : "",
            "eth"        : "",
            "dcr"        : "",
            "eth_hr"     : "",
            "dcr_hr"     : "",
            "temps"      : "",
            "pools"      : "",
            "ver"        : "",
            "target_eth" : "",
            "target_dcr" : "",
            "comments"   : c.comments,
            "offline"    : c.offline,
            "warning"    : null,
            "error"      : e.name + ': ' + e.message,
            "last_seen"  : c.last_seen ? c.last_seen : 'never'
        };
		
		if (errorsLogger)
		{
			var jsonWithError = {
				"object"	: config.object_id,
				"name"		: m.name,
				"host"		: hostname(),
				"uptime"	: "",
				"temps"		: "",
				"pools"		: "",
				"minerVersion"	: "",
				"offline"	: miners.json[i].offline,				
				"error"		: miners.json[i].error,
			};
			
			errorsLogger.info("got stats", jsonWithError);
            jsonWithError = {};
		}
		
    });

    function poll() {
        m.socket.connect(m.port, m.host);
    };

    if ((typeof c.offline === 'undefined') || !c.offline) {
        poll();
    } else {
        miners.json[i] = {
            "name"       : m.name,
            "host"       : hostname(),
            "uptime"     : "",
            "eth"        : "",
            "dcr"        : "",
            "eth_hr"     : "",
            "dcr_hr"     : "",
            "temps"      : "",
            "pools"      : "",
            "ver"        : "",
            "target_eth" : "",
            "target_dcr" : "",
            "comments"   : c.comments,
            "offline"    : c.offline,
            "error"      : null
        };
    }
});

// --------------- /REQUESTER ---------------
