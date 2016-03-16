'use strict';

const mongoose = require('mongoose')
	, Schema = mongoose.Schema;

var scheduleSchema = new Schema({
	userId: {
		 type: String,
		 unique: true,
		 required: true
	}
});

mongoose.model('Schedule', scheduleSchema);