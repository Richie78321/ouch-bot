var Discord = require('discord.js');
var auth = require('./auth.json');
var fs = require('fs');

const client = new Discord.Client();
client.on('ready', function() { console.log("Bot connected.") });
client.login(auth.token);

//Load commands if exist
if (fs.existsSync("./serverConfigs.json"))
{
  var serverConfigs = JSON.parse(fs.readFileSync("./serverConfigs.json"));
}
else
{
  var serverConfigs = {
    servers: []
  };
}
console.log("Loaded " + serverConfigs.servers.length + " server configs.");

client.on('message', onMessage);
var commands = [
  {
    keyword: "save",
    action: saveServerConfig
  },
  {
    keyword: "add",
    action: attemptAddContent
  }
];
function onMessage(message)
{
    if (message.content.substring(0, 1) == "!")
    {
      var args = message.content.substring(1).split(" ");
      for (let i = 0; i < commands.length; i++)
      {
        if (commands[i].keyword == args[0].toLowerCase())
        {
          //Command match
          commands[i].action(message, args.slice(1));
          break;
        }
      }
    }
}

function attemptAddContent(message, args)
{

}

function saveServerConfig(message, args)
{
  fs.writeFile("./serverConfigs.json", JSON.stringify(serverConfigs), function(err) {
    if (err) throw err;
    message.reply("Saved successfully.");
  });
}
