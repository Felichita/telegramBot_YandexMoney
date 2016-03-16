'use strict';

const mongoose = require('mongoose')
	, config = require('../config');

require('./users');
require('./schedule');

mongoose.connect(config.db.url, config.db.options);

var db = mongoose.connection;
db.on('error', function (err) {
	throw console.error(err);
});
db.on('disconnected', function () {
	console.log('Disconnected from DB.');
})
db.once('open', function () {
	console.log('Connection to DB was opened.');
});

module.exports = db;
