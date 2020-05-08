var Discord = require('discord.js');
var auth = require('./auth.json');
var fs = require('fs');
var glob = require('glob');
var path = require('path');
var http = require('https');
var ytDownloader = require('youtube-mp3-downloader');

const PLAY_DELAY = 250;
const END_LEAVE_DELAY = 30000;

const client = new Discord.Client();
client.on('ready', () => { console.log("Bot connected"); });
client.login(auth.token).catch((error) => {
    console.log("Bot failed to connect.");
    console.error(error);
});

const ytdl = new YouTubeDownloader();

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

    this.queueSound = function (message, audioPath) {
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

    this.startPlayback = function () {
        this.isActive = true;
        this.playNextAudio();
    };

    this.playNextAudio = function () {
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

    this.getAudioFiles = function () {
        return new Promise((resolve, reject) => {
            glob(this.filepath + "*.*", (err, files) => {
                if (err) reject(err);
                else resolve(files);
            });
        });
    };

    this.fileExists = function (filename) {
        return this.getAudioFiles()
        .then((files) => {
            if (files)
            {
                for (let i = 0; i < files.length; i++)
                {
                    if (path.basename(files[i]).split('.')[0] == filename) return Promise.resolve(files[i]);
                }
            }

            return Promise.resolve(false);
        });
    }
}

function YouTubeDownloader() {

    this.outputPath = path.resolve("./youtube_temp");
    
    fs.mkdir(this.outputPath, { recursive: true }, (err) => {
        if (err) throw new Error("Unable to initialize YouTube downloader temp directory: " + err);
    });

    this.downloader = new ytDownloader({
        "ffmpegPath": path.resolve("./node_modules/ffmpeg-binaries/bin/ffmpeg.exe"),
        "outputPath": this.outputPath,
        "youtubeVideoQuality": "lowest",
        "queueParallelism": 10,
        "progressTimeout": 2000
    });

    this.downloadCallbacks = {}
    this.removeCallback = (data) => {
        var download_id = path.basename(data.file).split('.')[0];
        var downloadCallback = this.downloadCallbacks[download_id];

        if (!downloadCallback) throw new Error("Callbacks do not exist for download ID: " + download_id);
        // Reset callback
        this.downloadCallbacks[download_id] = null;
        
        return downloadCallback;
    };

    this.downloader.on("error", (err, data) => {
        this.removeCallback(data).reject(err);
    });

    this.downloader.on("finished", (err, data) => {
        if (err) this.removeCallback(data).reject(err);
        this.removeCallback(data).resolve(data);
    });

    this.downloadAudio = (video_id, message_id) => {
        console.log("Downloading YT video " + video_id + " from " + message_id);
        return new Promise((resolve, reject) => {
            this.downloadCallbacks[message_id] = {
                resolve,
                reject
            };

            this.downloader.download(video_id, message_id + ".mp3");
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
    serverInstance.getAudioFiles()
    .then((files) => {
        let list = "";
        if (files && files.length > 0)
        {
            list = path.basename(files[0]).split(".")[0];
            for (let i = 1; i < files.length; i++) list += ", " + path.basename(files[i]).split(".")[0];
        }

        message.reply(list);
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

    serverInstance.fileExists(formattedName)
    .then((file) => {
        if (!file) message.reply("Couldn't find an audio clip with the name '" + formattedName + "'!");
        else {
            serverInstance.queueSound(message, file);
        }
    })
    .catch((err) => {
        console.error("Play audio failed: " + err);
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

    serverInstance.fileExists(formattedName)
    .then((file) => {
        if (!file) message.reply("The audio clip specified does not exist!");
        else {
            fs.unlink(file, (err) => {
                if (err)
                {
                    console.error("Failed to delete audio file: " + err);
                    message.reply("Unable to remove the audio file (this is a bot problem).");
                }
                else message.reply("Successfully removed the audio clip '" + formattedName + "'.");
            });
        }
    })
    .catch((err) => {
        console.error("Glob failed: " + err);
        message.reply("Unable to remove the audio file (this is a bot problem).");
    });
}

function youtube_parser(url){
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match&&match[7].length==11)? match[7] : false;
}

function addContent(message, serverInstance, args)
{
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

    var downloadContent = null;
    if (args.length < 2)
    {
        // Treat as attachment
        if (message.attachments.array().length < 1)
        {
            message.reply("Please upload an audio file and include the add command with the attachment (or supply a YouTube video link instead with `!add example <link>`)!");
            return;
        }

        downloadContent = downloadFromAttachment(message, serverInstance, formattedName);
    }
    else
    {
        var video_id = youtube_parser(args[1]);
        if (!video_id)
        {
            message.reply("Please supply a valid YouTube video link or upload an audio file as an attachment with `!add example` instead!");
            return;
        }

        downloadContent = downloadFromYoutube(message, serverInstance, formattedName, video_id);
    }

    // Ensure server content directory exists
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
    // Determine if file with filename already exists
    .then(() => serverInstance.fileExists(formattedName))
    .then((exists) => {
        if (exists)
        {
            message.reply("This audio name has already been taken! Please change the name or remove the existing audio file using `!remove`");
            return Promise.reject();
        }

        return downloadContent;
    }, (err) => {
        console.error("Failed to get files from server instance: " + err);
        message.reply("Unable to add the new audio file (this is a bot problem).");
    })
    .catch((err) => {});    
}

function downloadFromYoutube(message, serverInstance, formattedName, video_id)
{
    let filename = formattedName + ".mp3";
    
    message.reply("Working on it...");
    ytdl.downloadAudio(video_id, message.id)
    .then((data) => {
        fs.rename(data.file, serverInstance.filepath + filename, (err) => {
            if (err) return Promise.reject(err);
            else return Promise.resolve();
        })
    })
    .then(() => {
        message.reply("Audio file added successfully! Type `!ouch " + formattedName + "` to play it!");
        console.log("Added " + formattedName + " to " + message.member.guild);
    })
    .catch((err) => {
        console.log(err);
        message.reply("Unable to add the new audio file (this is a bot problem).");
    });
}

function downloadFromAttachment(message, serverInstance, formattedName)
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
    })
    .then(() => {
        message.reply("Audio file added successfully! Type `!ouch " + formattedName + "` to play it!");
    })
    .catch((err) => {});
}