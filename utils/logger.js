const { createLogger, format, transports } = require('winston');
const MESSAGE = Symbol.for('message');

const { LOG_LEVEL } = require('../config/config')

const json_formatter = (log_entry) => {
  const json_data = {timestamp: new Date()};
  json_data['level'] = log_entry['level'].toUpperCase();
  json_data['message'] = log_entry['message'];

  // log_entry[MESSAGE] is not in JSON format. Overwrite in JSON format.
  log_entry[MESSAGE] = JSON.stringify(json_data);  
  
  return log_entry;
}

const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(format(json_formatter)()),
  transports: [
    new transports.Console(),
  ],
});

module.exports = logger;
