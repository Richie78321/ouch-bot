var Discord = require('discord.js');
var auth = require('./auth.json');
var fs = require('fs');
var http = require('https');

const client = new Discord.Client();
client.on('ready', function() {
  console.log("Bot connected.")
});
client.login(auth.token);

client.on('message', onMessage);
var commands = [
  {
    keyword: "add",
    action: attemptAddContent
  },
  {
    keyword: "ouch",
    action: playAudio
  },
  {
    keyword: "delete",
    action: attemptRemoveContent
  },
  {
    keyword: "list",
    action: listFiles
  }
];

function onMessage(message) {
  if (message.content.substring(0, 1) == "!") {
    var args = message.content.substring(1).split(" ");
    for (let i = 0; i < commands.length; i++) {
      if (commands[i].keyword == args[0].toLowerCase()) {
        //Command match
        commands[i].action(message, args.slice(1));
        break;
      }
    }
  }
}

function listFiles(message, args) {
  fs.mkdir('./Content/' + message.guild, { recursive: true }, (err) => {
    if (err) throw err;
    fs.readdir('./Content/' + message.guild, (err, files) => {
      var printString = "";
      for (let i = 0; i < files.length - 1; i++) {
        printString += files[i].split('.')[0] += ", ";
      }
      printString += files[files.length - 1].split('.')[0];

      message.reply("Available audio files: " + printString);
    });
  });
}

function playAudio(message, args)
{
  fs.mkdir('./Content/' + message.guild, { recursive: true }, (err) => {
    if (err) throw err;
    fs.readdir('./Content/' + message.guild, { withFileTypes: true }, (err, files) => {
      if (err) throw err;
      for (let i = 0; i < files.length; i++)
      {
        if (files[i].name.split(".")[0] == args[0])
        {
          speakSound(message, './Content/' + message.guild + "/" + files[i].name);
          return;
        }
      }
    });
  });
}

function speakSound(message, audioPath) {
  if (message.member.voiceChannel) {
    message.member.voiceChannel.join().then(connection => {
      //Play audio when connected.
      let split = audioPath.split("/");
      console.log("Playing " + split[split.length - 1]  + " in " + message.member.guild + "...")
      var dispatcher = connection.playFile(audioPath);
      dispatcher.on('error', e => {
        console.log(e);
      });
      dispatcher.on('end', () => {
        setTimeout(() => { message.member.voiceChannel.leave(); }, 1000);
      });
    }).catch(console.log);
  } else {
    message.reply("Join a channel, dingus.");
  }
}

function attemptAddContent(message, args) {
  if (message.attachments.array().length >= 1)
  {
    //Format name
    var formattedName = args[0].replace(/[^a-z0-9_\-]/gi, '').toLowerCase();

    //Ensure not repeat name
    fs.mkdir('./Content/' + message.guild, { recursive: true }, (err) => {
      if (err) throw err;
      fs.readdir('./Content/' + message.guild, (err, files) => {
        if (err) throw err;
        for (let i = 0; i < files.length; i++)
        {
          if (files[i].split('.')[0] == formattedName)
          {
            message.reply("This audio name has already been taken! Please change the name or remove the existing audio file using ''!remove'.")
            return;
          }
        }

        //Get file from link
        try
        {
          var request = http.get(message.attachments.array()[0].url, (response) => {
            if (response.headers['content-type'].includes("audio"))
            {
              var audioFile = fs.createWriteStream("./Content/" + message.guild + "/" + formattedName + "." + message.attachments.array()[0].url.split('.').pop());
              response.pipe(audioFile);
              message.reply("Audio file added successfully! Type '!ouch " + formattedName + "' to play it!");
            }
            else message.reply("The media requested is not recognized as an audio file. Please change the audio filetype and try again.");
          });
        }
        catch (err)
        {
          console.log(err);
          message.reply("Failed to get media from supplied URL. Ensure that the supplied URL is a direct media URL (it will have the audio filename extension, like '.mp3', on the end).");
        }
      });
    });
  }
  else message.reply("Please embed an audio file (send it to Discord and add this command as an attached message).");
}

function attemptRemoveContent(message, args) {
  fs.mkdir('./Content/' + message.guild, { recursive: true }, (err) => {
    if (err) throw err;
    fs.readdir('./Content/' + message.guild, { withFileTypes: true }, (err, files) => {
      if (err) throw err;
      for (let i = 0; i < files.length; i++)
      {
        if (files[i].name.split('.')[0] == args[0])
        {
          fs.unlink('./Content/' + message.guild + '/' + files[i].name, (err) => {
            if (err) throw err;
            message.reply("Removed audio file with name " + args[0] + ".");
          });
          return;
        }
      }
      message.reply("Failed to remove the audio file. This is likely because no such file exists.");
    });
  });
}
