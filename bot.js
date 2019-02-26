var Discord = require('discord.js');
var auth = require('./auth.json');
var fs = require('fs');

const client = new Discord.Client();
client.on('ready', function() { console.log("Bot connected.") });
client.login(auth.token);

//Load commands
var commands = JSON.parse(fs.readFileSync("./commands.json"));
console.log("Loaded " + commands.audio_play.length + " audio commands.");

function saveCommands()
{
  fs.mkdir("./Log", function(err) {
    fs.rename("./commands.json", "./Log/commands" + new Date() + ".json", function(err) {
      if (err) throw err;
      fs.writeFile("./commands.json", JSON.stringify(commands), function(err) {
        if (err) throw err;
      });
    });
  });
}

saveCommands();
