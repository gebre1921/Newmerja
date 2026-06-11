'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║        Simple Marketplace Bot  v10.0  🛡️ 24/7 Fortress       ║
// ║      ሲሚንቶ  ·  ብረት  ·  ማሽነሪ  ·  ትራክ                        ║
// ╚══════════════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const http      = require('http');
const mongoose  = require('mongoose');
const crypto    = require('crypto');

// ──────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────
const BOT_TOKEN     = (process.env.BOT_TOKEN     || '').trim().replace(/['"]/g, '');
const MONGO_URI     =  process.env.MONGO_URI     || '';
const SUPPORT_PHONE =  process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS     = (process.env.ADMIN_IDS     || '7423347375')
                        .split(',').map(s => Number(s.trim()));
const PORT          = Number(process.env.PORT)   || 10000;
const RENDER_URL    =  process.env.RENDER_EXTERNAL_URL || '';
const WEBHOOK_SECRET = (process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'));
const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB — reject oversized payloads

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌  BOT_TOKEN ወይም MONGO_URI አልተገኘም!');
    process.exit(1);
}

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR SHIELDS — never crash
// ──────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => console.error('[UnhandledRejection]', reason));
process.on('uncaughtException',  (err)    => console.error('[UncaughtException]',  err));

// ──────────────────────────────────────────────────────────
// MEMORY WATCHDOG — prevent OOM crashes on free-tier
// ──────────────────────────────────────────────────────────
const MEM_LIMIT_MB = Number(process.env.MEM_LIMIT_MB) || 400;
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > MEM_LIMIT_MB) {
        console.warn(`[MemWatchdog] RSS ${used.toFixed(0)} MB > ${MEM_LIMIT_MB} MB — clearing caches`);
        // Evict half of session cache
        const keys = [...sessionCache.keys()];
        keys.slice(0, Math.floor(keys.length / 2)).forEach(k => sessionCache.delete(k));
        // Evict all rate-limit entries
        rateLimitMap.clear();
        if (global.gc) global.gc();
    }
}, 60_000);

// ──────────────────────────────────────────────────────────
// RATE LIMITER — memory-efficient sliding window
// ──────────────────────────────────────────────────────────
const rateLimitMap = new Map();
const blockedUsers = new Map(); // userId -> unblockAt

function rateLimit(userId, maxPerMinute = 60) {
    const now = Date.now();
    // Check hard block (repeated abuse)
    const blocked = blockedUsers.get(userId);
    if (blocked) {
        if (now < blocked) return true;
        blockedUsers.delete(userId);
    }
    let e = rateLimitMap.get(userId);
    if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60_000, strikes: e?.strikes || 0 }; rateLimitMap.set(userId, e); }
    e.count++;
    if (e.count > maxPerMinute) {
        e.strikes = (e.strikes || 0) + 1;
        // After 3 strikes in a session: block for 10 minutes
        if (e.strikes >= 3) {
            blockedUsers.set(userId, now + 10 * 60_000);
            console.warn(`[Security] User ${userId} blocked 10min after ${e.strikes} abuse strikes`);
        }
        return true;
    }
    return false;
}
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of rateLimitMap) if (now > v.resetAt) rateLimitMap.delete(k);
    for (const [k, v] of blockedUsers) if (now > v) blockedUsers.delete(k);
}, 5 * 60_000);

// ──────────────────────────────────────────────────────────
// INPUT SANITIZER
// ──────────────────────────────────────────────────────────
const MAX_INPUT_LEN = 200;
function sanitize(input) {
    if (typeof input !== 'string') return '';
    return input.slice(0, MAX_INPUT_LEN)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\$/g, '')
        .replace(/[{}]/g, '')
        .replace(/<[^>]*>/g, '')            // strip HTML tags
        .replace(/javascript:/gi, '')        // prevent JS injection
        .replace(/data:/gi, '')              // prevent data-URI injection
        .replace(/on\w+\s*=/gi, '')         // strip inline event handlers
        .trim();
}
function safePhone(p) { return sanitize(p).replace(/[^\d\s+\-()/]/g, '').slice(0, 20); }
function safePrice(text) {
    const price = parseFloat(String(text).replace(/,/g, '').replace(/[^\d.]/g, ''));
    if (isNaN(price) || price <= 0 || price > 10_000_000) return null;
    return price;
}

// ──────────────────────────────────────────────────────────
// FAIRNESS SHUFFLE
// ──────────────────────────────────────────────────────────
function fairShuffle(items) {
    const groups = new Map();
    for (const it of items) {
        const key = it.price ?? 0;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    }
    const result = [];
    for (const [, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        for (let i = group.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [group[i], group[j]] = [group[j], group[i]];
        }
        result.push(...group);
    }
    return result;
}

// ──────────────────────────────────────────────────────────
// SCHEMAS
// ──────────────────────────────────────────────────────────
const cementSchema = new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    type: { type: String, default: '' }, location: { type: String, default: '' },
    companyName: { type: String, default: '' }, phone: { type: String, default: '' },
    price: { type: Number, default: 0 }, status: { type: String, default: 'active', enum: ['active','off'] },
    viewCount: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now }
});
cementSchema.index({ type:1, location:1, status:1 });

const steelSchema = new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    type: { type: String, default: '' }, address: { type: String, default: '' },
    phone: { type: String, default: '' }, price: { type: Number, default: 0 },
    priceUnit: { type: String, default: 'ብር/ኪሎ' }, status: { type: String, default: 'active', enum: ['active','off'] },
    viewCount: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now }
});
steelSchema.index({ type:1, status:1 });

const machinerySchema = new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    type: { type: String, default: '' }, address: { type: String, default: '' },
    phone: { type: String, default: '' }, price: { type: Number, default: 0 },
    rentUnit: { type: String, default: 'በቀን', enum: ['በቀን','በወር'] },
    status: { type: String, default: 'active', enum: ['active','off'] },
    viewCount: { type: Number, default: 0 }, createdAt: { type: Date, default: Date.now }
});
machinerySchema.index({ type:1, status:1 });

const truckSchema = new mongoose.Schema({
    userId: { type: Number, required: true, index: true },
    type: { type: String, default: '' }, plate: { type: String, default: '' },
    route: { type: String, default: '' }, phone: { type: String, default: '' },
    status: { type: String, default: 'active', enum: ['active','off'] },
    rentedCount: { type: Number, default: 0 }, viewCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});
truckSchema.index({ type:1, route:1, status:1 });

const searchLogSchema = new mongoose.Schema({
    userId: Number, username: String, category: String,
    searchedFor: String, phone: String,
    createdAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 86400 } }
});

const sessionSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now, index: { expireAfterSeconds: 86400 * 7 } }
});

// ──────────────────────────────────────────────────────────
// BUTTON VISIBILITY
// ──────────────────────────────────────────────────────────
const ALL_MAIN_BUTTONS = [
    '🧱 ሲሚንቶ ለመሸጥ','🧱 ሲሚንቶ ለመግዛት',
    '🚚 መኪና ለማከራየት','🚚 መኪና ለመከራየት',
    '🟥 ብረት ለመሸጥ','🟥 ብረት ለመግዛት',
    '🔹 ማሽነሪ ለማከራየት','🔹 ማሽነሪ ለመከራየት',
];
let btnVisibility = Object.fromEntries(ALL_MAIN_BUTTONS.map(b => [b, true]));

const CementSeller    = mongoose.model('CementSeller',    cementSchema);
const SteelSeller     = mongoose.model('SteelSeller',     steelSchema);
const MachineryLeasor = mongoose.model('MachineryLeasor', machinerySchema);
const TruckLeasor     = mongoose.model('TruckLeasor',     truckSchema);
const SearchLog       = mongoose.model('SearchLog',       searchLogSchema);
const BotSession      = mongoose.model('BotSession',      sessionSchema);

async function loadBtnVisibility() {
    try {
        const doc = await BotSession.findOne({ key: '__btn_visibility__' }).lean();
        if (doc?.data) btnVisibility = { ...btnVisibility, ...doc.data };
    } catch {}
}
function saveBtnVisibility() {
    BotSession.updateOne({ key: '__btn_visibility__' },
        { $set: { data: btnVisibility, updatedAt: new Date() } }, { upsert: true }).catch(() => {});
}

// ──────────────────────────────────────────────────────────
// MONGODB — auto-reconnect with exponential backoff
// ──────────────────────────────────────────────────────────
let mongoRetryDelay = 2000;

async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI, {
            maxPoolSize: 200,
            minPoolSize: 5,
            serverSelectionTimeoutMS: 15_000,
            socketTimeoutMS: 60_000,
            heartbeatFrequencyMS: 8_000,
            connectTimeoutMS: 20_000,
            retryWrites: true,
            retryReads: true,
            compressors: ['zlib'],       // network compression
            zlibCompressionLevel: 6,
            maxIdleTimeMS: 120_000,      // reclaim idle connections
            waitQueueTimeoutMS: 10_000,  // don't hang forever on busy pool
        });
        mongoRetryDelay = 2000; // reset on success
        console.log('✅  MongoDB Connected');
        await loadBtnVisibility();
    } catch (err) {
        console.error(`❌ MongoDB failed (retry in ${mongoRetryDelay}ms):`, err.message);
        setTimeout(connectMongo, mongoRetryDelay);
        mongoRetryDelay = Math.min(mongoRetryDelay * 2, 30_000);
    }
}
mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected — reconnecting...');
    setTimeout(connectMongo, mongoRetryDelay);
});
mongoose.connection.on('reconnected', () => { console.log('✅ MongoDB reconnected'); mongoRetryDelay = 2000; });
mongoose.connection.on('error', err => console.error('[Mongo]', err.message));
// Log slow queries in dev
if (process.env.NODE_ENV !== 'production') {
    mongoose.set('debug', (coll, op) => console.log(`[Mongo] ${coll}.${op}`));
}
connectMongo();

// ──────────────────────────────────────────────────────────
// BOT — aggressive timeouts & retry
// ──────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 120_000,
    telegram: {
        webhookReply: false,
        apiRoot: 'https://api.telegram.org',
        agent: (() => {
            // Keep-alive HTTP agent for Telegram API calls
            const { Agent } = require('https');
            return new Agent({ keepAlive: true, maxSockets: 50, timeout: 30000 });
        })(),
    }
});

// Global middleware: answer all callback queries to prevent Telegram spinner
bot.use(async (ctx, next) => {
    if (ctx.callbackQuery) {
        ctx.answerCbQuery().catch(() => {});
    }
    return next();
});

// ──────────────────────────────────────────────────────────
// SESSION — LRU in-memory + async DB write (non-blocking)
// ──────────────────────────────────────────────────────────
const SESSION_MAX = 8000;
const sessionCache = new Map();

function lruSet(k, v) {
    if (sessionCache.size >= SESSION_MAX && !sessionCache.has(k))
        sessionCache.delete(sessionCache.keys().next().value);
    sessionCache.set(k, v);
}

// Write queue — batch DB writes to reduce load
const writeQueue = new Map();
let writeTimer = null;
function queueSessionWrite(k, data) {
    writeQueue.set(k, data);
    if (!writeTimer) {
        writeTimer = setTimeout(flushSessionWrites, 500);
    }
}
async function flushSessionWrites() {
    writeTimer = null;
    if (!writeQueue.size) return;
    const entries = [...writeQueue.entries()];
    writeQueue.clear();
    const ops = entries.map(([k, data]) => ({
        updateOne: {
            filter: { key: k },
            update: { $set: { data, updatedAt: new Date() } },
            upsert: true
        }
    }));
    BotSession.bulkWrite(ops, { ordered: false }).catch(() => {});
}

bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    const uid = ctx.from.id;

    if (rateLimit(uid, 60)) {
        ctx.answerCbQuery?.('⚠️ ጥቂት ቆዩ!').catch(() => {});
        return ctx.reply('⚠️ በጣም ብዙ ጥያቄ ልከዋል። ጥቂት ቆዩ።').catch(() => {});
    }

    const k = String(uid);
    if (!sessionCache.has(k)) {
        const doc = await BotSession.findOne({ key: k }).lean().catch(() => null);
        lruSet(k, doc?.data ?? {});
    }
    ctx.session = sessionCache.get(k);

    try { await next(); } catch (err) {
        console.error('[Handler]', err.message);
        ctx.reply('⚠️ ስህተት ተፈጥሯል። እባክዎ ዳግም ይሞክሩ።').catch(() => {});
    }

    lruSet(k, ctx.session);
    queueSessionWrite(k, ctx.session);
});

// ──────────────────────────────────────────────────────────
// UTILITIES
// ──────────────────────────────────────────────────────────
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);
const fmt     = n   => Number(n).toLocaleString('en');
function esc(s) { return String(s || '').replace(/([*_`[\]])/g, '\\$1'); }

function toEthiopian(gDate) {
    const JDN = d => {
        const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
        return Math.floor((1461*(y+4800+Math.floor((m-14)/12)))/4)
             + Math.floor((367*(m-2-12*Math.floor((m-14)/12)))/12)
             - Math.floor((3*Math.floor((y+4900+Math.floor((m-14)/12))/100))/4) + dd - 32075;
    };
    const jdn = JDN(gDate), r = jdn - 1723856, n = r % 1461;
    const y = Math.floor(r/1461)*4 + Math.floor(n/365) - (n===1460?1:0);
    const rem = (n%365) + (n===1460?1:0);
    return { y, m: Math.min(Math.floor(rem/30)+1,13), d: Math.min(rem%30+1,30) };
}
const ETH_MONTHS = ['መስከረም','ጥቅምት','ህዳር','ታህሳስ','ጥር','የካቲት','መጋቢት','ሚያዚያ','ግንቦት','ሰኔ','ሐምሌ','ነሐሴ','ጳጉሜ'];
function ethTimestamp(date) {
    const eat = new Date(new Date(date).getTime() + 3*3600*1000);
    const eth = toEthiopian(eat);
    const pad = n => String(n).padStart(2,'0');
    return `${eth.d} ${ETH_MONTHS[eth.m-1]||eth.m} ${eth.y} | ${pad(eat.getUTCHours())}:${pad(eat.getUTCMinutes())}`;
}

// ──────────────────────────────────────────────────────────
// SMART SEARCH — synonyms + fuzzy edit-distance
// ──────────────────────────────────────────────────────────
const SYNONYM_GROUPS = [
    ['ዳንጎቴ','dangote','dangoto','dangte'],
    ['ድሬ','dire','diredawa','ድሬዳዋ'],
    ['ናሽናል','national','nashenal'],
    ['ሙገር','mugher','muger'],
    ['ደርባ','derba'],
    ['ሲሚንቶ','cement','cemento','siminto'],
    ['ብረት','steel','iron','bireet'],
    ['ቆርቆሮ','rod','bar','rebar'],
    ['ባለ 8mm','ባለ 8','ባለ8','8mm','8 mm','bale 8','8'],
    ['ባለ 10mm','ባለ 10','ባለ10','10mm','10 mm','bale 10','10'],
    ['ባለ 12mm','ባለ 12','ባለ12','12mm','12 mm','bale 12','12'],
    ['ባለ 14mm','ባለ 14','ባለ14','14mm','14 mm','bale 14'],
    ['ባለ 16mm','ባለ 16','ባለ16','16mm','16 mm','bale 16'],
    ['ባለ 20mm','ባለ 20','ባለ20','20mm','20 mm','bale 20'],
    ['ማሽነሪ','machinery','machine','mashineri'],
    ['ኤክስካቫተር','excavator','exkavator','excavater','digger'],
    ['ቡልዶዘር','bulldozer','buldozer','bull dozer'],
    ['ጂሬደር','grader','motor grader','moto grader','ሞጦ ጂሬደር'],
    ['ክሬን','crane'],
    ['ሮለር','roller','compactor','ኮምፓክተር','compacter'],
    ['ሎደር','loader','front loader','wheel loader'],
    ['ኮንክሪት ሚክሰር','concrete mixer','mixer','ሚክሰር','cement mixer'],
    ['ጀነሬተር','generator','genset','gen'],
    ['ፓምፕ','pump','water pump'],
    ['ስካፎልዲንግ','scaffolding','scaffold'],
    ['ፎርክሊፍት','forklift','fork lift'],
    ['ሞተር ጂሬደር','motor grader','grader'],
    ['ቪብሬተር','vibrator','concrete vibrator'],
    ['ዌልደር','welder','welding machine'],
    ['ኤር ኮምፕሬሰር','air compressor','compressor','ኮምፕሬሰር'],
    ['ሚኒ ኤክስካቫተር','mini excavator','small excavator'],
    ['ሎ ቤድ','low bed','lowbed','lowloader'],
    ['ሲኖትራክ','sinotruk','sino truck','sino','sinotruck','sino-truck'],
    ['ፎው','faw','faaw'],
    ['ኢሱዙ','isuzu','fsr','fsr isuzu'],
    ['ትራክ','truck','trak','lorry'],
    ['ተሳቢ','ተጎታች','trailer','semi trailer','semi-trailer','trailor','treler','traylor','ሴሚ ትሬለር','ትሬለር','tirelar'],
    ['ቴምፖ','tempo','mini truck','pickup','ፒክአፕ','pick up'],
    ['ታንከር','tanker','water tanker','fuel tanker','ነዳጅ ታንከር'],
    ['ዳምፕ','dump truck','dumper','tipper','ዳምፐር','dump'],
    ['ፍላትቤድ','flatbed','flat bed','flat truck'],
    ['ክሬን ትራክ','crane truck','boom truck'],
    ['ፍሪጎ','frigo','refrigerated truck','cold truck','ቀዝቃዛ'],
    ['ሲሎ ትራክ','silo truck','silo','bulk truck','ሲሎ'],
    ['ኮንቴይነር','container truck','container','konteiner'],
    ['ሎ ቤድ ትራክ','low bed truck','lowbed truck','low loader','lowloader'],
    ['ካምፓክተር','compactor truck','garbage truck','refuse truck'],
    ['ካርጎ','cargo truck','cargo','box truck','closed truck','ዝግ ትራክ'],
    ['ቫኩም ታንከር','vacuum tanker','vacuum truck','ቆሻሻ ታንከር'],
    ['ካብ ትራክ','cab truck','tractor head','tractor unit','ትራክተር ሄድ'],
    ['ፒክ አፕ ካርጎ','pickup cargo','light truck'],
    ['ከብት መጫኛ','livestock truck','cattle truck','animal truck'],
    ['አዲስ አበባ','addis ababa','addis','አ.አ','aa','a.a'],
    ['ሀዋሳ','hawasa','hawassa','awasa'],
    ['አዳማ','adama','nazret','ናዝሬት'],
    ['ባህርዳር','bahir dar','bahirdar','bahrdar'],
    ['ጎንደር','gondar','gonder'],
    ['መቀሌ','mekelle','mekele','tigray'],
    ['ጅማ','jimma','jima'],
    ['ድሬዳዋ','dire dawa','diredawa','dire'],
    ['ደሴ','desse','dessie'],
    ['ሐረር','harar','harer'],
    ['አሶሳ','assosa','asosa'],
    ['ወልዲያ','woldia','woldiya','waldiya'],
    ['ሸዋ ሮቢት','shewa robit','shewarobit','shoa robit'],
    ['ሞጆ','mojo','mogio'],
    ['ቡሬ','bure','buri'],
    ['ኮሚቦልቻ','kombolcha','kembolcha'],
    ['ደብረ ብርሃን','debre birhan','debrebirhan'],
    ['ደብረ ማርቆስ','debre markos','debremarkos'],
    ['ሀሮ ሳቢ','haro sabi','haro'],
    ['ሰቆጣ','sekota','seqota'],
    ['ላሊበላ','lalibela','lalibelaa'],
    ['ደብረ ታቦር','debre tabor','debretabor'],
    ['ቡታጅራ','butajira','butajera'],
    ['ሆሳዕና','hossana','hosana','hosanna'],
    ['ጋምቤላ','gambela','gambella'],
    ['ነቀምት','nekemte','nekemt','naqamte'],
    ['ጊምቢ','gimbi','gimby'],
    ['ሞያሌ','moyale','moyale border'],
    ['ጂጂጋ','jijiga','jigjiga'],
    ['ሻሸመኔ','shashemene','shashamane','shashemane'],
    ['ዝዋይ','ziway','zeway','batu'],
    ['ሐምሌ','hamle','july'],
    ['ቦሌ','bole','bole addis'],
    ['ፒያሳ','piassa','piyasa','piaza'],
    ['ሜክሲኮ','mexico','mexiko','meksiko'],
    ['ካዛንቺስ','kazanchis','kazanches'],
    ['ኮልፌ','kolfe','kolfee','kolfe keraniyo'],
    ['አቃቂ','aqaqi','akaki','akaky'],
    ['ቂርቆስ','kirkos','qirqos'],
    ['ጉለሌ','gulele','gullele'],
    ['ሳሪስ','saris','sarris'],
    ['ጀሞ','jemo','jemo 1','jemo 2'],
    ['ሃያ ሁለት','haya hulet','22','hayahulet'],
    ['ስድስት ኪሎ','sidist kilo','6 kilo','sidist'],
    ['አራት ኪሎ','arat kilo','4 kilo'],
    ['ገርጂ','gerji','gerge'],
    ['ጎፋ','gofa','gofa sefer'],
    ['ቦሌ ሚካኤል','bole michael','bole mikael'],
    ['አዘዞ','azezo','azazo'],
    ['መርካቶ','merkato','markato'],
    ['ንፋስ ስልክ','nifas silk','nifas silk lafto'],
    ['አዲስ ከተማ','addis ketema','addis ketma'],
    ['የካ','yeka','yeka sub city'],
    ['ቦሌ ቡልቡሎ','bole bulbulo','bulbulo'],
    ['ቦረና','borena','borana'],
    ['ሀረጌ','hararge','harar region'],
    ['ቤንሻንጉል','benshangul','benishangul','kamashi'],
    ['ዓዋሽ','awash','awash arba'],
    ['ሚሌ','mile','mille'],
    ['በከተማ ውስጥ','አዲስ አበባ ከተማ ውስጥ','in city','local','city','addis local'],
];

const SYNONYM_LOOKUP = new Map();
for (let i = 0; i < SYNONYM_GROUPS.length; i++)
    for (const w of SYNONYM_GROUPS[i])
        SYNONYM_LOOKUP.set(w.toLowerCase(), i);

function editDistance(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 5) return 99; // fast-reject very different lengths
    const dp = Array.from({ length: m+1 }, (_, i) => { const r = new Array(n+1).fill(0); r[0]=i; return r; });
    for (let j=0; j<=n; j++) dp[0][j]=j;
    for (let i=1; i<=m; i++)
        for (let j=1; j<=n; j++)
            dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
    return dp[m][n];
}

function findClosestSynonym(raw) {
    const s = raw.trim().toLowerCase();
    let best = null, bestDist = Infinity;
    for (const word of SYNONYM_LOOKUP.keys()) {
        const d = editDistance(s, word);
        const maxDist = Math.max(1, Math.floor(word.length / 3));
        if (d <= maxDist && d < bestDist) { bestDist = d; best = word; }
    }
    if (!best) return null;
    return SYNONYM_GROUPS[SYNONYM_LOOKUP.get(best)];
}

function buildAlternatives(raw) {
    const s = raw.trim().toLowerCase();
    const alts = new Set([s]);
    if (SYNONYM_LOOKUP.has(s))
        for (const w of SYNONYM_GROUPS[SYNONYM_LOOKUP.get(s)]) alts.add(w.toLowerCase());
    for (const [word, gi] of SYNONYM_LOOKUP.entries())
        if (editDistance(s, word) <= Math.max(1, Math.floor(word.length/4)))
            for (const w of SYNONYM_GROUPS[gi]) alts.add(w.toLowerCase());
    return [...alts];
}

function searchRx(s) {
    if (!s) return new RegExp('','i');
    const patterns = buildAlternatives(s).map(a => a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    return new RegExp(patterns.join('|'),'i');
}

async function findTruck(type, route) {
    const typeRx = searchRx(type), routeRx = searchRx(route);
    let raw = await TruckLeasor.find({ type:typeRx, route:routeRx, status:'active' }).limit(20).lean();
    if (raw.length) return raw;
    raw = await TruckLeasor.find({ type:typeRx, status:'active' }).limit(20).lean();
    if (raw.length) return raw;
    return TruckLeasor.find({ route:routeRx, status:'active' }).limit(20).lean();
}

function logSearch(ctx, category, searchedFor, phone) {
    SearchLog.create({
        userId:      ctx.from.id,
        username:    sanitize(ctx.from.username || 'N/A'),
        category, searchedFor: sanitize(searchedFor), phone: safePhone(phone)
    }).catch(() => {});
}

// ──────────────────────────────────────────────────────────
// OPTION LISTS
// ──────────────────────────────────────────────────────────
const CEMENT_TYPES    = ['ዳንጎቴ','ናሽናል','ሙገር','ደርባ','ሀበሻ','መሰቦ','ኢስት ካፒታል','ሌላ'];
const STEEL_TYPES     = ['ባለ 8mm','ባለ 10mm','ባለ 12mm','ባለ 14mm','ባለ 16mm','ባለ 20mm','ቆርቆሮ (ሌላ)'];
const MACHINERY_TYPES = ['ኤክስካቫተር','ቡልዶዘር','ጂሬደር','ሮለር','ሎደር','ክሬን','ሌላ'];
const TRUCK_TYPES     = ['ሲኖትራክ','FSR Isuzu','ተሳቢ','ሌላ'];
const TRUCK_TRIP_MODE = ['🏙️ አዲስ አበባ ከተማ ውስጥ','🛣️ ከአንድ ከተማ ወደ ሌላ ከተማ'];
const TRUCK_ROUTES_FROM = ['አ.አ','ሀዋሳ','አዳማ','ባህርዳር','ጎንደር','መቀሌ','ጅማ','ድሬዳዋ','ደሴ','ሌላ'];
const TRUCK_ROUTES_TO   = ['አ.አ','ሀዋሳ','አዳማ','ባህርዳር','ጎንደር','መቀሌ','ጅማ','ድሬዳዋ','ደሴ','ሌላ'];
const LOCATIONS = ['አዲስ አበባ','ሀዋሳ','አዳማ','ባህርዳር','ጎንደር','መቀሌ','ጅማ','ድሬዳዋ','ደሴ','ሐረር','ወልዲያ','ኮሚቦልቻ','ሻሸመኔ','ሞጆ','ሌላ'];

// ──────────────────────────────────────────────────────────
// KEYBOARD BUILDERS
// ──────────────────────────────────────────────────────────
function choiceKbWithBack(options, prefix, cols=3, backAction='go_home') {
    const rows = [];
    for (let i=0; i<options.length; i+=cols)
        rows.push(options.slice(i,i+cols).map(o => Markup.button.callback(o, `${prefix}${o}`)));
    rows.push([Markup.button.callback('⬅️ Back', backAction)]);
    return Markup.inlineKeyboard(rows);
}
const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back','go_home')]]);

function getMainKb() {
    const pairs = [
        ['🧱 ሲሚንቶ ለመሸጥ','🧱 ሲሚንቶ ለመግዛት'],
        ['🚚 መኪና ለማከራየት','🚚 መኪና ለመከራየት'],
        ['🟥 ብረት ለመሸጥ','🟥 ብረት ለመግዛት'],
        ['🔹 ማሽነሪ ለማከራየት','🔹 ማሽነሪ ለመከራየት'],
    ];
    const rows = [];
    for (const [L, R] of pairs) {
        const vL = btnVisibility[L] !== false, vR = btnVisibility[R] !== false;
        if (vL && vR) rows.push([L,R]);
        else if (vL) rows.push([L]);
        else if (vR) rows.push([R]);
    }
    rows.push(['📞 አግኙን']);
    return Markup.keyboard(rows).resize();
}

// ──────────────────────────────────────────────────────────
// CARD BUILDERS
// ──────────────────────────────────────────────────────────
function statusBadge(s) { return s==='active' ? '🟢 ክምችት አለ — ይሸጣል' : '🔴 ክምችት የለም — አይሸጥም'; }
function truckStatusBadge(s) { return s==='active' ? '🟢 ዝግጁ ነው — ሊከራይ ይችላል' : '🔴 ስራ ላይ ነው — አይከራይም ❌'; }

function cementCard(it, adminView=false) {
    const badge = adminView ? (it.status==='active'?'✅ ክምችት አለ':'❌ ክምችት የለም') : statusBadge(it.status);
    return `🧱 *${esc(it.companyName||it.type)}*\n▸ አይነት ፦ ${esc(it.type)}\n▸ ቦታ  ፦ ${esc(it.location)}\n▸ 📞 ስልክ ፦ \`${esc(it.phone)}\`\n▸ ዋጋ  ፦ *${fmt(it.price)} ብር/ኩንታል*\n▸ ሁኔታ   ፦ ${badge}`;
}
function cementCardBuyer(it) {
    return `🧱 *${esc(it.companyName||it.type)}*\n▸ አይነት ፦ ${esc(it.type)}\n▸ ቦታ  ፦ ${esc(it.location)}\n▸ ዋጋ  ፦ *${fmt(it.price)} ብር/ኩንታል*\n▸ ${statusBadge(it.status)}`;
}
function steelCard(it, adminView=false) {
    const badge = adminView ? (it.status==='active'?'✅ ክምችት አለ':'❌ ክምችት የለም') : statusBadge(it.status);
    const unit = it.priceUnit||'ብር/ኪሎ';
    return `🟥 *${esc(it.type)}*\n▸ አድራሻ ፦ ${esc(it.address)}\n▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n▸ ዋጋ   ፦ *${fmt(it.price)} ${unit}*\n▸ ሁኔታ    ፦ ${badge}`;
}
function steelCardBuyer(it) {
    const unit = it.priceUnit||'ብር/ኪሎ';
    return `🟥 *${esc(it.type)}*\n▸ አድራሻ ፦ ${esc(it.address)}\n▸ ዋጋ    ፦ *${fmt(it.price)} ${unit}*\n▸ ${statusBadge(it.status)}`;
}
function macCard(it, adminView=false) {
    const badge = adminView ? (it.status==='active'?'✅ ዝግጁ ነው':'❌ አይከራይም') : statusBadge(it.status);
    const unit = it.rentUnit||'በቀን';
    return `🔹 *${esc(it.type)}*\n▸ አድራሻ ፦ ${esc(it.address)}\n▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n▸ ኪራይ  ፦ *${fmt(it.price)} ብር ${unit}*\n▸ ሁኔታ    ፦ ${badge}`;
}
function macCardBuyer(it) {
    const unit = it.rentUnit||'በቀን';
    return `🔹 *${esc(it.type)}*\n▸ አድራሻ ፦ ${esc(it.address)}\n▸ ኪራይ  ፦ *${fmt(it.price)} ብር ${unit}*\n▸ ${statusBadge(it.status)}`;
}
function truckCard(it, adminView=false) {
    const badge = adminView ? (it.status==='active'?'✅ ዝግጁ ነው — ሊከራይ ይችላል':'🔴 ስራ ላይ ነው — አይከራይም ❌') : truckStatusBadge(it.status);
    return `🚚 *${esc(it.type)}*\n▸ 🚗 ታርጋ  ፦ ${esc(it.plate)}\n▸ 🛣️ መስመር ፦ ${esc(it.route)}\n▸ 📞 ስልክ  ፦ \`${esc(it.phone)}\`\n▸ ሁኔታ    ፦ ${badge}`;
}
function truckCardBuyer(it) {
    return `🚚 *${esc(it.type)}*\n▸ 🛣️ መስመር ፦ ${esc(it.route)}\n▸ ${truckStatusBadge(it.status)}`;
}

// ──────────────────────────────────────────────────────────
// PER-ITEM KEYBOARDS
// ──────────────────────────────────────────────────────────
const cementItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ክምችት አለ',`cem_on_${id}`), Markup.button.callback('🔴 ክምችት የለም',`cem_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',`cem_price_${id}`), Markup.button.callback('➕ ሌላ ሲሚንቶ ጨምር','cem_add')]
]);
const steelItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ክምችት አለ',`stl_on_${id}`), Markup.button.callback('🔴 ክምችት የለም',`stl_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',`stl_price_${id}`), Markup.button.callback('➕ ሌላ ብረት ጨምር','stl_add')]
]);
const macItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ዝግጁ ነው — ይከራያል',`mac_on_${id}`), Markup.button.callback('🔴 ስራ ላይ — አይከራይም',`mac_off_${id}`)],
    [Markup.button.callback('💰 ዋጋ ቀይር',`mac_price_${id}`), Markup.button.callback('➕ ሌላ ማሽነሪ ጨምር','mac_add')]
]);
const truckItemKb = id => Markup.inlineKeyboard([
    [Markup.button.callback('🟢 ዝግጁ — ይከራያል',`trk_on_${id}`), Markup.button.callback('🔴 ስራ ላይ — አይከራይም',`trk_off_${id}`)],
    [Markup.button.callback('🗺️ መስመር ቀይር',`trk_route_${id}`), Markup.button.callback('➕ ሌላ መኪና ጨምር','trk_add')]
]);

// ──────────────────────────────────────────────────────────
// WELCOME
// ──────────────────────────────────────────────────────────
const welcomeText = name =>
    `👋 *ሰላም ${esc(name)}!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n🏗️ *መረጃ የንግድ ማዕከል*\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `✅ *ሲሚንቶ* — ለመሸጥ ወይም ለመግዛት\n✅ *ብረት* — ለመሸጥ ወይም ለመግዛት\n` +
    `✅ *ማሽነሪ* — ለማከራየት ወይም ለመከራየት\n✅ *የጭነት መኪና* — ለማከራየት ወይም ለመከራየት\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n❓ *ምን ይፈልጋሉ?*\n_ከዚህ ታች ካሉት ቁልፎች የሚፈልጉትን ይምረጡ_ 👇`;

// ──────────────────────────────────────────────────────────
// STEP HELPERS
// ──────────────────────────────────────────────────────────
async function deletePrev(ctx) {
    const msgId = ctx.session?.lastMsgId;
    if (msgId) { await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {}); ctx.session.lastMsgId = null; }
}
async function sendStep(ctx, text, extra={}) {
    await deletePrev(ctx);
    const sent = await ctx.reply(text, { parse_mode:'Markdown', ...cancelKb, ...extra });
    ctx.session.lastMsgId = sent.message_id;
    return sent;
}
async function askChoice(ctx, prompt, options, prefix, cols=3, backAction='go_home') {
    await deletePrev(ctx);
    const sent = await ctx.reply(prompt, { parse_mode:'Markdown', ...choiceKbWithBack(options,prefix,cols,backAction) });
    ctx.session.lastMsgId = sent.message_id;
    return sent;
}
function isValidObjectId(id) { return /^[a-f\d]{24}$/i.test(Array.isArray(id)?id[1]:id); }
function getObjId(m) { return Array.isArray(m)?m[1]:m; }

// ──────────────────────────────────────────────────────────
// START
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    ctx.reply(welcomeText(sanitize(ctx.from.first_name||'ጎብኚ')), { parse_mode:'Markdown', ...getMainKb() });
});

bot.hears('📞 አግኙን', ctx => {
    ctx.session.action = null;
    ctx.reply(
        `📞 *አግኙን*\n\nለማዘዝ፣ ለጥያቄ ወይም ለድጋፍ:\n\n📱 *${SUPPORT_PHONE}*\n\n_🕐 ሁሌም ክፍት ነን!_`,
        { parse_mode:'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('🏠 ወደ ዋና ማውጫ ተመለስ','go_home')]]) }
    );
});

bot.action('go_home', async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    ctx.session.action = null;
    ctx.reply(welcomeText(sanitize(ctx.from.first_name||'ጎብኚ')), { parse_mode:'Markdown', ...getMainKb() });
});

// ──────────────────────────────────────────────────────────
// ADMIN PANEL
// ──────────────────────────────────────────────────────────
const BTN_ID = {
    '🧱 ሲሚንቶ ለመሸጥ':'b0','🧱 ሲሚንቶ ለመግዛት':'b1',
    '🚚 መኪና ለማከራየት':'b2','🚚 መኪና ለመከራየት':'b3',
    '🟥 ብረት ለመሸጥ':'b4','🟥 ብረት ለመግዛት':'b5',
    '🔹 ማሽነሪ ለማከራየት':'b6','🔹 ማሽነሪ ለመከራየት':'b7',
};
const ID_BTN = Object.fromEntries(Object.entries(BTN_ID).map(([k,v])=>[v,k]));

function btnToggleKb() {
    const rows = ALL_MAIN_BUTTONS.map(label => {
        const icon = btnVisibility[label]!==false ? '✅' : '❌';
        return [Markup.button.callback(`${icon} ${label}`,`btntog_${BTN_ID[label]}`)];
    });
    rows.push([Markup.button.callback('⬅️ ወደ አድሚን ፓናል','admin_home')]);
    return Markup.inlineKeyboard(rows);
}

bot.command('admin_panel', ctx => { if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም!'); showAdminHome(ctx); });
bot.action('admin_home', async ctx => { ctx.answerCbQuery().catch(()=>{}); showAdminHome(ctx); });

async function showAdminHome(ctx) {
    ctx.reply('🔧 *አድሚን ፓናል* — ዘርፍ ይምረጡ:', {
        parse_mode:'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ','rep_cem'), Markup.button.callback('🚚 ትራክ','rep_trk')],
            [Markup.button.callback('🟥 ብረት','rep_stl'), Markup.button.callback('🔹 ማሽነሪ','rep_mac')],
            [Markup.button.callback('📊 ፍለጋ ሪፖርት (ዛሬ)','rep_searches')],
            [Markup.button.callback('👁️ ሲሚንቶ — ተፈላጊ','rep_cem_views'), Markup.button.callback('👁️ ብረት — ተፈላጊ','rep_stl_views')],
            [Markup.button.callback('👁️ ማሽነሪ — ተፈላጊ','rep_mac_views'), Markup.button.callback('👁️ ትራክ — ተፈላጊ','rep_trk_views')],
            [Markup.button.callback('🗑️ ማጥፊያ','admin_del')],
            [Markup.button.callback('🎛️ Main Buttons አቀናብር','admin_btn_vis')]
        ])
    });
}

bot.action('admin_btn_vis', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery().catch(()=>{});
    ctx.reply(`🎛️ *Main Buttons አቀናብር*\n\nይምረጡ ✅=ይታያል  ❌=ተደብቋል`, { parse_mode:'Markdown', ...btnToggleKb() });
});

bot.action(/^btntog_(b[0-7])$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    const label = ID_BTN[ctx.match[1]];
    if (!label) return ctx.answerCbQuery('❗').catch(()=>{});
    btnVisibility[label] = btnVisibility[label]===false;
    saveBtnVisibility();
    ctx.answerCbQuery(btnVisibility[label]?'✅ ታይቷል':'❌ ተደብቋል').catch(()=>{});
    ctx.editMessageReplyMarkup(btnToggleKb().reply_markup).catch(()=>{});
});

const adminDelKb = (prefix,id) => Markup.inlineKeyboard([[Markup.button.callback('🗑️ ምዝገባ አጥፋ',`adel_do_${prefix}_${id}`)]]);

async function adminReport(ctx, Model, title, cardFn, prefix) {
    ctx.answerCbQuery?.().catch(()=>{});
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const items = await Model.find({}).sort({ status:-1, createdAt:-1 }).lean();
    if (!items.length) return ctx.reply(`📭 *${title}*\n\nምንም ምዝገባ አልተገኘም።`, { parse_mode:'Markdown' });
    const ac = items.filter(i=>i.status==='active').length;
    await ctx.reply(`📋 *${title}*\nጠቅላላ: *${items.length}* ✅ አለ: *${ac}* ❌ የለም: *${items.length-ac}*`, { parse_mode:'Markdown' });
    for (const it of items)
        await ctx.reply(cardFn(it,true), { parse_mode:'Markdown', ...adminDelKb(prefix,it._id) });
}

bot.action('rep_cem', ctx => adminReport(ctx,CementSeller,'🧱 ሲሚንቶ ሻጮች',cementCard,'cem'));
bot.action('rep_trk', ctx => adminReport(ctx,TruckLeasor,'🚚 ትራክ አከራዮች',truckCard,'trk'));
bot.action('rep_stl', ctx => adminReport(ctx,SteelSeller,'🟥 ብረት ሻጮች',steelCard,'stl'));
bot.action('rep_mac', ctx => adminReport(ctx,MachineryLeasor,'🔹 ማሽነሪ',macCard,'mac'));

async function viewCountReport(ctx, Model, title, cardFn) {
    ctx.answerCbQuery().catch(()=>{});
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const items = await Model.find({ viewCount:{$gt:0} }).sort({ viewCount:-1, createdAt:-1 }).lean();
    if (!items.length) return ctx.reply(`📭 *${title}*\n\nገና ምንም ደምበኛ አልፈለገም።`, { parse_mode:'Markdown' });
    const total = items.reduce((s,i)=>s+(i.viewCount||0),0);
    await ctx.reply(`👁️ *${title}*\nጠቅላላ ፍለጋ: *${total}* | ዕቃዎች: *${items.length}*`, { parse_mode:'Markdown' });
    for (const it of items) {
        const rented = it.rentedCount!=null?`\n▸ 🔑 ተከራይቷል ፦ *${it.rentedCount} ጊዜ*`:'';
        await ctx.reply(`${cardFn(it,true)}\n▸ 👁️ ተፈልጎ ታይቷል ፦ *${it.viewCount||0} ጊዜ*${rented}`, { parse_mode:'Markdown' });
    }
}
bot.action('rep_cem_views', ctx => viewCountReport(ctx,CementSeller,'🧱 ሲሚንቶ — በደምበኛ የተፈለጉ',cementCard));
bot.action('rep_stl_views', ctx => viewCountReport(ctx,SteelSeller,'🟥 ብረት — በደምበኛ የተፈለጉ',steelCard));
bot.action('rep_mac_views', ctx => viewCountReport(ctx,MachineryLeasor,'🔹 ማሽነሪ — በደምበኛ የተፈለጉ',macCard));
bot.action('rep_trk_views', ctx => viewCountReport(ctx,TruckLeasor,'🚚 ትራክ — በደምበኛ የተፈለጉ',truckCard));

bot.action('rep_searches', async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    if (!isAdmin(ctx)) return ctx.reply('⛔');
    const cutoff = new Date(Date.now() - 27*3600*1000);
    const logs = await SearchLog.find({ createdAt:{$gte:cutoff} }).sort({ createdAt:-1 }).limit(200).lean();
    if (!logs.length) return ctx.reply('📭 ዛሬ ምንም ፍለጋ አልተገኘም።');
    const CAT_EMOJI = { '🧱 ሲሚንቶ ፈላጊ':'🧱','🟥 ብረት ፈላጊ':'🟥','🔹 ማሽነሪ ፈላጊ':'🔹','🚚 ትራክ ፈላጊ':'🚚' };
    const groups = {};
    for (const l of logs) (groups[l.category]=groups[l.category]||[]).push(l);
    const lines = [`📊 *የዛሬ ፍለጋ ሪፖርት* 📅 ${ethTimestamp(new Date())}`, `━━━━━━━━━━━━━━━━━━━━━`];
    for (const [cat,entries] of Object.entries(groups))
        lines.push(`${CAT_EMOJI[cat]||'🔍'} ${cat.replace(/^[^ ]+ /,'')} — *${entries.length} ፍለጋ*`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━\n🔢 ጠቅላላ ዛሬ: *${logs.length}*`);
    await ctx.reply(lines.join('\n'), { parse_mode:'Markdown' });
    for (const e of logs) {
        const who = e.username&&e.username!=='N/A' ? `  👤 @${esc(e.username)}` : '';
        await ctx.reply(
            `${CAT_EMOJI[e.category]||'🔍'} *${esc(e.category)}*\n🔎 ${esc(e.searchedFor)}\n📞 \`${esc(e.phone)}\`${who}\n🕐 ${ethTimestamp(e.createdAt)}`,
            { parse_mode:'Markdown' }
        );
    }
});

bot.action('admin_del', async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    ctx.answerCbQuery().catch(()=>{});
    ctx.reply('🗑️ *ማጥፊያ* — ዘርፍ ይምረጡ:', {
        parse_mode:'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ','adel_cem'), Markup.button.callback('🚚 ትራክ','adel_trk')],
            [Markup.button.callback('🟥 ብረት','adel_stl'), Markup.button.callback('🔹 ማሽነሪ','adel_mac')]
        ])
    });
});

const MMAP = { cem:CementSeller, trk:TruckLeasor, stl:SteelSeller, mac:MachineryLeasor };
async function delMenu(ctx, Model, labelFn, prefix, title) {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔');
    ctx.answerCbQuery().catch(()=>{});
    const items = await Model.find({}).lean();
    if (!items.length) return ctx.reply('📭 የሚጠፋ ምዝገባ የለም።');
    ctx.reply(`🗑️ *${title}* — የሚያጠፉትን ይምረጡ:`, {
        parse_mode:'Markdown',
        ...Markup.inlineKeyboard(items.map(it=>[Markup.button.callback(`🗑️ ${labelFn(it)}`,`adel_do_${prefix}_${it._id}`)]))
    });
}
bot.action('adel_cem', ctx => delMenu(ctx,CementSeller,it=>`${it.companyName} (${it.phone})`,'cem','ሲሚንቶ'));
bot.action('adel_trk', ctx => delMenu(ctx,TruckLeasor,it=>`${it.plate} (${it.phone})`,'trk','ትራክ'));
bot.action('adel_stl', ctx => delMenu(ctx,SteelSeller,it=>`${it.type} (${it.phone})`,'stl','ብረት'));
bot.action('adel_mac', ctx => delMenu(ctx,MachineryLeasor,it=>`${it.type} (${it.phone})`,'mac','ማሽነሪ'));
bot.action(/^adel_do_(cem|trk|stl|mac)_([a-f\d]{24})$/i, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔').catch(()=>{});
    ctx.answerCbQuery('🗑️ ተሰርዟል').catch(()=>{});
    const [,p,id] = ctx.match;
    if (!isValidObjectId(id)) return;
    await MMAP[p].findByIdAndDelete(id);
    ctx.reply('✅ ምዝገባው ተሰርዟል።');
});

// ──────────────────────────────────────────────────────────
// TOGGLE / PRICE / ROUTE ACTIONS
// ──────────────────────────────────────────────────────────
async function toggleItem(ctx, Model, matchArr, newStatus, cardFn, kb) {
    const id = getObjId(matchArr);
    if (!isValidObjectId(id)) return ctx.answerCbQuery('❗ Invalid ID').catch(()=>{});
    const isTruck = Model===TruckLeasor;
    const label = newStatus==='active'
        ? (isTruck?'✅ ዝግጁ ነው!':'✅ ወደ "አለ" ተቀይሯል!')
        : (isTruck?'🔴 ስራ ላይ ነው!':'🔴 ወደ "የለም" ተቀይሯል!');
    ctx.answerCbQuery(label).catch(()=>{});
    let doc = await Model.findOneAndUpdate({ _id:id, userId:ctx.from.id }, { status:newStatus }, { new:true });
    if (!doc && isAdmin(ctx)) doc = await Model.findByIdAndUpdate(id, { status:newStatus }, { new:true });
    if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም').catch(()=>{});
    ctx.editMessageText(cardFn(doc.toObject(),isAdmin(ctx)), { parse_mode:'Markdown', ...kb(doc._id) }).catch(()=>{});
}

bot.action(/^cem_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx,CementSeller,ctx.match,'active',cementCard,cementItemKb));
bot.action(/^cem_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx,CementSeller,ctx.match,'off',cementCard,cementItemKb));
bot.action(/^stl_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx,SteelSeller,ctx.match,'active',steelCard,steelItemKb));
bot.action(/^stl_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx,SteelSeller,ctx.match,'off',steelCard,steelItemKb));
bot.action(/^mac_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx,MachineryLeasor,ctx.match,'active',macCard,macItemKb));
bot.action(/^mac_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx,MachineryLeasor,ctx.match,'off',macCard,macItemKb));
bot.action(/^trk_on_([a-f\d]{24})$/i,  ctx => toggleItem(ctx,TruckLeasor,ctx.match,'active',truckCard,truckItemKb));
bot.action(/^trk_off_([a-f\d]{24})$/i, ctx => toggleItem(ctx,TruckLeasor,ctx.match,'off',truckCard,truckItemKb));

bot.action(/^cem_price_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    const id=getObjId(ctx.match); if (!isValidObjectId(id)) return;
    ctx.session.action='UPD_CEM_PRICE'; ctx.session.targetItemId=id;
    sendStep(ctx,'💰 *አዲሱን ዋጋ ያስገቡ:*\nለምሳሌ: 1200 ወይም 1500');
});
bot.action('cem_add', async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    ctx.session.action='REG_CEMENT_1'; ctx.session.cementData={};
    askChoice(ctx,'🧱 `[1/5]` *የሲሚንቶ አይነት ይምረጡ:*',CEMENT_TYPES,'CTYPE_',4);
});
bot.action(/^stl_price_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    const id=getObjId(ctx.match); if (!isValidObjectId(id)) return;
    ctx.session.action='UPD_STL_PRICE'; ctx.session.targetItemId=id;
    sendStep(ctx,'💰 *አዲሱን ዋጋ ፐር ኪሎ ያስገቡ:*\nለምሳሌ: 55 ወይም 70');
});
bot.action('stl_add', async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    ctx.session.action='REG_STEEL_1'; ctx.session.steelData={};
    askChoice(ctx,'🟥 `[1/4]` *የብረት አይነት ይምረጡ:*',STEEL_TYPES,'STYPE_',3);
});
bot.action(/^mac_price_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    const id=getObjId(ctx.match); if (!isValidObjectId(id)) return;
    ctx.session.action='UPD_MAC_PRICE'; ctx.session.targetItemId=id;
    sendStep(ctx,'💰 *አዲሱን ኪራይ ያስገቡ:*\nለምሳሌ: 15000');
});
bot.action('mac_add', async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    ctx.session.action='REG_MACHINERY_1'; ctx.session.machineryData={};
    askChoice(ctx,'🔹 `[1/4]` *የማሽነሪ አይነት ይምረጡ:*',MACHINERY_TYPES,'MTYPE_',2);
});
bot.action('MACUNIT_day', async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    ctx.session.machineryData.rentUnit='በቀን'; ctx.session.action='REG_MACHINERY_4';
    const s=await ctx.reply('`[5/5]` 💰 *ኪራይ ዋጋ በቀን ያስገቡ:*\nለምሳሌ: 15000',{parse_mode:'Markdown',...cancelKb});
    ctx.session.lastMsgId=s.message_id;
});
bot.action('MACUNIT_month', async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    ctx.session.machineryData.rentUnit='በወር'; ctx.session.action='REG_MACHINERY_4';
    const s=await ctx.reply('`[5/5]` 💰 *ኪራይ ዋጋ በወር ያስገቡ:*\nለምሳሌ: 350000',{parse_mode:'Markdown',...cancelKb});
    ctx.session.lastMsgId=s.message_id;
});
bot.action(/^trk_route_([a-f\d]{24})$/i, async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    const id=getObjId(ctx.match); if (!isValidObjectId(id)) return;
    ctx.session.action='UPD_TRK_ROUTE'; ctx.session.targetItemId=id;
    sendStep(ctx,'🗺️ *አዲሱን የጉዞ መስመር ያስገቡ:*\nለምሳሌ: ከ አ.አ ወደ ሀዋሳ');
});
bot.action('trk_add', async ctx => {
    ctx.answerCbQuery().catch(()=>{});
    ctx.session.action='REG_TRUCK_1'; ctx.session.truckData={};
    askChoice(ctx,'🚚 `[1/4]` *የመኪናውን አይነት ይምረጡ:*',TRUCK_TYPES,'TKTYPE_',2);
});
bot.action('REGTRKMODE_AA', async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    ctx.session.truckData.route='አዲስ አበባ ከተማ ውስጥ'; ctx.session.action='REG_TRUCK_4';
    const s=await ctx.reply('`[4/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*',{parse_mode:'Markdown',...cancelKb});
    ctx.session.lastMsgId=s.message_id;
});
bot.action('REGTRKMODE_CITY', async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    ctx.session.action='REG_TRUCK_3';
    const s=await ctx.reply('`[3/4]` 🛣️ *የጉዞ መስመር ያስገቡ:*\nለምሳሌ: ከ አ.አ ወደ ሀዋሳ',{parse_mode:'Markdown',...cancelKb});
    ctx.session.lastMsgId=s.message_id;
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACKS — SELLER REGISTRATION
// ──────────────────────────────────────────────────────────
bot.action(/^CTYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='REG_CEMENT_1_TEXT'; return sendStep(ctx,'🧱 *የሲሚንቶ አይነት ጽፈው ያስገቡ:*'); }
    ctx.session.cementData={type:val}; ctx.session.action='REG_CEMENT_2';
    askChoice(ctx,'`[2/5]` 📍 *ሲሚንቶው የሚሸጥበት ቦታ ይምረጡ:*',LOCATIONS,'SLOC_',4);
});
bot.action(/^SLOC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='REG_CEMENT_2_TEXT'; return sendStep(ctx,'📍 *ቦታ ጽፈው ያስገቡ:*'); }
    ctx.session.cementData.location=val; ctx.session.action='REG_CEMENT_3';
    sendStep(ctx,'`[3/5]` 🏭 *የድርጅቱን ስም ያስገቡ:*\nለምሳሌ: ሀበሻ ንግድ ቤት');
});
bot.action(/^STYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ቆርቆሮ (ሌላ)'||val==='ሌላ') { ctx.session.action='REG_STEEL_1_TEXT'; return sendStep(ctx,'🟥 *የብረት አይነት ጽፈው ያስገቡ:*'); }
    ctx.session.steelData={type:val}; ctx.session.action='REG_STEEL_2';
    sendStep(ctx,'`[2/4]` 📍 *አድራሻዎን ያስገቡ:*');
});
bot.action(/^MTYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='REG_MACHINERY_1_TEXT'; return sendStep(ctx,'🔹 *የማሽነሪ አይነት ጽፈው ያስገቡ:*'); }
    ctx.session.machineryData={type:val}; ctx.session.action='REG_MACHINERY_2';
    sendStep(ctx,'`[2/4]` 📍 *አድራሻዎን ያስገቡ:*\nማሽነሪው የሚኖርበት ቦታ');
});
bot.action(/^TKTYPE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='REG_TRUCK_1_TEXT'; return sendStep(ctx,'🚚 *የመኪናውን አይነት ጽፈው ያስገቡ:*'); }
    ctx.session.truckData={type:val}; ctx.session.action='REG_TRUCK_2';
    sendStep(ctx,'`[2/4]` 🚗 *የመኪናው ታርጋ ቁጥር ያስገቡ:*\nለምሳሌ: AA-12345');
});

// ──────────────────────────────────────────────────────────
// DROPDOWN CALLBACKS — BUYER/RENTER
// ──────────────────────────────────────────────────────────
bot.action(/^BCEM_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='BUY_CEMENT_1_TEXT'; return sendStep(ctx,'🧱 *ምን አይነት ሲሚንቶ ይፈልጋሉ?*'); }
    ctx.session.buyCement={type:val}; ctx.session.action='BUY_CEMENT_2';
    askChoice(ctx,'`[2/3]` 📍 *ሲሚንቶ ከየትኛው ከተማ?*',LOCATIONS,'BCEMLOC_',4);
});
bot.action(/^BCEMLOC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='BUY_CEMENT_2_TEXT'; return sendStep(ctx,'📍 *ሲሚንቶ ከየትኛው ከተማ? ጽፈው ያስገቡ:*'); }
    ctx.session.buyCement.location=val; ctx.session.action='BUY_CEMENT_3';
    sendStep(ctx,'`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
});
bot.action(/^BSTL_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ቆርቆሮ (ሌላ)'||val==='ሌላ') { ctx.session.action='BUY_STEEL_1_TEXT'; return sendStep(ctx,'🟥 *ምን አይነት ብረት ይፈልጋሉ?*'); }
    ctx.session.buySteel={type:val}; ctx.session.action='BUY_STEEL_2';
    sendStep(ctx,'`[2/2]` 📍 *ብረት ከየትኛው ቦታ?*');
});
bot.action(/^BMAC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='RENT_MACHINERY_1_TEXT'; return sendStep(ctx,'🔹 *ምን አይነት ማሽነሪ ይፈልጋሉ?*'); }
    ctx.session.rentMachinery={type:val}; ctx.session.action='RENT_MACHINERY_2';
    sendStep(ctx,'`[2/2]` 📍 *ማሽነሪ ከየትኛው ቦታ?*');
});
bot.action(/^BTRK_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='RENT_TRUCK_1_TEXT'; return sendStep(ctx,'🚚 *ምን አይነት መኪና ይፈልጋሉ?*'); }
    ctx.session.rentTruck={type:val}; ctx.session.action='RENT_TRUCK_TRIP_MODE';
    askChoice(ctx,'`[2/5]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*',TRUCK_TRIP_MODE,'BTRKMODE_',1,'BACK_TRUCK_TYPE');
});
bot.action(/^BTRKMODE_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='🏙️ አዲስ አበባ ከተማ ውስጥ') {
        ctx.session.rentTruck.route='አዲስ አበባ ከተማ ውስጥ'; ctx.session.action='RENT_TRUCK_3';
        return sendStep(ctx,'`[3/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
    }
    ctx.session.action='RENT_TRUCK_2';
    askChoice(ctx,'`[3/5]` 🛣️ *ጉዞ ከየት ይጀምራሉ?*',TRUCK_ROUTES_FROM,'BTRKLOC_',4,'BACK_TRIP_MODE');
});
bot.action(/^BTRKLOC_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const raw=sanitize(ctx.match[1]);
    if (ctx.session.action==='RENT_TRUCK_2') {
        if (raw==='ሌላ') { ctx.session.action='RENT_TRUCK_2_FROM_TEXT'; return sendStep(ctx,'🛣️ *ከየት? (መነሻ ቦታ) ጽፈው ያስገቡ:*'); }
        ctx.session.rentTruck.routeFrom=raw; ctx.session.action='RENT_TRUCK_2_TO';
        askChoice(ctx,'🛣️ *ወዴት ቦታ ይፈልጋሉ?*',TRUCK_ROUTES_TO,'BTRKTO_',4,'BACK_TRIP_MODE');
    }
});
bot.action(/^BTRKTO_(.+)$/, async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    const val=sanitize(ctx.match[1]);
    if (val==='ሌላ') { ctx.session.action='RENT_TRUCK_2_TO_TEXT'; return sendStep(ctx,'🛣️ *ወዴት? (መድረሻ ቦታ) ጽፈው ያስገቡ:*'); }
    ctx.session.rentTruck.route=`ከ ${ctx.session.rentTruck.routeFrom||''} ወደ ${val}`;
    ctx.session.action='RENT_TRUCK_3';
    sendStep(ctx,'`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
});
bot.action('BACK_TRIP_MODE', async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    ctx.session.action='RENT_TRUCK_TRIP_MODE';
    askChoice(ctx,'`[2/5]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*',TRUCK_TRIP_MODE,'BTRKMODE_',1,'BACK_TRUCK_TYPE');
});
bot.action('BACK_TRUCK_TYPE', async ctx => {
    ctx.answerCbQuery().catch(()=>{}); await deletePrev(ctx);
    ctx.session.action='RENT_TRUCK_1'; ctx.session.rentTruck={};
    askChoice(ctx,'`[1/5]` 🚚 *ምን አይነት መኪና ይፈልጋሉ?*',TRUCK_TYPES,'BTRK_',2,'go_home');
});

// ──────────────────────────────────────────────────────────
// SELLER DASHBOARD
// ──────────────────────────────────────────────────────────
async function openDashboard(ctx, Model, cardFn, kb, emptyAction, emptySession, askChoiceFn) {
    ctx.session.action=null;
    const items=await Model.find({userId:ctx.from.id}).sort({createdAt:-1}).lean();
    if (!items.length) { ctx.session.action=emptyAction; ctx.session[emptySession]={}; return askChoiceFn(ctx); }
    await ctx.reply(`👤 *የእርስዎ ምዝገባዎች* — ጠቅላላ: *${items.length}*`, {parse_mode:'Markdown'});
    for (const it of items) await ctx.reply(cardFn(it,false), {parse_mode:'Markdown',...kb(it._id)});
}

bot.hears('🧱 ሲሚንቶ ለመሸጥ', ctx => openDashboard(ctx,CementSeller,cementCard,cementItemKb,'REG_CEMENT_1','cementData',
    c=>askChoice(c,'🧱 `[1/5]` *የሲሚንቶ አይነት ይምረጡ:*',CEMENT_TYPES,'CTYPE_',4)));
bot.hears('🟥 ብረት ለመሸጥ', ctx => openDashboard(ctx,SteelSeller,steelCard,steelItemKb,'REG_STEEL_1','steelData',
    c=>askChoice(c,'🟥 `[1/4]` *የብረት አይነት ይምረጡ:*',STEEL_TYPES,'STYPE_',3)));
bot.hears('🔹 ማሽነሪ ለማከራየት', ctx => openDashboard(ctx,MachineryLeasor,macCard,macItemKb,'REG_MACHINERY_1','machineryData',
    c=>askChoice(c,'🔹 `[1/4]` *የማሽነሪ አይነት ይምረጡ:*',MACHINERY_TYPES,'MTYPE_',2)));
bot.hears('🚚 መኪና ለማከራየት', ctx => openDashboard(ctx,TruckLeasor,truckCard,truckItemKb,'REG_TRUCK_1','truckData',
    c=>askChoice(c,'🚚 `[1/4]` *የመኪናውን አይነት ይምረጡ:*',TRUCK_TYPES,'TKTYPE_',2)));

// ──────────────────────────────────────────────────────────
// BUYER/RENTER FLOWS
// ──────────────────────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => { ctx.session.action='BUY_CEMENT_1'; ctx.session.buyCement={}; askChoice(ctx,'🧱 `[1/3]` *ምን አይነት ሲሚንቶ ይፈልጋሉ?*',CEMENT_TYPES,'BCEM_',4); });
bot.hears('🟥 ብረት ለመግዛት',  ctx => { ctx.session.action='BUY_STEEL_1';  ctx.session.buySteel={};  askChoice(ctx,'🟥 `[1/3]` *ምን አይነት ብረት ይፈልጋሉ?*',STEEL_TYPES,'BSTL_',3); });
bot.hears('🔹 ማሽነሪ ለመከራየት',ctx => { ctx.session.action='RENT_MACHINERY_1'; ctx.session.rentMachinery={}; askChoice(ctx,'🔹 `[1/3]` *ምን አይነት ማሽነሪ ይፈልጋሉ?*',MACHINERY_TYPES,'BMAC_',2); });
bot.hears('🚚 መኪና ለመከራየት', ctx => { ctx.session.action='RENT_TRUCK_1';  ctx.session.rentTruck={};  askChoice(ctx,'`[1/5]` 🚚 *ምን አይነት መኪና ይፈልጋሉ?*',TRUCK_TYPES,'BTRK_',2,'go_home'); });

// ──────────────────────────────────────────────────────────
// BACK BUTTON HANDLERS — SELLER
// ──────────────────────────────────────────────────────────
const backB = (action, fn) => bot.action(action, async ctx => { ctx.answerCbQuery().catch(()=>{}); await fn(ctx); });
backB('SBACK_CEM_1', ctx => { ctx.session.action='REG_CEMENT_1'; ctx.session.cementData={}; askChoice(ctx,'🧱 `[1/5]` *የሲሚንቶ አይነት ይምረጡ:*',CEMENT_TYPES,'CTYPE_',4); });
backB('SBACK_CEM_2', ctx => { ctx.session.action='REG_CEMENT_2'; askChoice(ctx,'`[2/5]` 📍 *ሲሚንቶው የሚሸጥበት ቦታ ይምረጡ:*',LOCATIONS,'SLOC_',4,'SBACK_CEM_1'); });
backB('SBACK_CEM_3', ctx => { ctx.session.action='REG_CEMENT_3'; sendStep(ctx,'`[3/5]` 🏭 *የድርጅቱን ስም ያስገቡ:*'); });
backB('SBACK_CEM_4', ctx => { ctx.session.action='REG_CEMENT_4'; sendStep(ctx,'`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*'); });
backB('SBACK_STL_1', ctx => { ctx.session.action='REG_STEEL_1'; ctx.session.steelData={}; askChoice(ctx,'🟥 `[1/4]` *የብረት አይነት ይምረጡ:*',STEEL_TYPES,'STYPE_',3); });
backB('SBACK_STL_2', ctx => { ctx.session.action='REG_STEEL_2'; sendStep(ctx,'`[2/4]` 📍 *አድራሻዎን ያስገቡ:*'); });
backB('SBACK_STL_3', ctx => { ctx.session.action='REG_STEEL_3'; sendStep(ctx,'`[3/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*'); });
backB('SBACK_MAC_1', ctx => { ctx.session.action='REG_MACHINERY_1'; ctx.session.machineryData={}; askChoice(ctx,'🔹 `[1/4]` *የማሽነሪ አይነት ይምረጡ:*',MACHINERY_TYPES,'MTYPE_',2); });
backB('SBACK_MAC_2', ctx => { ctx.session.action='REG_MACHINERY_2'; sendStep(ctx,'`[2/4]` 📍 *አድራሻዎን ያስገቡ:*'); });
backB('SBACK_MAC_3', ctx => { ctx.session.action='REG_MACHINERY_3'; sendStep(ctx,'`[3/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*'); });
backB('SBACK_MAC_UNIT', async ctx => {
    ctx.session.action='REG_MACHINERY_UNIT'; await deletePrev(ctx);
    const s=await ctx.reply('`[4/5]` 📅 *ኪራይ ዓይነት ይምረጡ:*',{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('📅 በቀን','MACUNIT_day'),Markup.button.callback('🗓️ በወር','MACUNIT_month')],[Markup.button.callback('⬅️ Back','SBACK_MAC_3')]])});
    ctx.session.lastMsgId=s.message_id;
});
backB('SBACK_TRK_1', ctx => { ctx.session.action='REG_TRUCK_1'; ctx.session.truckData={}; askChoice(ctx,'🚚 `[1/4]` *የመኪናውን አይነት ይምረጡ:*',TRUCK_TYPES,'TKTYPE_',2); });
backB('SBACK_TRK_2', ctx => { ctx.session.action='REG_TRUCK_2'; sendStep(ctx,'`[2/4]` 🚗 *የመኪናው ታርጋ ቁጥር ያስገቡ:*'); });
backB('SBACK_TRK_3', async ctx => {
    ctx.session.action='REG_TRUCK_ROUTE_MODE'; await deletePrev(ctx);
    const s=await ctx.reply('`[3/4]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*',{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🏙️ አዲስ አበባ ከተማ ውስጥ','REGTRKMODE_AA')],[Markup.button.callback('🛣️ ከአንድ ከተማ ወደ ሌላ ከተማ','REGTRKMODE_CITY')],[Markup.button.callback('⬅️ Back','SBACK_TRK_2')]])});
    ctx.session.lastMsgId=s.message_id;
});

bot.action('fuzzy_hint_yes', ctx => ctx.answerCbQuery().catch(()=>{}));
bot.action('fuzzy_no',       ctx => ctx.answerCbQuery('እሺ!').catch(()=>{}));

// ──────────────────────────────────────────────────────────
// SUPPORT LINE CONSTANT
// ──────────────────────────────────────────────────────────
const supportLine       = `\n📞 *ለማዘዝ ይደዉሉ:*\n👉 \`${SUPPORT_PHONE}\``;
const sellerSupportLine = `\n📞 *ለማዘዝ ወይም ለድጋፍ:*\n👉 \`${SUPPORT_PHONE}\``;

// ──────────────────────────────────────────────────────────
// TEXT STATE MACHINE
// ──────────────────────────────────────────────────────────
async function tryFuzzyHint(ctx, input, results) {
    if (results.length>0) return false;
    const closest=findClosestSynonym(input);
    if (closest && closest[0].toLowerCase()!==input.trim().toLowerCase()) {
        await ctx.reply(`🤔 *"${esc(input)}"* — ይህን ለማለት ፈልገህ ነው?\n\n👉 *"${esc(closest[0])}"*`,{
            parse_mode:'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback(`✅ አዎ — "${closest[0]}" ፈልግ`,'fuzzy_hint_yes'),Markup.button.callback('❌ አይደለም','fuzzy_no')]])
        });
        return true;
    }
    return false;
}

bot.on('text', async (ctx, next) => {
    const rawText = ctx.message.text.trim();
    if (rawText.startsWith('/')) return next();
    const text   = sanitize(rawText);
    const action = ctx.session?.action;
    if (!action) return;
    const uid = ctx.from.id;

    try {
        // ══ UPDATE PRICE / ROUTE ══════════════════════════
        if (action==='UPD_CEM_PRICE') {
            const price=safePrice(text);
            if (!price) return sendStep(ctx,'⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 650');
            const id=ctx.session.targetItemId;
            let doc=await CementSeller.findOneAndUpdate({_id:id,userId:uid},{price},{new:true});
            if (!doc&&isAdmin(ctx)) doc=await CementSeller.findByIdAndUpdate(id,{price},{new:true});
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action=null;
            await ctx.reply(cementCard(doc.toObject()),{parse_mode:'Markdown',...cementItemKb(doc._id)});
            return ctx.reply('✅ ዋጋ ተቀይሯል!'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }
        if (action==='UPD_STL_PRICE') {
            const price=safePrice(text);
            if (!price) return sendStep(ctx,'⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 55');
            const id=ctx.session.targetItemId;
            let doc=await SteelSeller.findOneAndUpdate({_id:id,userId:uid},{price},{new:true});
            if (!doc&&isAdmin(ctx)) doc=await SteelSeller.findByIdAndUpdate(id,{price},{new:true});
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action=null;
            await ctx.reply(steelCard(doc.toObject()),{parse_mode:'Markdown',...steelItemKb(doc._id)});
            return ctx.reply('✅ ዋጋ ተቀይሯል!'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }
        if (action==='UPD_MAC_PRICE') {
            const price=safePrice(text);
            if (!price) return sendStep(ctx,'⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 15000');
            const id=ctx.session.targetItemId;
            let doc=await MachineryLeasor.findOneAndUpdate({_id:id,userId:uid},{price},{new:true});
            if (!doc&&isAdmin(ctx)) doc=await MachineryLeasor.findByIdAndUpdate(id,{price},{new:true});
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action=null;
            await ctx.reply(macCard(doc.toObject()),{parse_mode:'Markdown',...macItemKb(doc._id)});
            return ctx.reply('✅ ዋጋ ተቀይሯል!'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }
        if (action==='UPD_TRK_ROUTE') {
            const id=ctx.session.targetItemId;
            let doc=await TruckLeasor.findOneAndUpdate({_id:id,userId:uid},{route:text},{new:true});
            if (!doc&&isAdmin(ctx)) doc=await TruckLeasor.findByIdAndUpdate(id,{route:text},{new:true});
            if (!doc) return ctx.reply('❗ ፈቃድ የለዎትም ወይም ዕቃው አልተገኘም።');
            ctx.session.action=null;
            await ctx.reply(truckCard(doc.toObject()),{parse_mode:'Markdown',...truckItemKb(doc._id)});
            return ctx.reply('✅ መስመር ተቀይሯል!'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }

        // ══ CEMENT REGISTRATION ════════════════════════════
        if (action==='REG_CEMENT_1'||action==='REG_CEMENT_1_TEXT') {
            ctx.session.cementData={type:text}; ctx.session.action='REG_CEMENT_2';
            return askChoice(ctx,'`[2/5]` 📍 *ሲሚንቶው የሚሸጥበት ቦታ ይምረጡ:*',LOCATIONS,'SLOC_',4);
        }
        if (action==='REG_CEMENT_2'||action==='REG_CEMENT_2_TEXT') {
            ctx.session.cementData.location=text; ctx.session.action='REG_CEMENT_3';
            return sendStep(ctx,'`[3/5]` 🏭 *የድርጅቱን ስም ያስገቡ:*\nለምሳሌ: ሀበሻ ንግድ ቤት');
        }
        if (action==='REG_CEMENT_3') {
            ctx.session.cementData.companyName=text; ctx.session.action='REG_CEMENT_4';
            return sendStep(ctx,'`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='REG_CEMENT_4') {
            ctx.session.cementData.phone=safePhone(text); ctx.session.action='REG_CEMENT_5';
            return sendStep(ctx,'`[5/5]` 💰 *ዋጋ በኩንታል ያስገቡ:*\nለምሳሌ: 1200');
        }
        if (action==='REG_CEMENT_5') {
            const price=safePrice(text);
            if (!price) return sendStep(ctx,'⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 1200');
            const doc=await CementSeller.create({...ctx.session.cementData,userId:uid,price,status:'active'});
            ctx.session.action=null;
            await ctx.reply(cementCard(doc.toObject()),{parse_mode:'Markdown',...cementItemKb(doc._id)});
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }

        // ══ STEEL REGISTRATION ════════════════════════════
        if (action==='REG_STEEL_1'||action==='REG_STEEL_1_TEXT') {
            ctx.session.steelData={type:text}; ctx.session.action='REG_STEEL_2';
            return sendStep(ctx,'`[2/4]` 📍 *አድራሻዎን ያስገቡ:*');
        }
        if (action==='REG_STEEL_2') {
            ctx.session.steelData.address=text; ctx.session.action='REG_STEEL_3';
            return sendStep(ctx,'`[3/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='REG_STEEL_3') {
            ctx.session.steelData.phone=safePhone(text); ctx.session.action='REG_STEEL_4';
            return sendStep(ctx,'`[4/4]` 💰 *ዋጋ ፐር ኪሎ ግራም ያስገቡ:*\nለምሳሌ: 55');
        }
        if (action==='REG_STEEL_4') {
            const price=safePrice(text);
            if (!price) return sendStep(ctx,'⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 55');
            const doc=await SteelSeller.create({...ctx.session.steelData,userId:uid,price,priceUnit:'ብር/ኪሎ',status:'active'});
            ctx.session.action=null;
            await ctx.reply(steelCard(doc.toObject()),{parse_mode:'Markdown',...steelItemKb(doc._id)});
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }

        // ══ MACHINERY REGISTRATION ════════════════════════
        if (action==='REG_MACHINERY_1'||action==='REG_MACHINERY_1_TEXT') {
            ctx.session.machineryData={type:text}; ctx.session.action='REG_MACHINERY_2';
            return sendStep(ctx,'`[2/4]` 📍 *አድራሻዎን ያስገቡ:*\nማሽነሪው የሚኖርበት ቦታ');
        }
        if (action==='REG_MACHINERY_2') {
            ctx.session.machineryData.address=text; ctx.session.action='REG_MACHINERY_3';
            return sendStep(ctx,'`[3/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='REG_MACHINERY_3') {
            ctx.session.machineryData.phone=safePhone(text); ctx.session.action='REG_MACHINERY_UNIT';
            await deletePrev(ctx);
            const s=await ctx.reply('`[4/5]` 📅 *ኪራይ ዓይነት ይምረጡ:*',{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('📅 በቀን','MACUNIT_day'),Markup.button.callback('🗓️ በወር','MACUNIT_month')],[Markup.button.callback('⬅️ Back','SBACK_MAC_3')]])});
            ctx.session.lastMsgId=s.message_id;
            return;
        }
        if (action==='REG_MACHINERY_4') {
            const price=safePrice(text);
            if (!price) return sendStep(ctx,'⚠️ ትክክለኛ ቁጥር ያስገቡ!\nለምሳሌ: 15000');
            const unit=ctx.session.machineryData.rentUnit||'በቀን';
            const doc=await MachineryLeasor.create({...ctx.session.machineryData,userId:uid,price,rentUnit:unit,status:'active'});
            ctx.session.action=null;
            await ctx.reply(macCard(doc.toObject()),{parse_mode:'Markdown',...macItemKb(doc._id)});
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }

        // ══ TRUCK REGISTRATION ════════════════════════════
        if (action==='REG_TRUCK_1'||action==='REG_TRUCK_1_TEXT') {
            ctx.session.truckData={type:text}; ctx.session.action='REG_TRUCK_2';
            return sendStep(ctx,'`[2/4]` 🚗 *የመኪናው ታርጋ ቁጥር ያስገቡ:*\nለምሳሌ: AA-12345');
        }
        if (action==='REG_TRUCK_2') {
            ctx.session.truckData.plate=text; ctx.session.action='REG_TRUCK_ROUTE_MODE';
            await deletePrev(ctx);
            const s=await ctx.reply('`[3/4]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*',{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🏙️ አዲስ አበባ ከተማ ውስጥ','REGTRKMODE_AA')],[Markup.button.callback('🛣️ ከአንድ ከተማ ወደ ሌላ ከተማ','REGTRKMODE_CITY')],[Markup.button.callback('⬅️ Back','SBACK_TRK_2')]])});
            ctx.session.lastMsgId=s.message_id;
            return;
        }
        if (action==='REG_TRUCK_3') { ctx.session.truckData.route=text; ctx.session.action='REG_TRUCK_4'; return sendStep(ctx,'`[4/4]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*'); }
        if (action==='REG_TRUCK_4') {
            ctx.session.truckData.phone=safePhone(text);
            const doc=await TruckLeasor.create({...ctx.session.truckData,userId:uid,status:'active',rentedCount:0});
            ctx.session.action=null;
            await ctx.reply(truckCard(doc.toObject()),{parse_mode:'Markdown',...truckItemKb(doc._id)});
            return ctx.reply('✅ *ምዝገባ ተጠናቋል!*'+sellerSupportLine,{parse_mode:'Markdown',...getMainKb()});
        }

        // ══ BUY CEMENT ════════════════════════════════════
        if (action==='BUY_CEMENT_1'||action==='BUY_CEMENT_1_TEXT') {
            ctx.session.buyCement={type:text}; ctx.session.action='BUY_CEMENT_2';
            return askChoice(ctx,'`[2/3]` 📍 *ሲሚንቶ ከየትኛው ከተማ?*',LOCATIONS,'BCEMLOC_',4);
        }
        if (action==='BUY_CEMENT_2'||action==='BUY_CEMENT_2_TEXT') {
            ctx.session.buyCement.location=text; ctx.session.action='BUY_CEMENT_3';
            return sendStep(ctx,'`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='BUY_CEMENT_3') {
            const phone=safePhone(text);
            ctx.session.buyCement.phone=phone;
            const {type,location}=ctx.session.buyCement;
            const typeRx=searchRx(type), locRx=searchRx(location);
            let raw=await CementSeller.find({type:typeRx,location:locRx,status:'active'}).sort({price:1}).limit(20).lean();
            const results=fairShuffle(raw).slice(0,3);
            logSearch(ctx,'🧱 ሲሚንቶ ፈላጊ',`${type} — ${location}`,phone);
            ctx.session.action=null;
            const hinted=await tryFuzzyHint(ctx,`${type} ${location}`,results);
            if (!hinted&&!results.length) return ctx.reply(`😔 *ይቅርታ!*\n\n*${esc(type)}* ሲሚንቶ *${esc(location)}* ቦታ ላይ አልተገኘም።\n\n📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,{parse_mode:'Markdown',...getMainKb()});
            if (results.length) {
                await ctx.reply(`🎉 *እንኳ ደሳለዎት! ሻጮች እዚህ ይገኛሉ!!*`,{parse_mode:'Markdown'});
                for (const it of results) { await ctx.reply(cementCardBuyer(it),{parse_mode:'Markdown'}); CementSeller.findByIdAndUpdate(it._id,{$inc:{viewCount:1}}).catch(()=>{}); }
                await ctx.reply(supportLine,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔄 ሌላ አማራጭ ይፈልጋሉ?','REFRESH_CEM')],[Markup.button.callback('🏠 ወደ ዋና ማውጫ','go_home')]])});
            }
            return;
        }

        // ══ BUY STEEL ═════════════════════════════════════
        if (action==='BUY_STEEL_1'||action==='BUY_STEEL_1_TEXT') {
            ctx.session.buySteel={type:text}; ctx.session.action='BUY_STEEL_2';
            return sendStep(ctx,'`[2/3]` 📍 *ብረት ከየትኛው ቦታ ነው?*');
        }
        if (action==='BUY_STEEL_2') {
            ctx.session.buySteel.location=text; ctx.session.action='BUY_STEEL_3';
            return sendStep(ctx,'`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='BUY_STEEL_3') {
            const phone=safePhone(text);
            ctx.session.buySteel.phone=phone;
            const {type,location}=ctx.session.buySteel;
            const typeRx=searchRx(type), locRx=searchRx(location);
            let raw=await SteelSeller.find({type:typeRx,address:locRx,status:'active'}).sort({price:1}).limit(20).lean();
            const results=fairShuffle(raw).slice(0,3);
            logSearch(ctx,'🟥 ብረት ፈላጊ',`${type} — ${location}`,phone);
            ctx.session.action=null;
            const hinted=await tryFuzzyHint(ctx,`${type} ${location}`,results);
            if (!hinted&&!results.length) return ctx.reply(`😔 *ይቅርታ!*\n\n*${esc(type)}* ብረት *${esc(location)}* ቦታ ላይ አልተገኘም።\n\n📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,{parse_mode:'Markdown',...getMainKb()});
            if (results.length) {
                await ctx.reply(`🎉 *እንኳ ደሳለዎት! ሻጮች እዚህ ይገኛሉ!!*`,{parse_mode:'Markdown'});
                for (const it of results) { await ctx.reply(steelCardBuyer(it),{parse_mode:'Markdown'}); SteelSeller.findByIdAndUpdate(it._id,{$inc:{viewCount:1}}).catch(()=>{}); }
                await ctx.reply(supportLine,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔄 ሌላ አማራጭ ይፈልጋሉ?','REFRESH_STL')],[Markup.button.callback('🏠 ወደ ዋና ማውጫ','go_home')]])});
            }
            return;
        }

        // ══ RENT MACHINERY ════════════════════════════════
        if (action==='RENT_MACHINERY_1'||action==='RENT_MACHINERY_1_TEXT') {
            ctx.session.rentMachinery={type:text}; ctx.session.action='RENT_MACHINERY_2';
            return sendStep(ctx,'`[2/3]` 📍 *ማሽነሪ ከየትኛው ቦታ ነው?*');
        }
        if (action==='RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location=text; ctx.session.action='RENT_MACHINERY_3';
            return sendStep(ctx,'`[3/3]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='RENT_MACHINERY_3') {
            const phone=safePhone(text);
            ctx.session.rentMachinery.phone=phone;
            const {type,location}=ctx.session.rentMachinery;
            const typeRx=searchRx(type), locRx=searchRx(location);
            let raw=await MachineryLeasor.find({type:typeRx,address:locRx,status:'active'}).sort({price:1}).limit(20).lean();
            const all=fairShuffle(raw);
            const idx=ctx.session.rentMachinery.rotateIdx||0;
            const results=all.length?[all[idx%all.length]]:[];
            ctx.session.rentMachinery.rotateIdx=(idx+1)%Math.max(all.length,1);
            logSearch(ctx,'🔹 ማሽነሪ ፈላጊ',`${type} — ${location}`,phone);
            ctx.session.action=null;
            const hinted=await tryFuzzyHint(ctx,`${type} ${location}`,results);
            if (!hinted&&!results.length) return ctx.reply(`😔 *ይቅርታ!*\n\n*${esc(type)}* ማሽነሪ *${esc(location)}* ቦታ ላይ አልተገኘም።\n\n📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,{parse_mode:'Markdown',...getMainKb()});
            if (results.length) {
                await ctx.reply(`🎉 *እንኳ ደሳለዎት! አከራዮች እዚህ ይገኛሉ!!*`,{parse_mode:'Markdown'});
                for (const it of results) { await ctx.reply(macCardBuyer(it),{parse_mode:'Markdown'}); MachineryLeasor.findByIdAndUpdate(it._id,{$inc:{viewCount:1}}).catch(()=>{}); }
                await ctx.reply(supportLine,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔄 ሌላ አማራጭ ይፈልጋሉ?','REFRESH_MAC')],[Markup.button.callback('🏠 ወደ ዋና ማውጫ','go_home')]])});
            }
            return;
        }

        // ══ RENT TRUCK ════════════════════════════════════
        if (action==='RENT_TRUCK_1'||action==='RENT_TRUCK_1_TEXT') {
            ctx.session.rentTruck={type:text}; ctx.session.action='RENT_TRUCK_TRIP_MODE';
            return askChoice(ctx,'`[2/5]` 🛣️ *የጉዞ ዓይነት ይምረጡ:*',TRUCK_TRIP_MODE,'BTRKMODE_',1,'BACK_TRUCK_TYPE');
        }
        if (action==='RENT_TRUCK_AA_TEXT') {
            ctx.session.rentTruck.route=`አዲስ አበባ — ${text}`; ctx.session.action='RENT_TRUCK_3';
            return sendStep(ctx,'`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='RENT_TRUCK_2_FROM_TEXT') {
            ctx.session.rentTruck.routeFrom=text; ctx.session.action='RENT_TRUCK_2_TO';
            return askChoice(ctx,'🛣️ *ወዴት ቦታ ይፈልጋሉ?*',TRUCK_ROUTES_TO,'BTRKTO_',4,'BACK_TRIP_MODE');
        }
        if (action==='RENT_TRUCK_2_TO_TEXT') {
            ctx.session.rentTruck.route=`ከ ${ctx.session.rentTruck.routeFrom||''} ወደ ${text}`; ctx.session.action='RENT_TRUCK_3';
            return sendStep(ctx,'`[4/5]` 📞 *ስልክ ቁጥርዎን ያስገቡ:*');
        }
        if (action==='RENT_TRUCK_3') {
            ctx.session.rentTruck.phone=safePhone(text); ctx.session.action='RENT_TRUCK_4';
            return sendStep(ctx,'`[4/4]` 📦 *ምን ዓይነት ጭነት ነው?*\nለምሳሌ: ሲሚንቶ፣ ብረት ወይም ሌላ');
        }
        if (action==='RENT_TRUCK_4') {
            const cargo=text, phone=ctx.session.rentTruck.phone;
            const {type,route}=ctx.session.rentTruck;
            ctx.session.rentTruck.cargo=cargo;
            const raw=await findTruck(type,route);
            const all=[...raw].sort(()=>Math.random()-0.5);
            const idx=ctx.session.rentTruck.rotateIdx||0;
            const results=all.length?[all[idx%all.length]]:[];
            ctx.session.rentTruck.rotateIdx=(idx+1)%Math.max(all.length,1);
            logSearch(ctx,'🚚 ትራክ ፈላጊ',`${type} — ${route} — ${cargo}`,phone);
            ctx.session.action=null;
            const hinted=await tryFuzzyHint(ctx,`${type} ${route}`,results);
            if (!hinted&&!results.length) return ctx.reply(`😔 *ይቅርታ!*\n\n*${esc(type)}* — *${esc(route)}*\n\nምንም መኪና አልተገኘም።\n\n📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,{parse_mode:'Markdown',...getMainKb()});
            if (results.length) {
                await ctx.reply(`🎉 *እንኳ ደሳለዎት! አከራዮች እዚህ ይገኛሉ!!*`,{parse_mode:'Markdown'});
                for (const it of results) { await ctx.reply(truckCardBuyer(it),{parse_mode:'Markdown'}); TruckLeasor.findByIdAndUpdate(it._id,{$inc:{rentedCount:1,viewCount:1}}).catch(()=>{}); }
                await ctx.reply(supportLine,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔄 ሌላ አማራጭ ይፈልጋሉ?','REFRESH_TRK')],[Markup.button.callback('🏠 ወደ ዋና ማውጫ','go_home')]])});
            }
            return;
        }

    } catch (err) {
        console.error('[StateMachine]', err.message);
        ctx.reply('⚠️ ስህተት ተፈጥሯል። እባክዎ ዳግም ይሞክሩ።', getMainKb()).catch(()=>{});
    }
});

// ──────────────────────────────────────────────────────────
// REFRESH ACTIONS
// ──────────────────────────────────────────────────────────
async function refreshResults(ctx, Model, sessionKey, cardFn, logCategory, locationField, refreshAction, pageSize=3) {
    ctx.answerCbQuery('🔄 ሌላ አማራጭ እየፈለግን...').catch(()=>{});
    const saved=ctx.session[sessionKey];
    if (!saved) return ctx.reply('⚠️ ፍለጋ ቢደፈፋ ዳግም ይሞክሩ።', getMainKb());
    const {type,location,phone}=saved;
    const typeRx=searchRx(type), locRx=searchRx(location||'');
    let raw=await Model.find({type:typeRx,[locationField]:locRx,status:'active'}).sort({price:1}).limit(20).lean();
    if (!raw.length) return ctx.reply(`😔 *ሌላ አማራጭ አልተገኘም።*\n\n📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,{parse_mode:'Markdown',...getMainKb()});
    let results;
    if (pageSize===1) {
        const idx=saved.rotateIdx||0;
        const all=fairShuffle(raw);
        results=[all[idx%all.length]];
        ctx.session[sessionKey].rotateIdx=(idx+1)%Math.max(all.length,1);
    } else {
        results=fairShuffle(raw).slice(0,pageSize);
    }
    logSearch(ctx,logCategory,`${type} — ${location} [refresh]`,phone);
    await ctx.reply(`🎉 *እንኳ ደሳለዎት! አከራዮች እዚህ ይገኛሉ!!*`,{parse_mode:'Markdown'});
    for (const it of results) { await ctx.reply(cardFn(it),{parse_mode:'Markdown'}); Model.findByIdAndUpdate(it._id,{$inc:{viewCount:1}}).catch(()=>{}); }
    await ctx.reply(`_ሌላ አማራጭ ለማየት:_`,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔄 ሌላ አማራጭ ይፈልጋሉ?',refreshAction)],[Markup.button.callback('🏠 ወደ ዋና ማውጫ','go_home')]])});
}

bot.action('REFRESH_CEM', ctx => refreshResults(ctx,CementSeller,'buyCement',cementCardBuyer,'🧱 ሲሚንቶ ፈላጊ','location','REFRESH_CEM',3));
bot.action('REFRESH_STL', ctx => refreshResults(ctx,SteelSeller,'buySteel',steelCardBuyer,'🟥 ብረት ፈላጊ','address','REFRESH_STL',3));
bot.action('REFRESH_MAC', ctx => refreshResults(ctx,MachineryLeasor,'rentMachinery',macCardBuyer,'🔹 ማሽነሪ ፈላጊ','address','REFRESH_MAC',1));

bot.action('REFRESH_TRK', async ctx => {
    ctx.answerCbQuery('🔄 ሌላ አማራጭ እየፈለግን...').catch(()=>{});
    const saved=ctx.session.rentTruck;
    if (!saved) return ctx.reply('⚠️ ፍለጋ ቢደፈፋ ዳግም ይሞክሩ።', getMainKb());
    const {type,route,phone}=saved;
    const raw=await findTruck(type,route);
    if (!raw.length) return ctx.reply(`😔 *ሌላ አማራጭ አልተገኘም።*\n\n📞 ለእርዳታ: \`${SUPPORT_PHONE}\``,{parse_mode:'Markdown',...getMainKb()});
    const all=[...raw].sort(()=>Math.random()-0.5);
    const idx=saved.rotateIdx||0;
    const results=[all[idx%all.length]];
    ctx.session.rentTruck.rotateIdx=(idx+1)%Math.max(all.length,1);
    logSearch(ctx,'🚚 ትራክ ፈላጊ',`${type} — ${route} [refresh]`,phone);
    await ctx.reply(`🎉 *እንኳ ደሳለዎት! አከራዮች እዚህ ይገኛሉ!!*`,{parse_mode:'Markdown'});
    for (const it of results) { await ctx.reply(truckCardBuyer(it),{parse_mode:'Markdown'}); TruckLeasor.findByIdAndUpdate(it._id,{$inc:{viewCount:1}}).catch(()=>{}); }
    await ctx.reply(`_ሌላ አማራጭ ለማየት:_`,{parse_mode:'Markdown',...Markup.inlineKeyboard([[Markup.button.callback('🔄 ሌላ አማራጭ ይፈልጋሉ?','REFRESH_TRK')],[Markup.button.callback('🏠 ወደ ዋና ማውጫ','go_home')]])});
});

// ──────────────────────────────────────────────────────────
// HTTP SERVER — handles webhook + keep-alive
// ──────────────────────────────────────────────────────────
let webhookPath = null;

// Security headers applied to every response
function applySecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const server = http.createServer((req, res) => {
    applySecurityHeaders(res);

    // ── Webhook handler ──────────────────────────────
    if (webhookPath && req.method==='POST' && req.url===webhookPath) {
        // Validate Telegram secret header
        const secret = req.headers['x-telegram-bot-api-secret-token'];
        if (secret !== WEBHOOK_SECRET) {
            console.warn('[Security] Webhook request rejected — bad secret from', req.socket.remoteAddress);
            res.writeHead(403); res.end('Forbidden');
            return;
        }
        let body = '', size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_PAYLOAD_BYTES) {
                console.warn('[Security] Oversized payload rejected — aborting request');
                req.destroy();
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            try { bot.handleUpdate(JSON.parse(body), res); }
            catch { res.writeHead(200); res.end(); }
        });
        req.on('error', () => { res.writeHead(200); res.end(); });
        return;
    }

    // ── Health check ─────────────────────────────────
    if ((req.method==='GET') && (req.url==='/'||req.url==='/health')) {
        const memMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({
            status:'ok',
            version: 'v10.0',
            uptime: Math.floor(process.uptime()),
            uptimeHuman: formatUptime(process.uptime()),
            mongo: mongoose.connection.readyState===1?'connected':'disconnected',
            sessions: sessionCache.size,
            blocked: blockedUsers.size,
            memMB,
            ts: new Date().toISOString()
        }));
        return;
    }

    res.writeHead(404); res.end();
});

function formatUptime(s) {
    const d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), m=Math.floor((s%3600)/60);
    return `${d}d ${h}h ${m}m`;
}

// Set server timeouts to prevent slow-loris attacks
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 61_000;

server.listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));

// Keep-alive self-ping every 25 s — prevents Render free-tier spin-down
// Uses native http to avoid extra deps
if (RENDER_URL) {
    const https = require('https');
    const pingUrl = new URL(RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`);
    let pingFails = 0;
    const PING_INTERVAL = 20_000; // 20s — more aggressive to prevent Render spin-down
    setInterval(() => {
        const lib = pingUrl.protocol === 'https:' ? https : http;
        const req = lib.request({
            hostname: pingUrl.hostname,
            port: pingUrl.port || (pingUrl.protocol === 'https:' ? 443 : 80),
            path: '/health',
            method: 'GET',
            timeout: 8_000,
            headers: { 'User-Agent': 'BotSelfPing/1.0' }
        }, res => {
            pingFails = 0;
            res.resume(); // drain
        });
        req.on('error', () => {
            pingFails++;
            if (pingFails % 5 === 0) console.warn(`[Ping] ${pingFails} consecutive ping failures`);
        });
        req.on('timeout', () => req.destroy());
        req.end();
    }, PING_INTERVAL);
}

// ──────────────────────────────────────────────────────────
// LAUNCH — webhook (Render) or long-polling (local)
// ──────────────────────────────────────────────────────────
async function launch() {
    if (RENDER_URL) {
        webhookPath = `/webhook/${crypto.randomBytes(16).toString('hex')}`;
        const webhookUrl = `${RENDER_URL}${webhookPath}`;
        // Delete old webhook first, then set new
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        await bot.telegram.setWebhook(webhookUrl, {
            allowed_updates: ['message','callback_query'],
            max_connections: 100,
            secret_token: WEBHOOK_SECRET,  // Telegram signs requests with this
        });
        console.log(`🔗 Webhook set: ${webhookUrl}`);
    } else {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        await bot.launch({ allowedUpdates: ['message','callback_query'] });
        console.log('🤖 Bot launched (long-polling)');
    }
}

// Retry launch up to 5 times with backoff
async function launchWithRetry(attempt=1) {
    try {
        await launch();
        console.log(`✅ Bot launched successfully on attempt ${attempt}`);
    } catch (err) {
        console.error(`❌ Bot launch failed (attempt ${attempt}):`, err.message);
        if (attempt >= 10) { console.error('❌ Giving up after 10 attempts'); process.exit(1); }
        // Exponential backoff: 2s, 4s, 8s … capped at 60s
        const delay = Math.min(Math.pow(2, attempt) * 1000, 60_000);
        console.log(`⏳ Retrying in ${delay/1000}s (attempt ${attempt+1}/10)...`);
        setTimeout(() => launchWithRetry(attempt + 1), delay);
    }
}

launchWithRetry();

async function gracefulShutdown(signal) {
    console.log(`🔴 ${signal} received — shutting down gracefully...`);
    try {
        bot.stop(signal);
        await flushSessionWrites();
        await mongoose.connection.close();
        console.log('✅ Clean shutdown complete');
    } catch (e) {
        console.error('[Shutdown]', e.message);
    } finally {
        process.exit(0);
    }
}
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
