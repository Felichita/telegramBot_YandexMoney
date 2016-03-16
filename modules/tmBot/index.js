'use strict';

const config = require('../../config')
	, Users = require('mongoose').model('Users')
    , discounts = require('../discounts')
	, yandexMoney = require('../yandexMoney')
	, TelegramBot = require('node-telegram-bot-api')
	, bot = new TelegramBot(config.telegramAPI.token, { polling: true })
	, menu = require('./menu'); 

/**
 * Startup user and user authentication
 */
bot.onText(menu.start.name, function (msg, match) {
	var userId = msg.from.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) {
			console.log(`${msg}: ${err}`);
			switch (err.code) {
				case 'USER_NOT_FOUND':
					bot.sendMessage(userId, menu.start.userNotFound, menu.md);
					break;
				case 'USER_NOT_AUTHENTICATED':
					bot.sendMessage(userId, `${err.message} Введи свой пин-код:`);
					break;
				default:
					bot.sendMessage(userId, err.message);
					break;
			}
		} else if (user) {
			bot.sendMessage(userId, menu.start.knowUser, !user.accessToken ? menu.pin.form : !user.mobile ? menu.wallet.form : menu.wallet.start );
		}
	});
});

/**
 * Get user pin and check if account created or create if doesn't
 */
bot.onText(menu.pin.name, function (msg, match) {
	var userId = msg.from.id;
	var pin = msg.text;
	Users.findByUserId(userId, function (err, user) {
		if (err) { // create user
			Users.add(userId, pin, function (err, user) {
				if (err) return console.error(err);
				bot.sendMessage(userId, menu.pin.newPin, menu.pin.form);
			});
		} else {
			Users.authUser(userId, pin, function (err, user) {
				if (err) { // incorrect password
					bot.sendMessage(userId, menu.pin.errPin, menu.help.form);
				} else { // success authenticate
					bot.sendMessage(userId, menu.pin.auth, !user.accessToken ? menu.pin.form : !user.mobile ? menu.wallet.form : menu.wallet.start);
				}
			});
		}
	});
});

/**
 * Get yandex money token
 */
bot.onText(menu.yandexMoneyAuth.name, function (msg, match) {
	var userId = msg.from.id;
    Users.findByUserId(userId,function(err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(userId, menu.yandexMoneyAuth.notAuth);
		} else if (user.accessToken) { // Already authorized in Yandex Money
			bot.sendMessage(userId, "Яндекс.Деньги уже подключены!", !user.mobile ? menu.wallet.form : menu.wallet.start);
		} else { // Send url to get temporary token
			let url = yandexMoney.buildTokenUrl(userId);
			bot.sendMessage(userId, `${menu.yandexMoneyAuth.getToken}(${url})`, menu.md);
		}
	});
});

/**
 * Get info about bot
 */
bot.onText(menu.about_us.name, function (msg, match) {
	//var userId = msg.from.id;
    var chatId = msg.chat.id;
	bot.sendMessage(chatId, menu.about_us.info);
});

/**
 * Providing assistance to the user
 */
bot.onText(menu.help.name, function (msg, match) {
	var userId = msg.from.id;
	bot.sendMessage(userId, menu.help.info, menu.help.form);
});

/**
 * Give advice for users
 */
bot.onText(menu.help.advice, function (msg, match) {
    var chatId = msg.chat.id;
	var userId = msg.from.id;
	Users.findByUserId(userId, function (err, user) {
		if (err) {
			bot.sendMessage(chatId, "Авторизируйтесь пожалуйста, для этого пройдите авторизацию набрав команду <</start>>", menu.hide);
		} else {
			bot.sendMessage(chatId, "Для начала работы с ботом Выберите команду <</start>> и следуй инструкции", menu.hide);
		}
	});
});

/**
 * Delete account
 */
bot.onText(menu.help.delete, function (msg, match) {
	var userId = msg.from.id;
	yandexMoney.revokeToken(userId, function (message, form) {
		bot.sendMessage(userId, message, form);
	});
});

/**
 * Return user to the wallet menu
 */
bot.onText(menu.payment.back, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info, menu.help.form);
		} else {
			bot.sendMessage(chatId, "Возвращаю", !user.mobile ? menu.wallet.form : menu.wallet.start);
		}
	});
});

/**
 * Get user balance
 */
bot.onText(menu.wallet.balance, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	yandexMoney.getAccountInfo(userId, function (message, form) {
		bot.sendMessage(chatId, message, form);
	});
});

/**
 * Get last operation history
 */
bot.onText(menu.wallet.history, function (msg, match) {
    var chatId = msg.chat.id;
	var userId = msg.from.id;
	yandexMoney.getOperationHistory(userId, function (message, form) {
		bot.sendMessage(chatId, message, form);
	});
});

/**
 * Save user mobile into db
 */
bot.onText(menu.wallet.remember, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.findByUserId(userId, function (err, user) {
		if (err) {
			bot.sendMessage(chatId, "Ошибка! Пользователь не найден", menu.help.form);
		} else {
			bot.sendMessage(chatId, "Напишите свой номер телефона, пример ввода: 79219990099", menu.hide);
		}
	});
});

bot.onText(menu.payMobile.my, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	var mobile = msg.text;
	Users.setUserMobile(userId, mobile, function (err, user) {
		if (err) {
			console.error(err);
			bot.sendMessage(chatId, err.message, menu.help.form); // Помочь при ошибке незапоминания мобильного
		} else {
			console.info(`Added mobile for ${userId}`);
			bot.sendMessage(chatId, "Я запомнил ваш телефон, теперь вы можете пополнять свой телефон в Оплатить ⏩ Пополнение своего телефона", menu.wallet.start);
		}
	});
});

/**
 * Mobile phone payment
 */
bot.onText(menu.payment.myMobile, function (msg, match){
	//var userId = msg.from.id;
    var chatId = msg.chat.id;
	bot.sendMessage(chatId, "На какую сумму вы хотите пополнить?\nПример: 450 рублей", menu.hide);
});

bot.onText(menu.payMobile.sum, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	let amount = msg.text.split(' ')[0];
	yandexMoney.userMobilePayment(userId, amount, function (message, form) {
		bot.sendMessage(chatId, message, form);
	});
});

/**
 * User selects what to pay
 */
bot.onText(menu.payment.pay, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info);
		} else {
			bot.sendMessage(chatId, "Выберите что вы будете оплачивать", menu.payment.form);
		}
	});
});

/**
 * Bot asks to input the phone number and the amount of deposit
 */
bot.onText(menu.payment.mobile, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info);
		} else {
			if (!user.accessToken) return bot.sendMessage(userId, "Необходимо подключить Яндекс.Деньги!", menu.pin.form);
			bot.sendMessage(chatId, "Введите свой номер телефона и через пробел укажите на сколько хотите пополнить\nПример операции: '79219990099 200'", menu.hide);
		}
	});
});

/**
 * Process mobile payment
 */
bot.onText(menu.payMobile.name, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	let args = msg.text.split(' ');
	let phNumber = args[0];
	let amount = args[1];
	yandexMoney.mobilePayment(userId, phNumber, amount, function (message, form) {
		bot.sendMessage(chatId, message, form);
	});
});

/**
 * Make transfer to a credit card
 */
bot.onText(menu.transfer.name, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info, menu.help.form);
		} else {
			bot.sendMessage(chatId, "Выберите операцию", menu.transfer.form);
		}
	});
});

bot.onText(menu.transfer.anotherClient, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info, menu.help.form);
		} else {
			if (!user.accessToken) return bot.sendMessage(userId, "Необходимо подключить Яндекс.Деньги!", menu.pin.form);
			bot.sendMessage(chatId,"Введите номер карты и через пробел укажите сумму, которую хотите перевести. Дополнительно можно указать комментарий к переводу.\nПример сообщения: '410011161616877 200 От Андрея'", menu.hide);
		}
	});
});

bot.onText(menu.transfer.credit, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	var args = msg.text.split(' ');
	let accountNum = args[0];
	let amount = args[1];
	let message = '';
	for (var i = 2; i < args.lenght; i++){
		message += args[i] + ' ';
	}
	yandexMoney.p2pPayment(userId, accountNum, amount, message, function (message, form) {
		bot.sendMessage(chatId, message, form);
	});
});

/**
 * Control expenses
 */
bot.onText(menu.wallet.control, function (msg, match) {
	var userId = msg.from.id;
    var chatId = msg.chat.id;
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info, menu.help.form);
		} else {
			bot.sendMessage(chatId, "Выберите операцию", menu.expenses.form);
		}
	});
});

/**
 * Show discounts to user
 */
bot.onText(menu.expenses.discounts, function(msg, match){
    var chatId = msg.chat.id;
    discounts.getDiscounts(function (err, message) {
        if (err) return bot.sendMessage(chatId, "Не могу сейчас показать скидки");
        bot.sendMessage(chatId, "Скидка для тебя:\n" + message);
    });
});

/**
 * Assign intention
 */
bot.onText(menu.expenses.intention, function(msg, match){
    var chatId = msg.chat.id;
    bot.sendMessage(chatId, `Назначь цель для себя, к примеру:\n "Не потратить больше 10000", "Накопить 30000"`, menu.hide);
});

/**
 * toSave intention
 */
bot.onText(menu.expenses.dontspend, function(msg, match){
    var userId = msg.from.id;
    var chatId = msg.chat.id;
    var arg = msg.text.split(" ");
    var amount = arg[3];
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info);
		} else {
			if (!user.accessToken) return bot.sendMessage(chatId, "Необходимо подключить Яндекс.Деньги!", menu.pin.form);
			user.startSavingIntention(amount);
			let remainingBalance = user.dayRemainingBalance();
			user.save();
    		bot.sendMessage(chatId, `Понял, принял :)\nТеперь я буду помогать тебе сэкономить. Каждый день около _10 вечера_ будут приходить сообщения с советом по расходам на следующий день. Постарайся не выходить за предел расходов.\nТвой остаток средств на завтра: *${remainingBalance} ${yandexMoney.rublesWord(remainingBalance)}*`, menu.expenses.form);
		}
	});
});

bot.onText(menu.expenses.accumulate, function(msg, match){
    var userId = msg.from.id;
    var chatId = msg.chat.id;
    var arg = msg.text.split(" ");
    var amount = arg[1];
	yandexMoney.startAccumulation(userId, amount, function (message, form) {
		bot.sendMessage(chatId, message, form);
	});
});

bot.onText(menu.expenses.reach, function(msg, match){
    var userId = msg.from.id;
    var chatId = msg.chat.id;
    var arg = msg.text.split(" ");
    var amount = arg[1];
	Users.checkAuth(userId, function (err, user) {
		if (err) { // Errors: user not found or user not authenticated
			bot.sendMessage(chatId, menu.help.info);
		} else {
			if (!user.accessToken) return bot.sendMessage(chatId, "Необходимо подключить Яндекс.Деньги!", menu.pin.form);
    		bot.sendMessage(chatId, `Понял, принял :)\nЯ помогу тебе заработать. Каждый день около *10 часов* вечера будут приходить сообщения с недостающей суммой. Больше работай и постарайся сильно не тратиться. Успехов!`, menu.expenses.form);
		}
	});
});

bot.on('message', function (msg) {
	console.log(`${msg.from.id}: ${msg.text}`);
});

// bot.sendMessage('167505774', 'Ещё раз привет, я себя плохо чувствовала, поэтому вела себя неадекватно по отношению к тебе. Давай начнём сначала! /start');
// bot.sendMessage('73368065', 'Ещё раз привет, я себя плохо чувствовала, поэтому вела себя неадекватно по отношению к тебе. Давай начнём сначала! /start');
// bot.sendMessage('7975895', 'Ещё раз привет, я себя плохо чувствовала, поэтому вела себя неадекватно по отношению к тебе. Давай начнём сначала! /start');
// bot.sendMessage('164606931', 'Ещё раз привет, я себя плохо чувствовала, поэтому вела себя неадекватно по отношению к тебе. Давай начнём сначала! /start');
// bot.sendMessage('57885571', 'Ещё раз привет, я себя плохо чувствовала, поэтому вела себя неадекватно по отношению к тебе. Давай начнём сначала! /start');
// bot.sendMessage('167505774', 'Для подключения Яндекс.Денег нажми на ссылку выше!')

module.exports = bot;