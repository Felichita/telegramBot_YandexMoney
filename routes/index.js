'use strict';

const yandexMoney = require('../modules/yandexMoney');

module.exports = function (app) {
	
	app.use('/', yandexMoney.getAccessToken);
	
	// catch 404 and forward to error handler
	app.use(function(req, res, next) {
		var err = new Error('Not Found');
		err.status = 404;
		next(err);
	});

	app.use(function(err, req, res, next) {
		res.status(err.status || 500);
		
		if (app.get('env') === 'production') {
			err.stack = '';
		}
		if (!err.status) err.status = 500;
		
		res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8'});
		res.write(err.toString());
		res.end();
	});
};