/*
# Edit owner di settings.js
# Edit case / fitur di index.js
# Edit foto bot di folder image 
# Edit tampilan menu di folder language file Indonesia.js
*/
require('./settings')

// --- Kebutuhan Heroku agar tidak Crash (R10 Error) ---
const http = require("http");
const express = require('express');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000; 

// --- START SERVER SEGERA (PENTING) ---
// Server dinyalakan di awal agar Heroku mendeteksi proses berjalan
let globalQR = null; // Variabel penampung QR

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Alphabot-Md Status</title>
                <meta http-equiv="refresh" content="10">
            </head>
            <body style="font-family: Arial; text-align: center; padding-top: 50px;">
                <h1>Alphabot-Md is Running!</h1>
                <p>Status: <strong>Online</strong></p>
                <p>Jika belum scan, QR code akan muncul dibawah:</p>
                <img src="/qr" alt="QR Code" />
            </body>
        </html>
    `);
});

app.get('/qr', async (req, res) => {
    if (globalQR) {
        res.setHeader('content-type', 'image/png');
        const qrBuffer = await require('qrcode').toBuffer(globalQR);
        res.end(qrBuffer);
    } else {
        res.status(404).send('QR belum tersedia atau sudah terkoneksi.');
    }
});

server.listen(PORT, () => {
    console.log(`Server listening on PORT ${PORT}`);
});

// --- Import Library Baileys Terbaru ---
const {
    default: alphaConnect,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    jidDecode,
    proto,
    getContentType,
    downloadContentFromMessage,
    generateWAMessageFromContent,
    prepareWAMessageMedia,
    jidNormalizedUser,
    delay
} = require("@whiskeysockets/baileys")

const pino = require('pino')
const fs = require('fs')
const path = require('path')
const { Boom } = require('@hapi/boom')
const chalk = require('chalk')
const figlet = require("figlet")
const FileType = require('file-type')
const fetch = require('node-fetch')
const PhoneNumber = require('awesome-phonenumber')
const yargs = require('yargs/yargs')
const _ = require('lodash')
const Jimp = require('jimp')

// --- Import Library Internal ---
const { color } = require("./lib/color");
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid, writeExif } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, sleep } = require('./lib/myfunc')
const { toAudio, toPTT, toVideo } = require('./lib/converter')
const { welcome, antiDelete } = require('./lib/welcome')

// --- Database Lokal Helper ---
const checkFile = (filepath, defaultData) => {
    try {
        if (!fs.existsSync(filepath)) {
            const dir = path.dirname(filepath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filepath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        return JSON.parse(fs.readFileSync(filepath));
    } catch (e) {
        return defaultData;
    }
}

// Load Database
const _welcome = checkFile('./database/welcome.json', [])
const _left = checkFile('./database/left.json', [])
const _promote = checkFile('./database/promote.json', [])
const _demote = checkFile('./database/demote.json', [])
const antidelete = checkFile('./database/antidelete.json', [])
const antionce = checkFile('./database/antionce.json', [])

// --- Global Variables ---
global.api = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) })) : '')

// --- Store (Memori Chat) ---
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) })

// --- Fungsi Utama Bot ---
async function startalpha() {
    
    // 1. Setup Auth & Browser
    const { state, saveCreds } = await useMultiFileAuthState('session')
    const { version, isLatest } = await fetchLatestBaileysVersion()
    
    console.log(chalk.bold.green(figlet.textSync('ALPHABOT', {
        font: 'Standard',
        horizontalLayout: 'default',
        vertivalLayout: 'default',
        whitespaceBreak: false
    })))
    
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`)

    // 2. Inisialisasi Koneksi
    const alpha = alphaConnect({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        browser: ["Alphabot-Md", "Safari", "3.0.0"], 
        auth: state,
        getMessage: async (key) => {
            if (store) {
                const msg = await store.loadMessage(key.remoteJid, key.id)
                return msg.message || undefined
            }
            return { conversation: 'Hello World' }
        },
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(
                message.buttonsMessage ||
                message.templateMessage ||
                message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }
            return message;
        }
    })

    // 3. Load Store
    if (fs.existsSync('./session/baileys_store.json')) {
        try {
            store.readFromFile('./session/baileys_store.json')
        } catch (err) {
            console.log("Gagal membaca store, membuat file baru.")
        }
    }
    
    store.bind(alpha.ev)
    setInterval(() => {
        store.writeToFile('./session/baileys_store.json')
    }, 10000)

    // 4. Handle Event Koneksi
    alpha.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update
        
        // Simpan QR ke variabel global agar bisa diakses di Web Server
        if (qr) {
            globalQR = qr;
        } else {
            // Reset jika sudah connect atau tidak ada QR
            if (connection === 'open') globalQR = null;
        }

        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output.statusCode
            if (reason === DisconnectReason.badSession) {
                console.log(chalk.red(`Bad Session File, Please Delete Session and Scan Again`));
                alpha.logout();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log(chalk.yellow("Connection closed, reconnecting...."));
                startalpha();
            } else if (reason === DisconnectReason.connectionLost) {
                console.log(chalk.yellow("Connection Lost from Server, reconnecting..."));
                startalpha();
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log(chalk.red("Connection Replaced, Another New Session Opened, reconnecting..."));
                // Jangan langsung startalpha() di sini jika session corrupt
            } else if (reason === DisconnectReason.loggedOut) {
                console.log(chalk.red(`Device Logged Out, Please Scan Again And Run.`));
                alpha.logout();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log(chalk.yellow("Restart Required, Restarting..."));
                startalpha();
            } else if (reason === DisconnectReason.timedOut) {
                console.log(chalk.yellow("Connection TimedOut, Reconnecting..."));
                startalpha();
            } else {
                console.log(chalk.red(`Unknown DisconnectReason: ${reason}|${connection}`))
                startalpha();
            }
        }
        
        if (connection === "open") {
            console.log(chalk.green('Connected to WhatsApp Server!'))
            console.log(JSON.stringify(alpha.user, null, 2))
        }
    })

    // 5. Simpan Credential saat ada update
    alpha.ev.on('creds.update', saveCreds)

    // 6. Handle Pesan Masuk
    alpha.ev.on('messages.upsert', async chatUpdate => {
        try {
            for (let mek of chatUpdate.messages) {
                if (!mek.message) return
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') return
                
                // Cek Mode Public/Self
                if (!alpha.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
                
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
                
                const m = smsg(alpha, mek, store)
                
                const reSize = async (buffer, ukur1, ukur2) => {
                    return new Promise(async (resolve, reject) => {
                        var baper = await Jimp.read(buffer);
                        var ab = await baper.resize(ukur1, ukur2).getBufferAsync(Jimp.MIME_JPEG)
                        resolve(ab)
                    })
                }

                require("./index")(alpha, m, mek, chatUpdate, store, reSize, _welcome, _left, antionce, antidelete, _promote, _demote)
            }
        } catch (err) {
            console.log(err)
        }
    })

    // 7. Handle Group Participants
    alpha.ev.on('group-participants.update', async (anu) => {
        const isWelcome = _welcome.includes(anu.id)
        const isLeft = _left.includes(anu.id)
        const isPromote = _promote.includes(anu.id)
        const isDemote = _demote.includes(anu.id)
        
        const set_welcome_db = checkFile('./database/set_welcome.json', [])
        const set_left_db = checkFile('./database/set_left.json', [])
        const set_promote = checkFile('./database/set_promote.json', [])
        const set_demote = checkFile('./database/set_demote.json', [])
        
        try {
            const { isSetWelcome, getTextSetWelcome } = require('./lib/setwelcome')
            const { isSetLeft, getTextSetLeft } = require('./lib/setleft')
            
            const reSize = async (buffer, ukur1, ukur2) => {
                return new Promise(async (resolve, reject) => {
                    var baper = await Jimp.read(buffer);
                    var ab = await baper.resize(ukur1, ukur2).getBufferAsync(Jimp.MIME_JPEG)
                    resolve(ab)
                })
            }

            welcome(alpha, anu, global.ownername, reSize, isWelcome, isLeft, isPromote, isDemote, isSetWelcome, isSetLeft, getTextSetLeft, getTextSetWelcome, set_welcome_db, set_left_db, set_promote, set_demote)
        } catch (e) {
            console.log("Error in Group Participants Update:", e)
        }
    })

    // 8. Handle Delete & ViewOnce
    alpha.ev.on("message.delete", async (anu) => {
        if(global.antidelete) antiDelete(global.antidelete, alpha, anu)
    })

    alpha.ev.on("viewOnceMessageV2", async (anu) => {
        if(global.antiviewonce) {
            const { oneTime } = require("./lib/welcome");
            oneTime(global.antiviewonce, alpha, anu)
        }
    })
    
    // 9. Handle Call (Anti Call)
    alpha.ev.on('call', async (celled) => {
        if (global.anticall) {
            for (let kopel of celled) {
                if (kopel.isGroup == false) {
                    if (kopel.status == "offer") {
                        let nomer = await alpha.sendTextWithMentions(kopel.from, `*${alpha.user.name}* tidak menerima panggilan. Maaf @${kopel.from.split('@')[0]} kamu akan diblokir. Hubungi Owner untuk buka blokir.`)
                        await alpha.sendContact(kopel.from, global.owner, nomer)
                        await sleep(5000)
                        await alpha.updateBlockStatus(kopel.from, "block")
                    }
                }
            }
        }
    })

    // --- Helper Functions ---

    alpha.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }

    alpha.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = alpha.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    alpha.public = true

    // --- Helper: Get File ---
    alpha.getFile = async (PATH, returnAsFilename) => {
        let res, filename
        let data = Buffer.isBuffer(PATH) ? PATH : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,`[1], 'base64') : /^https?:\/\//.test(PATH) ? await (res = await fetch(PATH)).buffer() : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0)
        if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer')
        const type = await FileType.fromBuffer(data) || { mime: 'application/octet-stream', ext: '.bin' }
        if (data && returnAsFilename && !filename) (filename = path.join(__dirname, './media/' + new Date * 1 + '.' + type.ext), await fs.promises.writeFile(filename, data))
        return { res, filename, ...type, data, deleteFile() { return filename && fs.promises.unlink(filename) } }
    }

    // --- Helper: Send File (Universal) ---
    alpha.sendFile = async (jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) => {
        let type = await alpha.getFile(path, true)
        let { res, data: file, filename: pathFile } = type
        if (res && res.status !== 200 || file.length <= 65536) {
            try { throw { json: JSON.parse(file.toString()) } } catch (e) { if (e.json) throw e.json }
        }
        let opt = { filename }
        if (quoted) opt.quoted = quoted
        if (!type) options.asDocument = true
        let mtype = '', mimetype = type.mime, convert
        if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker'
        else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image'
        else if (/video/.test(type.mime)) mtype = 'video'
        else if (/audio/.test(type.mime)) {
            convert = await (ptt ? toPTT : toAudio)(file, type.ext)
            file = convert.data
            pathFile = convert.filename
            mtype = 'audio'
            mimetype = 'audio/ogg; codecs=opus'
        } else mtype = 'document'
        if (options.asDocument) mtype = 'document'

        delete options.asSticker
        delete options.asLocation
        delete options.asVideo
        delete options.asDocument
        delete options.asImage

        let message = { ...options, caption, ptt, [mtype]: { url: pathFile }, mimetype }
        let m
        try {
            m = await alpha.sendMessage(jid, message, { ...opt, ...options })
        } catch (e) {
            m = null
        } finally {
            if (!m) m = await alpha.sendMessage(jid, { ...message, [mtype]: file }, { ...opt, ...options })
            return m
        }
    }

    alpha.sendText = (jid, text, quoted = '', options) => alpha.sendMessage(jid, { text: text, ...options }, { quoted })

    alpha.sendImage = async (jid, path, caption = '', quoted = '', options) => {
        let buffer = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await fetch(path)).buffer() : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        return await alpha.sendMessage(jid, { image: buffer, caption: caption, ...options }, { quoted })
    }

    alpha.sendVideo = async (jid, path, gif = false, caption = '', quoted = '', options) => {
        let buffer = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await fetch(path)).buffer() : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        return await alpha.sendMessage(jid, { video: buffer, caption: caption, gifPlayback: gif, ...options }, { quoted })
    }

    alpha.sendAudio = async (jid, path, quoted = '', ptt = false, options) => {
        let buffer = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await fetch(path)).buffer() : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        return await alpha.sendMessage(jid, { audio: buffer, ptt: ptt, ...options }, { quoted })
    }

    alpha.sendTextWithMentions = async (jid, text, quoted, options = {}) => alpha.sendMessage(jid, {
        text: text,
        mentions: [...text.matchAll(/@(\d{0,16})/g)].map(v => v[1] + '@s.whatsapp.net'),
        ...options
    }, { quoted })

    alpha.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await fetch(path)).buffer() : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        let buffer
        if (options && (options.packname || options.author)) {
            buffer = await writeExifImg(buff, options)
        } else {
            buffer = await imageToWebp(buff)
        }
        await alpha.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
        return buffer
    }

    alpha.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,`[1], 'base64') : /^https?:\/\//.test(path) ? await (await fetch(path)).buffer() : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        let buffer
        if (options && (options.packname || options.author)) {
            buffer = await writeExifVid(buff, options)
        } else {
            buffer = await videoToWebp(buff)
        }
        await alpha.sendMessage(jid, { sticker: { url: buffer }, ...options }, { quoted })
        return buffer
    }

    alpha.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || ''
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
        const stream = await downloadContentFromMessage(message, messageType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        return buffer
    }

    alpha.sendContact = async (jid, kon, quoted = '', opts = {}) => {
        let list = []
        for (let i of kon) {
            list.push({
                displayName: await alpha.getName(i + '@s.whatsapp.net'),
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${await alpha.getName(i + '@s.whatsapp.net')}\nFN:${await alpha.getName(i + '@s.whatsapp.net')}\nitem1.TEL;waid=${i}:${i}\nitem1.X-ABLabel:Ponsel\nEND:VCARD`
            })
        }
        alpha.sendMessage(jid, { contacts: { displayName: `${list.length} Kontak`, contacts: list }, ...opts }, { quoted })
    }
    
    alpha.sendButtonText = (jid, buttons = [], text, footer, quoted = '', options = {}) => {
        let buttonText = buttons.map(b => {
            return b.urlButton ? `🔗 ${b.urlButton.displayText}: ${b.urlButton.url}` :
                   b.callButton ? `📞 ${b.callButton.displayText}: ${b.callButton.phoneNumber}` :
                   `👉 ${b.quickReplyButton?.displayText || b.buttonText?.displayText || 'Button'}`
        }).join('\n');
        alpha.sendMessage(jid, { text: `${text}\n\n${footer}\n\n${buttonText}`, ...options }, { quoted })
    }

    alpha.send1ButMes = (jid, text = '', footer = '', butId = '', dispText = '', quoted, ments) => {
        alpha.sendMessage(jid, { text: `${text}\n\n${footer}\n\n👉 ${dispText}`, mentions: ments }, { quoted })
    }

    alpha.send2ButMes = (jid, text = '', footer = '', butId = '', dispText = '', butId2 = '', dispText2 = '', quoted, ments) => {
        alpha.sendMessage(jid, { text: `${text}\n\n${footer}\n\n👉 ${dispText}\n👉 ${dispText2}`, mentions: ments }, { quoted })
    }

    alpha.send3ButMes = (jid, text = '', footer = '', butId = '', dispText = '', butId2 = '', dispText2 = '', butId3 = '', dispText3 = '', quoted, ments) => {
        alpha.sendMessage(jid, { text: `${text}\n\n${footer}\n\n👉 ${dispText}\n👉 ${dispText2}\n👉 ${dispText3}`, mentions: ments }, { quoted })
    }

    return alpha
}

startalpha()

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update '${__filename}'`))
    delete require.cache[file]
    require(file)
})