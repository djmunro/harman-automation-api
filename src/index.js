/**
 * What I want
 * - faster telnet
 * - dbus send
 * - dbus listen
 * - screen inspect (dbus)
 * - press and hold (vmm)
 * - make everything setup automagically
 * - vmm stuff (for doing signals like reverse)
 * - restart machine
 * - faster screenshotting
 *
 * - Show in browser dbus data
 *      onScreen click, first start dbusMonitor, send click, after ~5 seconds show on screen
 */
'use strict';

var express = require('express');
var Telnet = require('telnet-client');
var fs = require('fs');
var path = require('path');

//var SHARED_DIR = 'C:\\Users\\dmunro\\Desktop\\htest_shared';
//var SCREENSHOTS_DIR = 'C:\\Users\\dmunro\\Desktop\\screenshots';
var SHARED_DIR = 'C:\\Users\\dbox\\Desktop\\htest_shared';
var SCREENSHOTS_DIR = 'C:\\Users\\dbox\\Desktop\\screenshots';
var app = express();
var connection = new Telnet();

var screenshot_throttled = null;
var radio_telnet = connection.connect({
    host: '192.168.0.1',
    username: 'root',
    password: null
}).then((prompt) => console.log(prompt));
connection.on('error', (err) => console.error(`[TELNET] ${err}`));

// Make it so we don't run out of Telnet connections
runCommand('devc-pty -n 32');
var start_ticks = new Date().getTime();

// Mount the shared drive to save screenshots to
//var mount_point = runCommand('fs-cifs //HIFHN780010:192.168.0.76:/htest_shared /mnt/remote/ user harman@123');
var mount_point = runCommand('fs-cifs //DESKTOP-4SA457R:192.168.0.22:/htest_shared /mnt/remote/ user harman@123');

app.get('/', (req, res) => {
    function main() {
        var my_img = document.querySelector('img');
        document.querySelector('button').addEventListener('click', () => {
            if (my_img.style.opacity === '0.7') {
                return;
            }
            my_img.style.opacity = 0.7;
            my_img.src = `/ui/screenshot?${Math.random()}${Math.random()}${Math.random()}`;
        });
        my_img.onload = function () {
            my_img.style.opacity = 1;
        };
        my_img.addEventListener('click', (event) => {
            if (my_img.style.opacity === '0.7') {
                return;
            }
            console.log(`clicked x=${event.offsetX} y=${event.offsetY}`);
            my_img.style.opacity = 0.7;

            var xhr = new XMLHttpRequest();
            xhr.open('GET', `/ui/click?x=${event.offsetX}&y=${event.offsetY}`, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState==4 && xhr.status==200) {
                    setTimeout(() => {
                        my_img.src = `/ui/screenshot?${Math.random()}${Math.random()}${Math.random()}`;
                    }, 350); // @TODO shouldn't have to add a delay here.  maybe it's UI delay?
                }
            };
            xhr.send();
        });
    }
    res.send(`
        <div><img src="/ui/screenshot" /></div>
        <div><button>Refresh</button></div>
        <script>
            ${main.toString()}
            main();
        </script>
    `);
});
// .10s
// .05s


var takeScreenshot = (function () {
    var SCREENSHOT_COUNTER = 0;

    return function () {
        if (screenshot_throttled) {
            return screenshot_throttled;
        }
        var filename = `ss${SCREENSHOT_COUNTER}.bmp`;
        var filePath = path.join(SHARED_DIR, filename);
        var ssPath = path.join(SCREENSHOTS_DIR, filename);
        if (fs.existsSync(ssPath)) {
            fs.unlinkSync(ssPath); // @TODO promisify
        }
        SCREENSHOT_COUNTER += 1;
        var timeout = setTimeout(() => {
            screenshot_throttled = null;
        }, 700);
        screenshot_throttled = runCommand(`screenShot -file=/mnt/remote/${filename}`)
            .then(() => {
                screenshot_throttled = null;
                fs.renameSync(filePath, ssPath);
                clearTimeout(timeout);
                return ssPath;
            });
        return screenshot_throttled;
    };
}());

defineEndpoint('/ui/screenshot', (req, res) => {
    return mount_point
        .then(() => takeScreenshot())
        .then((filePath) => {
            setTimeout(() => {
                var stat = fs.statSync(filePath);
                var readStream = fs.createReadStream(filePath);

                res.writeHead(200, {
                    'Content-Type': 'image/bmp',
                    'Content-Length': stat.size
                });
                readStream.pipe(res);
            }, 100);
        });
});

defineEndpoint('/ui/click', (req, res) => {
    var x = parseInt(req.query.x, 10);
    var y = parseInt(req.query.y, 10);
    return runCommand(`mtouch_inject -x ${x} -y ${y}`)
        .then(() => {
            screenshot_throttled = null;
            res.send({type: 'success', x: x, y: y});
        });
});

app.listen(3000, () => {
    console.log('Example app listening on port 3000!');
});

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        radio_telnet = radio_telnet.then(() => {
            // @TODO for some reason telnet commands take 180 ms extra
            var start = new Date().getTime();
            // console.log(`[${start - start_ticks}] RUNNING ${cmd}`);
            return connection.exec(`time ${cmd}`).then((output) => {
                var end = new Date().getTime();
                var delta = end - start;
                console.log(`[${delta} ms] ${cmd}` + `\n${output}`);
                resolve(output);
            });
        })
    });
}

function defineEndpoint(path, handler) {
    app.get(path, (req, res) => {
        var start = new Date().getTime();
        // console.log(`[${start - start_ticks}] REQUESTING ${path}`);
        handler(req, res).then(output => {
            var end = new Date().getTime();
            var delta = end - start;
            console.log(`[${delta} ms] GET ${path}`);
        }, err => {
            res.send(err.stack)
        });
    });
}