'use strict';

const crypto = require('crypto')
	, mongoose = require('mongoose')
	, Schema = mongoose.Schema;

var userSchema = new Schema({
	userId: {
		 type: String,
		 unique: true,
		 required: true
	},
	mobile: String,
	hashedPin: {
		type: String,
		required: true
	},
	salt: {
		type: String,
		required: true
	},
	hashedToken: {
		type: String
	},
	tokenExpire: Date,
	intentions: {
		toSave: {
			amount: Number, // сколько нужно сэкономить
			expenses: Number, // потрачено
			from: Date // когда начал копить
		},
		toAccumulate: {
			balance: Number, // начальный баланс
			amount: Number // сколько нужно накопить
		},
		lastOpId: {
			type: Number,
			default: 0
		}
	},
	lastSeen: {
		type: Date,
		default: Date.now()
	}
});

/**
 * Virtual pin-code: numeric, length 4
 */
userSchema.virtual('pin')
	.set(function(pin) {
		this.salt = Math.random().toString();
		this.hashedPin = this.encryptPassword(pin);
	})
	.get(function() {
		return this.hashedPin;
	});

/**
 * Virtual accessToken which encrypt and decrypt hashedToken
 */
userSchema.virtual('accessToken')
	.set(function(token) {
		this.hashedToken = this.encryptToken(token);
		this.tokenExpire = Date.now() + 94608000000; // 3 years to expire in ms
	})
	.get(function() {
		return this.hashedToken && this.tokenExpire - Date.now() > 0 ? this.decryptToken() : null;
	});

/**
 * Method for encrypt pin-code
 */
userSchema.methods.encryptPassword = function(pin) {
	return crypto.createHmac('md5', this.salt).update(pin).digest('hex');
};

/**
 * Method for checking pin-code
 */
userSchema.methods.checkPassword = function(pin) {
	return this.encryptPassword(pin) === this.pin;
};

/**
 * Method for encrypting yandex money token
 */
userSchema.methods.encryptToken = function(token) {
	let cipher = crypto.createCipher('des-ede3-cbc', this.hashedPin);
	let encrypted = cipher.update(token, 'utf8', 'hex');
	encrypted += cipher.final('hex');
	return encrypted;
};

/**
 * Method for decrypting yandex money token
 */
userSchema.methods.decryptToken = function() {
	let decipher = crypto.createDecipher('des-ede3-cbc', this.hashedPin);
	let token = decipher.update(this.hashedToken, 'hex', 'utf8');
	token += decipher.final('utf8');
	return token;
};

/**
 * Method for checking user authorization
 * @ return true if last seen less then 15 minutes. Otherwise return false
 */
userSchema.methods.isAuth = function () {
	return Date.now() - this.lastSeen < 30*60*1000; // 30 minutes
};

/**
 * Methods for checking user intentions setting
 */
userSchema.methods.isToSave = function () {
	return this.intentions.toSave.amount ? true : false;
};
userSchema.methods.isToAccumulate = function () {
	return this.intentions.toAccumulate.amount ? true : false;
};

/**
 * Methods to start/stop saving intention
 */
userSchema.methods.startSavingIntention = function (amount) {
	if (!this.isToSave() && !this.accumulateRemaining()) {
		let Schedule = mongoose.model('Schedule');
		let schedule = new Schedule({ userId: this.userId });
		schedule.save(function (err, res) {
			if (err) console.log(err);
			else console.log(res);
		});
	}
	this.intentions.toSave.amount = amount;
	this.intentions.toSave.expenses = 0;
	this.intentions.toSave.from = new Date();
};

userSchema.methods.stopSavingIntention = function () {
	this.intentions.toSave.amount = null;
	this.intentions.toSave.expenses = null;
	this.intentions.toSave.from = null;
	if (!this.isToSave() && !this.isToAccumulate()) {
		let Schedule = mongoose.model('Schedule');
		Schedule.remove({ userId: this.userId }, function (err, res) {
			if (err) console.log(err);
			else console.log(res);
		});
	}
};

/**
 * Method for getting days to month left
 */
userSchema.methods.daysToMonthLeft = function () {
	let date = new Date();
	let dtml = 32 - new Date(date.getFullYear(), date.getMonth(), 32).getDate() - this.intentions.toSave.from.getDate();
	if (!dtml) { // 0 days, month ended, remove user form schedule if neccessary
		if (!this.isToSave() && !this.isToAccumulate()) {
			let Schedule = mongoose.model('Schedule');
			Schedule.remove({ userId: this.userId }, function (err, res) {
				if (err) console.log(err);
				else console.log(res);
			});
		}
	}
	return dtml;
};

/**
 * Method for calculating remaining balance to day
 */
userSchema.methods.dayRemainingBalance = function () {
	if (!this.isToSave()) return '0';
	let dtml = this.daysToMonthLeft();
	return ((this.intentions.toSave.amount - this.intentions.toSave.expenses) / dtml).toFixed(0);
};

userSchema.methods.addExpense = function (value) {
	this.intentions.toSave.expenses += value;
	return this.dayRemainingBalance();
};

/**
 * Method to start/stop accumulating intention
 */
userSchema.methods.startAccumulation = function (amount, balance) {
	if (!this.isToSave() && !this.accumulateRemaining()) {
		let Schedule = mongoose.model('Schedule');
		let schedule = new Schedule({ userId: this.userId });
		schedule.save(function (err, res) {
			if (err) console.log(err);
			else console.log(res);
		});
	}
	this.intentions.toAccumulate.balance = balance;
	this.intentions.toAccumulate.amount = amount;
};

userSchema.methods.stopAccumulation = function () {
	this.intentions.toAccumulate.balance = null;
	this.intentions.toAccumulate.amount = null;
	if (!this.isToSave() && !this.isToAccumulate()) {
		let Schedule = mongoose.model('Schedule');
		Schedule.remove({ userId: this.userId }, function (err, res) {
			if (err) console.log(err);
			else console.log(res);
		});
	}
};

/**
 * Check user accumulation
 */
userSchema.methods.checkAccumulation = function (balance) {
	return balance - this.intentions.toAccumulate.balance >= this.intentions.toAccumulate.amount;
};
userSchema.methods.accumulateRemaining = function (balance) {
	return (this.intentions.toAccumulate.amount + this.intentions.toAccumulate.balance) - balance;
};

/**
 * Static method for find user by id
 * @returns {function} - the Error if user wasn't found or another error occured. Otherwise return user document or fields of projection
 */
userSchema.statics.findByUserId = function (userId, fields, cb) {
	if (userId == null || userId == undefined) throw new SyntaxError('Not specified userId');
	else if (typeof fields === 'function') {
		cb = fields;
		fields = '';
	}

	return this.findOne({ userId: userId }, fields, function (err, user) {
		if (err) cb(err);
		else if (!user) cb(new UserError(0, 'Пользователь не был найден!'));
		else cb(null, user);
	});
};

/**
 * Static method for adding user
 */
userSchema.statics.add = function (userId, pin, cb) {
	let Users = mongoose.model('Users');
	let user = new Users({
		userId: userId,
		pin: pin
	});
	user.save(function (err, user) {
		if (err) {
			console.error(err);
			return cb(err);
		}
		console.log(`Added user '${userId}'`);
		return cb(null, user);
	});
};

/**
 * Static method for user authentication
 */
userSchema.statics.authUser = function (userId, pin, cb) {
	return this.findByUserId(userId, function (err, user) {
		if (err) {
			cb(err);
		} else if (!user || !user.checkPassword(pin)) {
			cb(new UserError(2, 'Неверный пин-код!'));
		} else {
			// Update user last seen date (set user status to "authenticated")
			user.lastSeen = Date.now();
			user.save(cb);
		}
	});
};

/**
 * Static method to check user authenticate
 */
userSchema.statics.checkAuth = function (userId, cb) {
	return this.findByUserId(userId, function (err, user) {
		if (err) cb(err);
		else if (!user.isAuth()) cb(new UserError(1, 'Необходимо пройти авторизацию!'));
		else {
			// Update user last seen date (set user status to "authenticated")
			user.lastSeen = Date.now();
			user.save(cb);
		}
	});
};

/**
 * Static method to setting yandex money token
 */
userSchema.statics.setUserToken = function (userId, token, cb) {
	return this.findByUserId(userId, function (err, user) {
		if (err) return cb(err);
		user.accessToken = token;
		user.save(cb);
	});
};

/**
 * Static method to setting user mobile
 */
userSchema.statics.setUserMobile = function (userId, mobile, cb) {
	return this.findByUserId(userId, function (err, user) {
		if (err) return cb(err);
		user.mobile = mobile;
		user.save(cb);
	});
};

mongoose.model('Users', userSchema);

/**
 * Custom user error type
 * @param {number} code - error code:
 * 	0 - user not found
 * 	1 - user not authenticated
 * 	2 - incorrect password
 * @param {string} message - error description
 */
function UserError(code, message) {
	this.code = code || 0;
	this.message = message || '';
	switch (this.code) {
		case 0: this.code = 'USER_NOT_FOUND'; break;
		case 1: this.code = 'USER_NOT_AUTHENTICATED'; break;
		case 2: this.code = 'INCORRECT_PASSWORD'; break;
		default: this.code = 'UNEXPECTED_ERROR'; break;
	}
	Error.captureStackTrace(this, UserError);
}
UserError.prototype = Object.create(Error.prototype);
UserError.prototype.constructor = UserError;
UserError.prototype.name = 'UserError';


// var userId = 'user one28';
// var pin = '4321';
// var accessToken = '1234567890qwerty';

// var user = new Users({
// 	userId: userId,
// 	pin: pin
// });

// user.save();

// user.startSavingIntention(18000);
// console.log(user.dayRemainingBalance());
// user.stopSavingIntention();
// console.log(user.dayRemainingBalance());
// user.startAccumulation(15000, 2);
// console.log(user);
// console.log('==================');
// console.log(user.checkAccumulation(12000));
// console.log(user.checkAccumulation(15002));
// console.log(user.checkAccumulation(15003));
// console.log(user.checkAccumulation(-15555));
// user.stopAccumulation(user);
// console.log(user);

// Users.add(userId, pin, function (err, user) {
// 	if (err) return console.log('ошибка');
// 	console.log('success');
// });

// Users.authUser(userId, '4321', function (err, user) {
// 	console.info('authUser');
// 	if (err) return console.error(err);
// 	console.log(user);
// });


// Users.checkAuth(userId, function (err, token) {
// 	console.info('checkAuth');
// 	if (err) return console.error(err);
// 	console.log(token);
// });

// Users.findByUserId(userId, function (err, user) {
// 	if (err) return console.error(err);
// 	user.lastSeen = 432112412;
// 	user.save();
// });

// Users.findByUserId('user one26', '', function (err, user) {
// 	if (err) return console.error(err);
// 	console.log(user.toJSON({ virtuals: true }));
// 	// user.accessToken = 'qwerty1234567890';
// 	// user.save();
// });

// Users.setUserToken(userId, accessToken, function(err) {
// 	if (err) return console.error(err);
// 	console.info(`Added token for ${userId}`);
// });

// Users.findOne({ userId: 'user one25' }, '', function (err, user) {
// 	console.log(arguments);
// });

// console.log('Create user1');
// var user1 = new Users({
// 	userId: 'user one25',
// 	pin: '4321'
// });
// user1.accessToken = '1234567890qwerty';
// user1.save();

// Users.findOne({ userId: 'user one25' }, function (err, user) {
// 	console.log(`first ${user.accessToken}`);
// 	user.accessToken = 'qwerty1234567890';
// 	user.save();
// 	Users.findOne({ userId: 'user one25' }, function (err, user) {
// 		console.log(`second ${user.accessToken}`);
// 	});
// });

// Users.checkAuth('user one', '1234', function(err, user) {
// 	if (err) console.log(err);
// 	console.log(`checkAuth: ${user.accessToken}`);
// });