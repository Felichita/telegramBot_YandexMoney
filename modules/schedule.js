const config = require('../config')
	, Schedule = require('mongoose').model('Schedule')
	, cron = require('node-schedule')
	, yandexMoney = require('./yandexMoney')
	, TelegramBot = require('node-telegram-bot-api')
	, bot = new TelegramBot(config.telegramAPI.token, { polling: false });
    
cron.scheduleJob('0 22 * * *', function () {
    console.info(`Cron started.`);
	Schedule.find({}, function (err, users) {
		if (err) console.error(err);
		users.forEach(function (user) {
			var userId = user.userId;
			yandexMoney.updateIntentions(userId, function (err, message) {
				if (err) return console.error(err);
				bot.sendMessage(userId, message);
			});
		});
	});
});