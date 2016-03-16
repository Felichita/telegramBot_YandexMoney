'use strict';

const http = require('http')
    , express = require('express')
	, ejs = require('ejs')
	, logger = require('morgan')
	, bodyParser = require('body-parser')
    , db = require('./db')
    , pkg = require('./package.json')
    , env = process.env.NODE_ENV || 'development'
    , port = process.env.PORT || pkg.port || '3000';

let app = express();
app.disable('x-powered-by');
app.set('env', env);
app.set('port', port);

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname + '/static'));

app.use(function (req, res, next) {
	console.info(req.headers);
	next();
});

// Schedule handler
require('./modules/schedule');
// Telegram bot handler
require('./modules/tmBot');
// Yandex Money API handler
require('./routes/')(app);

var server = http.createServer(app);
server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

/**
 * Event listener for HTTP server "error" event.
 */
function onError(error) {
	if (error.syscall !== 'listen') {
		throw error;
	}

	const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

	switch (error.code) {
		case 'EACCES':
			console.error(bind + ' requires elevated privileges');
			process.exit(1);
			break;
		case 'EADDRINUSE':
			console.error(bind + ' is already in use');
			process.exit(1);
			break;
		default:
			throw error;
	}
}

/**
 * Event listener for HTTP server "listening" event.
 */
function onListening() {
	const addr = server.address();
	const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
	console.log('Listening on ' + bind);
}
