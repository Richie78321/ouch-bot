var Discord = require('discord.js');
var auth = require('./auth.json');
var fs = require('fs');
var glob = require('glob');
var path = require('path');
var http = require('https');

const PLAY_DELAY = 250;
const END_LEAVE_DELAY = 30000;

const client = new Discord.Client();
client.on('ready', () => { console.log("Bot connected"); });
client.login(auth.token).catch((error) => {
    console.log("Bot failed to connect.");
    console.error(error);
});

client.on('message', onMessage);

var serverInstances = {};
function ServerInstance(id)
{
    this.id = id;
    this.playQueue = [];
    this.isActive = false;
    this.currentDispatcher = null;
    this.disconnectTimers = 0;
    this.filepath = './Content/' + id + "/";

    this.queueSound = (message, audioPath) => {
        this.playQueue.push({
            audioPath,
            message,
            voiceChannel: message.member.voiceChannel
        });

        if (!this.isActive)
        {
            // Start audio playback
            this.startPlayback();
        }
    };

    this.startPlayback = () => {
        this.isActive = true;
        this.playNextAudio();
    };

    this.playNextAudio = () => {
        if (this.playQueue.length < 1)
        {
            console.log("Attempted to play next with none left -- this is a rare occurence and shouldn't really happen.");
            this.isActive = false;
            return;
        }
        var request = this.playQueue.shift();
        
        request.voiceChannel.join()
        .then((connection) => {
            console.log(`Playing ${path.basename(request.audioPath)} in ${request.message.member.guild}`);

            function checkForNext() {
                if (this.playQueue.length > 0)
                {
                    // Play next audio clip in queue after timeout
                    setTimeout(this.playNextAudio.bind(this), PLAY_DELAY);
                }
                else
                {
                    // Commence disconnect sequence
                    this.disconnectTimers++;
                    this.isActive = false;
                    setTimeout(() => {
                        // Disconnect if last disconnect timer
                        this.disconnectTimers--;
                        if (this.disconnectTimers <= 0)
                        {
                            this.currentDispatcher = null;
                            connection.disconnect();
                        }
                    }, END_LEAVE_DELAY);
                }
            }

            this.currentDispatcher = connection.playFile(request.audioPath);
            this.currentDispatcher.on('error', (err) => {
                console.error("Failed to play audio file: " + err);
                message.reply("Failed to play audio file (this is a bot problem).");
                checkForNext.call(this);
            });

            this.currentDispatcher.on('end', () => {
                checkForNext.call(this);
            });
        })
        .catch((err) => {
            console.error("Failed to join voice channel: " + err);
            message.reply("Unable to join your voice channel!");
        });
    };
}

var commands = [
    {
        keyword: "add",
        action: addContent
    },
    {
        keyword: "remove",
        action: removeContent
    },
    {
        keyword: "ouch",
        action: playAudio
    },
    {
        keyword: "list",
        action: listClips
    },
    {
        keyword: "oof",
        action: stopCurrent
    }
];

function getAudioFiles(serverInstance)
{
    return new Promise((resolve, reject) => {
        glob(serverInstance.filepath + "*.*", (err, files) => {
            if (err) reject(err);
            resolve(files);
        });
    });
}

function stopCurrent(message, serverInstance, args)
{
    if (args.length > 0 && args[0].toLowerCase() == "all")
    {
        serverInstance.playQueue = [];
        if (serverInstance.currentDispatcher != null) serverInstance.currentDispatcher.end();
        message.reply("Removed all the audio clips in the queue.");
    }
    else
    {
        if (serverInstance.currentDispatcher != null)
        {
            serverInstance.currentDispatcher.end();
        }
        message.reply("Skipped the current audio clip (Type `!oof all` to skip all).");
    }
}

function listClips(message, serverInstance, args)
{
    getAudioFiles(serverInstance)
    .then((files) => {
        let list = "";
        if (files && files.length > 0)
        {
            list = path.basename(files[0]).split(".")[0];
            for (let i = 1; i < files.length; i++) list += ", " + path.basename(files[i]).split(".")[0];
        }

        message.reply(list);
    })
    .catch((err) => {
        console.error("Glob failed: " + err);
        message.reply("Unable to play the audio file (this is a bot problem).");
    });
}

function playAudio(message, serverInstance, args)
{
    if (!message.member.voiceChannel)
    {
        message.reply("Join a channel first!");
        return;
    }

    if (args.length < 1 || args[0].length < 1)
    {
        message.reply("Please include the name of an audio clip to play! (Example: `!ouch example`)");
        return;
    }

    var formattedName = args[0].replace(/[^a-z0-9_\-]/gi, '').toLowerCase();

    getAudioFiles(serverInstance)
    .then((files) => {
        if (files)
        {
            for (let i = 0; i < files.length; i++)
            {
                if (path.basename(files[i]).split('.')[0] == formattedName)
                {
                    serverInstance.queueSound(message, files[i]);
                    return;
                }
            }
        }

        message.reply("Couldn't find an audio clip with the name '" + formattedName + "'!");
    })
    .catch((err) => {
        console.error("Glob failed: " + err);
        message.reply("Unable to play the audio file (this is a bot problem).");
    });
}

function onMessage(message) {
    if (message.content.substring(0, 1) == "!") {
        var args = message.content.substring(1).split(" ");
        
        // Check if server instance exists
        if (serverInstances[message.guild.id] == null)
        {
            // Create new instance
            serverInstances[message.guild.id] = new ServerInstance(message.guild.id);
        }

        // Find command
        var commandInput = args[0].toLowerCase();
        for (let i = 0; i < commands.length; i++) {
            if (commands[i].keyword == commandInput) {
                //Command match
                commands[i].action(message, serverInstances[message.guild.id], args.slice(1));
                break;
            }
        }
    }
}

function removeContent(message, serverInstance, args)
{
    if (args.length < 1 || args[0].length < 1)
    {
        message.reply("Please include the name of an audio clip to delete! (Example: `!remove example`)");
        return;
    }

    var formattedName = args[0].replace(/[^a-z0-9_\-]/gi, '').toLowerCase();

    getAudioFiles(serverInstance)
    .then((files) => {
        if (files)
        {
            for (let i = 0; i < files.length; i++)
            {
                if (path.basename(files[i]).split('.')[0] == formattedName)
                {
                    fs.unlink(files[i], (err) => {
                        if (err)
                        {
                            console.error("Failed to delete audio file: " + err);
                            message.reply("Unable to remove the audio file (this is a bot problem).");
                        }
                        message.reply("Successfully removed the audio clip '" + formattedName + "'.");
                    });
                    return;
                }
            }
        }

        message.reply("The audio clip specified does not exist!");
    })
    .catch((err) => {
        console.error("Glob failed: " + err);
        message.reply("Unable to remove the audio file (this is a bot problem).");
    });
}

function addContent(message, serverInstance, args)
{
    if (message.attachments.array().length < 1)
    {
        message.reply("Please upload an audio file and include the add command with the attachment!");
        return;
    }

    if (args.length < 1)
    {
        message.reply("Please include a name for the audio file! (Example: !add test)");
        return;
    }

    var formattedName = args[0].replace(/[^a-z0-9_\-]/gi, '').toLowerCase();
    if (formattedName.length < 1)
    {
        message.reply("Please include a name for the audio file! (Example: !add test)");
        return;
    }

    new Promise((resolve, reject) => {
        fs.mkdir(serverInstance.filepath, { recursive: true }, (err) => {
            if (err)
            {
                console.error("Failed to create content directory: " + err);
                message.reply("Unable to add the new audio file (this is a bot problem).");
                reject();
            }

            resolve();
        });
    })
    .then(getAudioFiles(serverInstance))
    .then((files) => {
        if (files)
        {
            for (let i = 0; i < files.length; i++)
            {
                if (path.basename(files[i]).split('.')[0] == formattedName)
                {
                    message.reply("This audio name has already been taken! Please change the name or remove the existing audio file using `!remove`");
                    reject();
                }
            }
        }
        
        return downloadAttachmentContent(message, serverInstance, formattedName);
    })
    .then(() => {
        message.reply("Audio file added successfully! Type `!ouch " + formattedName + "` to play it!");
    })
    .catch((err) => {
        console.error("Adding audio failed: " + err);
        message.reply("Unable to add the new audio file (this is a bot problem).");
    });
}

function downloadAttachmentContent(message, serverInstance, formattedName)
{
    return new Promise((resolve, reject) => {
        http.get(message.attachments.array()[0].url, (response) => {
            if (response.statusCode !== 200)
            {
                console.error("Failed to make HTTP get request: " + err);
                message.reply("Unable to add the new audio file (this is a bot problem).");
                reject();
            }
            if (!response.headers['content-type'].includes('audio')) 
            {
                message.reply("The media requested is not recognized as an audio file. Please change the audio filetype and try again.");
                reject();
            }
            
            var audioFile = fs.createWriteStream(serverInstance.filepath + formattedName + "." + message.attachments.array()[0].url.split('.').pop());
            response.pipe(audioFile);
            resolve();
        });
    });
}