/**
 * A @todo bot for https://discordapp.com/
 *
 * @author Jared Allard <jaredallard@outlook.com>
 * @license MIT
 * @version 1.0
 **/

'use strict';

const DiscordClient = require('discord.io');
const orchestrate   = require('orchestrate');
const async         = require('async');
const moment        = require('moment');
const crypto        = require('crypto');
const markutils     = require('./lib/simplemarkdown.js');

const config = require('./config/config.json')

const log = (data) => {
  console.log('[todo]', data);
}

/**
 * Simple markutils wrapper for bot messages.
 *
 * @param {Object} bot     - bot object from discord.
 * @param {String/Int} to  - channel id to send to.
 * @param {String} message - plaintext object.
 * @param {Object} opts    - handlebars like parse object.
 *
 * @returns {bool} success
 **/
const sendMessage = (bot, to, message, opts) => {
  if(to === undefined) { // using object params.
     to      = bot.to;
     message = bot.message;
     opts    = bot.opts;

     // shift bot.bot to bot.
     bot = bot.bot;
  }

  let finalmessage = '';
  finalmessage = markutils.parse(message, opts);

  return bot.sendMessage({
    to: to,
    message: finalmessage
  })
}

const submitTask = (bot, user, channel, message) => {
  log('new task: '+message);

  message = message.replace(/^\s/g, '');

  function cb(err) {
    let status = 'failed';
    if(!err) {
      status = 'succedded';
    }

    return sendMessage({
      bot: bot,
      to: channel,
      message: '<@{user}> Task creation {bold:status}',
      opts: {
        user: user,
        status: status
      }
    })
  }

  async.waterfall([
    function(next) {
      db.get('todo', 'nextkey')
      .then(function (result) {
        const nextKey = parseInt(result.body.id);
        log('Creating task #'+nextKey);

        return next(null, nextKey);
      })
      .fail(function(err) {
        return next(err);
      })
    },

    function(nextKey, next) {
      log('Next task ID set to: '+(Math.floor(nextKey+1)));
      db.put('todo', 'nextkey', {
        "id": Math.floor(nextKey+1)
      })
      .then(function (result) {
        return next(null, nextKey);
      })
      .fail(function(err) {
        return next(err);
      })
    },

    function(nextKey, next) {
      db.put('todo', nextKey.toString(), {
        "id": nextKey,
        "text": message,
        "status": "open",
        "createdby": user,
        "due": null,
        "desc": null,
        "created": Date.now()
      }).then(function(result) {
        return cb(null)
      }).fail(function(err) {
        return cb(true, err);
      });
    }
  ], function(err) {
    if(err) {
      console.log(err);
      return cb(true);
    }

    return cb(null);
  })
}

const getTasks = (bot, user, channel, status) => {
  db.list('todo')
  .then(function (result) {
    let results = result.body.results;
    results.forEach((v, i) => {
      if(v.path.key === 'nextkey') {
        results.splice(i, 1);
      }
    });

    // format message.
    let amount = 0;
    let message_head = '<@{user}> There are currently {bold:tasksnumber} {status} tasks\n';
    results.forEach((v) => {
      let id       = v.value.id;
      let text     = v.value.text;
      let created  = v.value.created;
      let vstatus  = v.value.status;
      let mot      = v.value.modified;

      if(vstatus !== status && status !== 'all') {
        return;
      }

      amount++;

      let created_human = moment(created).format('MMMM Do YYYY, h:mm:ss a');
      let mot_human     = moment(mot).format('MMMM Do YYYY, h:mm:ss a');

      if(id == 1) {
        id+=' '
      }
      let pre = '   #{bold:"'+id+'"}: '+text;
      message_head += pre+'\n'
      message_head += '       *-->* {italic:"Created at"} : '+created_human+'\n';
      if(mot) {
        message_head += '       *-->* {italic:"Last Modified"} : '+mot_human+'\n';
      }
    });
    let message_foot = 'To see all tasks (closed/open) try **<@{botid}>** list all';

    if(status !== 'all') message_head += message_foot;

    return sendMessage({
      bot: bot,
      to: channel,
      message: message_head,
      opts: {
        user: user,
        tasksnumber: amount,
        status: status,
        botid: bot.id
      }
    })
  })
  .fail(function (err) {
    return sendMessage({
      bot: bot,
      to: channel,
      message: '<@{user}> Failed to get tasks :frowning:',
      opts: {
        user: user
      }
    });
  });
}

const deleteTask = (bot, user, channel, id) => {
  if(id === 'nextkey') return false;

  async.waterfall([
    function(next) {
      db.get('todo', id)
      .then(function (result) {
        return next(null);
      })
      .fail(function(err) {
        return next(err);
      })
    },

    function(next) {
      db.remove('todo', id, true)
      .then((result) => {
        return sendMessage({
          bot: bot,
          to: channel,
          message: '<@{user}> Task deleted.',
          opts: {
            user: user
          }
        });
      })
      .fail(function (err) {
        return next(err);
      });
    }
  ], function(err) {
    return sendMessage({
      bot: bot,
      to: channel,
      message: '<@{user}> Failed to delete the task. :frowning:',
      opts: {
        user: user
      }
    });
  });
}

const modifyTask = (bot, user, channel, id, type, data) => {
  if(id === 'nextkey') return false;

  async.waterfall([
    function(next) {
      db.get('todo', id)
      .then(function (result) {
        return next(null);
      })
      .fail(function(err) {
        return next(err);
      })
    },

    function(next) {
      let modification = {};
      if(type === 'text') {
        modification.text = data;
        modification.modified = Date.now()
      } else {
        return next(true);
      }

      db.merge('todo', id, modification)
      .then(function (result) {
        return sendMessage({
          bot: bot,
          to: channel,
          message: '<@{user}> Successfully modified the task. :sparkles:',
          opts: {
            user: user
          }
        })
      })
      .fail(function (err) {
        return next(err);
      })
    }
  ], function(err) {
    return sendMessage({
      bot: bot,
      to: channel,
      message: '<@{user}> Failed to modify the task. :frowning:',
      opts: {
        user: user
      }
    });
  });
}

// instance the bot
let bot = new DiscordClient({
    autorun: true,
    email: config.email,
    password: config.password
});

// establish the database connection.
const db = orchestrate(config.oc.api_key, config.oc.server)
db.ping()
.then(function () {
  log('oio db service is VALID')
})
.fail(function (err) {
  log('oio db service is INVALID')
  process.exit(1)
})

bot.on('ready', function() {
    console.log(bot.username + " - (" + bot.id + ")");
});

bot.on('message', function(user, userID, channelID, message, rawEvent) {
  let isMention = new RegExp('^\<@'+bot.id+'\>');

  if(!isMention.test(message)) { // not at us
    return;
  }

  // pre-process the message, remove the @
  message = message.replace(isMention, '');

  let opts = message.split(' ');

  if(opts[1] === 'remind') {

  } else if(opts[1] === 'info' && opts[3] === undefined) {
    return getInfo(bot, userID, channelID, opts[2]);
  } else if(opts[1] === 'modify') {
                                              // id,   type,    value
    return modifyTask(bot, userID, channelID, opts[2], opts[3], opts[4])
  } else if(opts[1] === 'delete' && opts[3] === undefined) {
    return deleteTask(bot, userID, channelID, opts[2])
  } else if(opts[1] === 'list' && opts[3] === undefined) {
    let status;
    if(opts[2] === undefined) {
      status = 'open';
    } else {
      status = opts[2];
    }

    return getTasks(bot, userID, channelID, status);
  } else if(opts[1] === 'create' || opts[5] !== undefined) {
    if(opts[1] === 'create') {
      console.log('message:', message);

      let pmsg = message.replace(/ create /, '');

      console.log('patched_message:', pmsg);

      message = pmsg;
    }
    return submitTask(bot, userID, channelID, message);
  } else {
    return sendMessage({
      bot: bot,
      to: channelID,
      message: '<@{user}> Tasks must be at least 5 words long without the create argument, sorry! :cry:',
      opts: {
        user: userID
      }
    });
  }
});
