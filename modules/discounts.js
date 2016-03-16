'use strict';

const crypto = require("crypto")
	, request = require('request')
    , grouponUrl = "http://api.groupon.ru/v3/sign_in.json"
    , merch = "http://api.groupon.ru/v3/merchants/offers.json"
    , email = "fridrixnm@gmail.com"
    , pass = "ngysenkis";

module.exports.getDiscounts = function(cb) {
    request.post({
		url: grouponUrl,
		form: {
			"user[email]": email,
			"user[password]": pass
		}
	}, function(err, res, body){
        if (err) {
			console.error(err);
			return cb(err);
		} else if (body !== "Превышен лимит запросов с одного IP") {
            let timestamp = Date.now();
            let groupon_id = body.user.api_id;
            let groupon_token = body.user.api_token;
            let signature = crypto.createHash('md5').update(`${groupon_id}_${groupon_token}_${timestamp}`).digest('hex');
            request.get({
				url: merch,
				form: {
					"api_id": groupon_id,
					"signature": signature,
					"timestamp": timestamp
				}
			}, function (err, res, data) {
				if (err) {
					console.error(err);
					return cb(err);
				}
                cb(null, data.offers[0].deal.option[0].title);
            });
        } else {
            cb(new Error("Ошибка сервиса"));
        }
    });
};