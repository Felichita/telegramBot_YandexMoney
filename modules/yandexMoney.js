'use strict';

const util = require('util')
	, config  = require('../config')
	, Users = require('mongoose').model('Users')
	, yandexMoney = require('yandex-money-sdk')
	, TelegramBot = require('node-telegram-bot-api')
	, bot = new TelegramBot(config.telegramAPI.token, { polling: false })
    , menu = require('./tmBot/menu');

/**
 * YaMoney auth GET middleware
 */
module.exports.getAccessToken = function (req, res, next) {
	if (!req.query.code) return next(new Error(`code expected`));
	let code = req.query.code;
	let tokenComplete = function (err, data, resp) {
		if (err) return next(new TokenError(`Токен не был получен: ${err}`));
        
	    var userId = req.query.userId;	
		var accessToken = data.access_token;
		
		// If token has not been received
		if (accessToken === undefined) return next(new TokenError(`Токен не был получен.`));
		else if (userId === undefined) return next(new Error(`Пользователь не задан.`));
			
		// Save user access token to DB
		Users.setUserToken(userId, accessToken, function(err) {
			if (err) return next(new Error(`Попробуйте ещё раз.`));
			console.info(`Added token for ${userId}`);
		});
		
		// Send success status
		res.render('index');
		
		// Send message to user into telegram
		bot.sendMessage(userId, "Поздравляем, ты успешно авторизован!", menu.wallet.form);
	};
    yandexMoney.Wallet.getAccessToken(config.yandexAPI.clientId, code, config.yandexAPI.redirectURI, config.yandexAPI.clientSecret, tokenComplete);
};

/**
 * Build URL to obtain token for user
 */
module.exports.buildTokenUrl = function (userId) {
	let redirectURI = `${config.yandexAPI.redirectURI}?userId=${userId}`;
	return yandexMoney.Wallet.buildObtainTokenUrl(config.yandexAPI.clientId, redirectURI, config.yandexAPI.scope);	
};

/**
 * Revoke user access token
 */
module.exports.revokeToken = function (userId, cb) {
	Users.findByUserId(userId, function (err, user) {
		if (err) return cb("Профиль не найден, введите команду /start");
		if (user.accessToken) {
			let accessToken = user.accessToken;
			yandexMoney.Wallet.revokeToken(accessToken);
		}
		user.remove({ userId: userId });
		cb("Профиль удален, для продолжения работы с ботом, введите команду /start", menu.hide);
	});
};

/**
 * Get account info from YaMoney
 */
module.exports.getAccountInfo = function (userId, cb) {
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			console.error(err);
			return cb(menu.help.info, menu.help.form);
		}
		if (!user.accessToken) return cb("Необходимо подключить Яндекс.Деньги!", menu.pin.form);
		let accessToken = user.accessToken;
		let api = new yandexMoney.Wallet(accessToken);
		api.accountInfo(function infoComplete(err, data) {
			if (err) {
				console.error(err);
				return cb("Упс.. Ошибочка! :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
			}
			let balance = data.balance;
			cb(`Твой баланс *${balance} ${rublesWord(balance)}*.`, !user.mobile ? menu.wallet.form : menu.wallet.start);
		});
	});
};

/**
 * Get last operation history 
 */
module.exports.getOperationHistory = function (userId, cb) {
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			console.error(err);
			return cb(menu.help.info, menu.help.form);
		}
		if (!user.accessToken) return cb("Необходимо подключить Яндекс.Деньги!", menu.pin.form);
		let accessToken = user.accessToken;
		let api = new yandexMoney.Wallet(accessToken);
		api.operationHistory({ records: 5 }, function operationHistoryComplete(err, data) {
			if (err) {
				console.error(err);
				return cb("Упс.. Ошибочка! :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
			}
			var msg = '';
			let operations = data.operations;
			operations.forEach(function (op) {
				if (op.status === 'success') {
					let date = new Date(op.datetime);
					let dd = date.getDate();
					let mm = date.getMonth() + 1;
					let dateStr = `${dd < 10 ? '0' + dd : dd}.${mm < 10 ? '0' + mm : mm}.${date.getFullYear()}`;
					let sign = op.direction === 'in' ? '+' : '-';
					msg += `\n*${dateStr}*: \`${sign}${op.amount} ${rublesWord(op.amount)}\` _"${op.title}"_`;
				}
			});
			cb(`*Твои последние операции:*${msg.length ? msg : '-' }`, !user.mobile ? menu.wallet.form : menu.wallet.start);
		});
	});
};

/**
 * Request user mobile payment and process it
 */
module.exports.userMobilePayment = function (userId, amount, cb) {
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			console.error(err);
			return cb(menu.help.info, menu.help.form);
		}
		if (!user.accessToken) return cb("Необходимо подключить Яндекс.Деньги!", menu.pin.form);
		if (!user.mobile) return cb("Не указан номер телефона!", menu.wallet.form);
		if (!amount) return cb("Не указана сумма перевода!", menu.wallet.form);
		
		let accessToken = user.accessToken;
		var api = new yandexMoney.Wallet(accessToken);
		let options = {
			"pattern_id": "phone-topup",
			"phone-number": user.mobile,
			"amount": amount
		};
		api.requestPayment(options, function requestComplete(err, data) {
			if (err) {
				console.error(err);
				return cb("Неправильный номер телефона, попробуйте ещё раз.", !user.mobile ? menu.wallet.form : menu.wallet.start);
			}
			if (data.status !== "success") return cb("Не удалось провести платёж. Не хватает средств :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
			let request_id = data.request_id;
			api.processPayment({ "request_id": request_id }, function processComplete(err, data) {
				if (err) {
					console.error(err);
					return cb("Упс.. Ошибочка! Оплата не совершена :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
				}
				cb("Платеж успешно принят на обработку ⏳", !user.mobile ? menu.wallet.form : menu.wallet.start);
			});
		});
	});
};

/**
 * Request mobile payment and process it
 */
module.exports.mobilePayment = function (userId, mobile, amount, cb) {
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			console.error(err);
			return cb(menu.help.info, menu.help.form);
		}
		if (!user.accessToken) return cb("Необходимо подключить Яндекс.Деньги!", menu.pin.form);
		if (!mobile) return cb("Не указан номер телефона!", menu.wallet.form);
		if (!amount) return cb("Не указана сумма перевода!", menu.wallet.form);
		
		let accessToken = user.accessToken;
		var api = new yandexMoney.Wallet(accessToken);
		let options = {
			"pattern_id": "phone-topup",
			"phone-number": mobile,
			"amount": amount
		};
		api.requestPayment(options, function requestComplete(err, data) {
			if (err) {
				console.error(err);
				return cb("Неправильный номер телефона, попробуйте ещё раз.", !user.mobile ? menu.wallet.form : menu.wallet.start);
			}
			if (data.status !== "success") return cb("Не удалось провести платёж. Не хватает средств :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
			let request_id = data.request_id;
			api.processPayment({ "request_id": request_id }, function processComplete(err, data) {
				if (err) {
					console.error(err);
					return cb("Упс.. Ошибочка! Оплата не совершена :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
				}
				cb("Платеж успешно принят на обработку ⏳", !user.mobile ? menu.wallet.form : menu.wallet.start);
			});
		});
	});
};

/**
 * Request p2p payment and process it
 */
module.exports.p2pPayment = function (userId, accountNum, amount, message, cb) {
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			console.error(err);
			return cb(menu.help.info, menu.help.form);
		}
		if (!user.accessToken) return cb("Необходимо подключить Яндекс.Деньги!", menu.pin.form);
		if (!accountNum) return cb("Не указан номер счёта!", menu.wallet.form);
		if (!amount) return cb("Не указана сумма перевода!", menu.wallet.form);
		
		let options = {
			"pattern_id": "p2p",
			"to": accountNum,
			"amount_due": amount,
			"comment": "payment",
			"message": message
		};
		let accessToken = user.accessToken;
		var api = new yandexMoney.Wallet(accessToken);
		api.requestPayment(options, function requestComplete(err, data) {
			if (err) {
				console.error(err);
				return cb("Неправильный номер карты, попробуйте ещё раз.", !user.mobile ? menu.wallet.form : menu.wallet.start);
			}
			if (data.status !== "success") return cb("Не удалось провести платёж. Не хватает средств :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
			let request_id = data.request_id;
			api.processPayment({ "request_id": request_id }, function processComplete(err, data) {
				if (err) {
					console.error(err);
					return cb("Упс.. Ошибочка! Оплата не совершена :(", !user.mobile ? menu.wallet.form : menu.wallet.start);
				}
				cb("Платеж успешно принят на обработку ⏳", !user.mobile ? menu.wallet.form : menu.wallet.start);
			});
		});
	});
};

/**
 * Processing user intentions
 */
module.exports.updateIntentions = function (userId, cb) {
	Users.findByUserId(userId, function (err, user) {
		if (err) return cb(err);
		if (!user.accessToken) return cb(TokenError(`Токен отсутствует.`));
		let accessToken = user.accessToken;
		var api = new yandexMoney.Wallet(accessToken);
		if (user.isToSave()) {
			api.operationHistory({ start_record: user.intentions.lastOpId, records: 100 }, function operationHistoryComplete(err, data) {
				if (err) {
					console.error(err);
					return cb(err);
				}
				if (user.daysToMonthLeft()) {
					var expense = 0;
					let operations = data.operations;
					operations.forEach(function (op) {
						if (op.status === 'success' && op.direction === 'out') {
							expense += op.amount;
						}
					});
					var remainingBalance = user.addExpense(expense);
					user.intentions.lastOpId += operations.length;
					if (remainingBalance < 0) {
						let plannedBalance = user.dayRemainingBalance();
						cb(null, `Сегодня был превышен лимит средств, в остальные дни придётся экономить! :(\nДоступно на завтра: ${plannedBalance} ${rublesWord(plannedBalance)}`);
					}
					else cb(null, `Молодец! Осталось на сегодня ${remainingBalance} ${rublesWord(remainingBalance)}.`);
				} else {
					let amount = user.intentions.toSave.amount;
					let expenses = user.intentions.toSave.expenses;
					let result = amount - expenses;
					cb(null, `Месяц завершён, а значит и цель сэкономить подошла к концу.\nНужно было не потратить более ${amount} ${rublesWord(amount)}\nБыло потрачено ${expenses} ${rublesWord(expenses)}\nРезультат экономии ${result} ${rublesWord(result)}`);
				}
				user.save();
			});
		}
		if (user.isToAccumulate()) {
			api.accountInfo(function infoComplete(err, data) {
				if (err) {
					console.error(err);
					return cb(err);
				}
				var balance = data.balance;
				if (user.checkAccumulation(balance)) {
					let accumulated = user.intentions.toAccumulate.amount;
					user.stopAccumulation();
					cb(null, `Поздравляю, цель достигнута! Накоплено ${accumulated} ${rublesWord(accumulated)}!`);
				} else {
					let amount = user.accumulateRemaining(balance);
					cb(null, `Осталось накопить ${amount}  ${rublesWord(amount)}`);
				}
				user.save();
			});
		}
	});
};

/**
 * Start accumulation
 */
module.exports.startAccumulation = function (userId, amount, cb) {
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			console.error(err);
			return cb(menu.help.info, menu.help.form);
		}
		if (!user.accessToken) return cb("Необходимо подключить Яндекс.Деньги!", menu.pin.form);
		let accessToken = user.accessToken;
		let api = new yandexMoney.Wallet(accessToken);
		api.accountInfo(function infoComplete(err, data) {
			if (err) {
				console.error(err);
				return cb("Упс.. Ошибочка! :(", menu.expenses.form);
			}
			let balance = data.balance;
			user.startAccumulation(amount, balance);
			user.save();
			cb(`Понял, принял :)\nЯ помогу тебе накопить. Каждый день около *10 часов* вечера будут приходить сообщения с оставшейся суммой. Постарайся сильно не тратиться. Успехов!`, menu.expenses.form);
		});
	});
};

/**
 * Setup Token Error
 */
function TokenError(message) {
    this.message = message;
    Error.captureStackTrace(this, TokenError);
}
util.inherits(TokenError, Error);
TokenError.prototype.name = 'Ошибка токена';

/**
 * Return word ending for number 
 */
var rublesWord = function (n) {
	var c = ['руб','лей','ль','ля'];
	return c[0] + ((/^[0,2-9]?[1]$/.test(n)) ? c[2] : ((/^[0,2-9]?[2-4]$/.test(n)) ? c[3] : c[1]));
}
module.exports.rublesWord = rublesWord;