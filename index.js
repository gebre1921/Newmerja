'use strict';

// ╔══════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v3.0                   ║
// ║  ሲሚንቶ · ብረት · ማሽነሪ · ትራክ                              ║
// ╚══════════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const http      = require('http');
const mongoose  = require('mongoose');

// ──────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────
const BOT_TOKEN     = (process.env.BOT_TOKEN    || '').trim().replace(/['"]/g, '');
const MONGO_URI     =  process.env.MONGO_URI    || '';
const SUPPORT_PHONE =  process.env.SUPPORT_PHONE || '0960336138';
const ADMIN_IDS     = (process.env.ADMIN_IDS    || '7423347375')
                        .split(',').map(s => Number(s.trim()));
const PORT          = Number(process.env.PORT)  || 10000;
const RENDER_URL    =  process.env.RENDER_EXTERNAL_URL || '';

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌ BOT_TOKEN ወይም MONGO_URI አልተገኘም!');
    process.exit(1);
}

// ──────────────────────────────────────────────────────────
// SCHEMAS
// ──────────────────────────────────────────────────────────
const cementSchema = new mongoose.Schema({
    userId:      { type: Number, required: true, index: true },
    type:        { type: String, default: '' },
    location:    { type: String, default: '' },
    companyName: { type: String, default: '' },
    phone:       { type: String, default: '' },
    price:       { type: Number, default: 0 },   // ብር / ኩንታል
    status:      { type: String, default: 'active' },
    createdAt:   { type: Date,   default: Date.now }
});
cementSchema.index({ type: 1, location: 1, status: 1 });

const steelSchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    status:    { type: String, default: 'active' },
    createdAt: { type: Date,   default: Date.now }
});
steelSchema.index({ type: 1, status: 1 });

const machinerySchema = new mongoose.Schema({
    userId:    { type: Number, required: true, index: true },
    type:      { type: String, default: '' },
    address:   { type: String, default: '' },
    phone:     { type: String, default: '' },
    price:     { type: Number, default: 0 },
    status:    { type: String, default: 'active' },
    createdAt: { type: Date,   default: Date.now }
});
machinerySchema.index({ type: 1, status: 1 });

const truckSchema = new mongoose.Schema({
    userId:      { type: Number, required: true, index: true },
    type:        { type: String, default: '' },
    plate:       { type: String, default: '' },
    route:       { type: String, default: '' },
    phone:       { type: String, default: '' },
    status:      { type: String, default: 'active' },
    rentedCount: { type: Number, default: 0 },
    createdAt:   { type: Date,   default: Date.now }
});
truckSchema.index({ type: 1, route: 1, status: 1 });

const searchLogSchema = new mongoose.Schema({
    userId: Number, username: String, category: String,
    searchedFor: String, phone: String,
    createdAt: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
    key:  { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const CementSeller    = mongoose.model('CementSeller',    cementSchema);
const SteelSeller     = mongoose.model('SteelSeller',     steelSchema);
const MachineryLeasor = mongoose.model('MachineryLeasor', machinerySchema);
const TruckLeasor     = mongoose.model('TruckLeasor',     truckSchema);
const SearchLog       = mongoose.model('SearchLog',       searchLogSchema);
const BotSession      = mongoose.model('BotSession',      sessionSchema);

// ──────────────────────────────────────────────────────────
// MONGODB
// ──────────────────────────────────────────────────────────
async function connectMongo() {
    try {
        await mongoose.connect(MONGO_URI, {
            maxPoolSize: 50, minPoolSize: 5,
            serverSelectionTimeoutMS: 8000,
            socketTimeoutMS: 45000,
            heartbeatFrequencyMS: 10000,
            retryWrites: true
        });
        console.log('✅ MongoDB Connected');
    } catch (err) {
        console.error('❌ MongoDB failed:', err.message);
        setTimeout(connectMongo, 5000);
    }
}
mongoose.connection.on('disconnected', () => setTimeout(connectMongo, 3000));
mongoose.connection.on('error', err => console.error('Mongo:', err));
connectMongo();

// ──────────────────────────────────────────────────────────
// BOT + SESSION
// ──────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 90_000,
    telegram: { webhookReply: false }
});

const sessionCache = new Map();
const SESSION_MAX  = 5000;

function lruSet(k, v) {
    if (sessionCache.size >= SESSION_MAX && !sessionCache.has(k)) {
        sessionCache.delete(sessionCache.keys().next().value);
    }
    sessionCache.set(k, v);
}

bot.use(async (ctx, next) => {
    if (!ctx.from) return next();
    const k = String(ctx.from.id);
    if (!sessionCache.has(k)) {
        const doc = await BotSession.findOne({ key: k }).lean().catch(() => null);
        lruSet(k, doc?.data ?? {});
    }
    ctx.session = sessionCache.get(k);
    await next();
    lruSet(k, ctx.session);
    BotSession.updateOne({ key: k }, { $set: { data: ctx.session } }, { upsert: true }).catch(() => {});
});

// ──────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);

function searchRx(s) {
    if (!s) return new RegExp('', 'i');
    const c = s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /[a-zA-Z]/.test(c) ? new RegExp(c.split('').join('.*'), 'i') : new RegExp(c, 'i');
}

async function logSearch(ctx, category, searchedFor, phone) {
    SearchLog.create({
        userId: ctx.from.id, username: ctx.from.username || 'N/A',
        category, searchedFor, phone
    }).catch(() => {});
}

const fmt = n => Number(n).toLocaleString('en');
const safe = s => (s || '—').toString().replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');

// ──────────────────────────────────────────────────────────
// INLINE KEYBOARD BUILDERS  (per-item buttons)
// ──────────────────────────────────────────────────────────

/**
 * ሲሚንቶ per-item keyboard
 *   ✅ አለ  |  ❌ የለም
 *   💰 ዋጋ ቀይር  |  ➕ ሌላ ጨምር
 */
function cementItemKb(id) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ አለ',        `cem_on_${id}`),
            Markup.button.callback('❌ የለም',       `cem_off_${id}`)
        ],
        [
            Markup.button.callback('💰 ዋጋ ቀይር',  `cem_price_${id}`),
            Markup.button.callback('➕ ሌላ ጨምር',   'cem_add')
        ]
    ]);
}

/**
 * ብረት per-item keyboard
 */
function steelItemKb(id) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ አለ',        `stl_on_${id}`),
            Markup.button.callback('❌ የለም',       `stl_off_${id}`)
        ],
        [
            Markup.button.callback('💰 ዋጋ ቀይር',  `stl_price_${id}`),
            Markup.button.callback('➕ ሌላ ጨምር',   'stl_add')
        ]
    ]);
}

/**
 * ማሽነሪ per-item keyboard
 */
function macItemKb(id) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ አለ',        `mac_on_${id}`),
            Markup.button.callback('❌ የለም',       `mac_off_${id}`)
        ],
        [
            Markup.button.callback('💰 ዋጋ ቀይር',  `mac_price_${id}`),
            Markup.button.callback('➕ ሌላ ጨምር',   'mac_add')
        ]
    ]);
}

/**
 * ትራክ per-item keyboard
 */
function truckItemKb(id) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ ዝግጁ',       `trk_on_${id}`),
            Markup.button.callback('⏳ ስራ ላይ',    `trk_off_${id}`)
        ],
        [
            Markup.button.callback('🗺️ መስመር ቀይር', `trk_route_${id}`),
            Markup.button.callback('➕ ሌላ ጨምር',    'trk_add')
        ]
    ]);
}

// ──────────────────────────────────────────────────────────
// MAIN KEYBOARD
// ──────────────────────────────────────────────────────────
const mainKb = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ',    '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት',   '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ',     '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// ──────────────────────────────────────────────────────────
// ITEM CARD FORMATTERS
// ──────────────────────────────────────────────────────────
function cementCard(it) {
    const dot = it.status === 'active' ? '🟢' : '🔴';
    return (
        `${dot} *${it.companyName || it.type}*\n` +
        `🧱 አይነት: ${it.type}   📍 ${it.location}\n` +
        `💰 ${fmt(it.price)} ብር/ኩንታል   📞 ${it.phone}`
    );
}

function steelCard(it) {
    const dot = it.status === 'active' ? '🟢' : '🔴';
    return (
        `${dot} *${it.type}*\n` +
        `📍 ${it.address}   📞 ${it.phone}\n` +
        `💰 ${fmt(it.price)} ብር`
    );
}

function macCard(it) {
    const dot = it.status === 'active' ? '🟢' : '🔴';
    return (
        `${dot} *${it.type}*\n` +
        `📍 ${it.address}   📞 ${it.phone}\n` +
        `💰 ${fmt(it.price)} ብር`
    );
}

function truckCard(it) {
    const dot = it.status === 'active' ? '🟢' : '⏳';
    return (
        `${dot} *${it.type}*  🚗 ${it.plate}\n` +
        `🛣️ ${it.route}   📞 ${it.phone}`
    );
}

// ──────────────────────────────────────────────────────────
// START
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    ctx.reply(
        `🌟 *እንኳን ወደ Simple ቦት በሰላም መጡ!*\n\n` +
        `ሲሚንቶ ✦ ብረት ✦ ማሽነሪ ✦ ትራክ\n` +
        `ለመሸጥ / ለመግዛት / ለማከራየት / ለመከራየት\n\n` +
        `👇 ከታቹ አንዱን ይምረጡ`,
        { parse_mode: 'Markdown', ...mainKb }
    );
});

// ──────────────────────────────────────────────────────────
// ADMIN
// ──────────────────────────────────────────────────────────
bot.command('admin_panel', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም!');
    ctx.reply('🔧 *አድሚን ፓናል*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ',  'rep_cem'), Markup.button.callback('🚚 ትራክ',   'rep_trk')],
            [Markup.button.callback('🟥 ብረት',    'rep_stl'), Markup.button.callback('🔹 ማሽነሪ', 'rep_mac')],
            [Markup.button.callback('📊 ፍለጋዎች', 'rep_searches')],
            [Markup.button.callback('🗑️ ማጥፊያ',  'admin_del')]
        ])
    });
});

async function report(ctx, Model, title, card) {
    const items = await Model.find({}).lean();
    if (!items.length) { ctx.answerCbQuery?.(); return ctx.reply(`${title}: ምንም የለም።`); }
    let buf = `📋 *${title}*\n${'─'.repeat(20)}\n`;
    for (const it of items) {
        const line = `\n${card(it)}\n${'─'.repeat(20)}\n`;
        if (buf.length + line.length > 3800) { await ctx.reply(buf, { parse_mode: 'Markdown' }); buf = ''; }
        buf += line;
    }
    if (buf) ctx.reply(buf, { parse_mode: 'Markdown' });
    ctx.answerCbQuery?.();
}

bot.action('rep_cem', ctx => report(ctx, CementSeller,    '🧱 ሲሚንቶ ሻጮች', cementCard));
bot.action('rep_trk', ctx => report(ctx, TruckLeasor,     '🚚 ትራክ አከራዮች', truckCard));
bot.action('rep_stl', ctx => report(ctx, SteelSeller,     '🟥 ብረት ሻጮች',   steelCard));
bot.action('rep_mac', ctx => report(ctx, MachineryLeasor, '🔹 ማሽነሪ',       macCard));

bot.action('rep_searches', async ctx => {
    const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(50).lean();
    if (!logs.length) { ctx.answerCbQuery(); return ctx.reply('ምንም ፍለጋ የለም።'); }
    let msg = '📊 *ቅርብ ፍለጋዎች*\n\n';
    logs.forEach((l, i) => { msg += `${i+1}. [${l.category}] ${l.searchedFor} — 📞${l.phone}\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ---- admin delete ----
bot.action('admin_del', ctx => {
    ctx.reply('🗑️ ዘርፍ ይምረጡ:', Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ',  'adel_cem'), Markup.button.callback('🚚 ትራክ',   'adel_trk')],
        [Markup.button.callback('🟥 ብረት',    'adel_stl'), Markup.button.callback('🔹 ማሽነሪ', 'adel_mac')]
    ]));
    ctx.answerCbQuery();
});

async function delMenu(ctx, Model, labelFn, prefix, title) {
    const items = await Model.find({}).lean();
    if (!items.length) { ctx.answerCbQuery(); return ctx.reply('የሚጠፋ የለም።'); }
    ctx.reply(`🗑️ *${title}* — ምርጡ:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(items.map(it => [
            Markup.button.callback(labelFn(it), `adel_do_${prefix}_${it._id}`)
        ]))
    });
    ctx.answerCbQuery();
}

const MMAP = { cem: CementSeller, trk: TruckLeasor, stl: SteelSeller, mac: MachineryLeasor };
bot.action('adel_cem', ctx => delMenu(ctx, CementSeller,    it => `${it.companyName}(${it.phone})`, 'cem', 'ሲሚንቶ'));
bot.action('adel_trk', ctx => delMenu(ctx, TruckLeasor,     it => `${it.plate}(${it.phone})`,       'trk', 'ትራክ'));
bot.action('adel_stl', ctx => delMenu(ctx, SteelSeller,     it => `${it.type}(${it.phone})`,        'stl', 'ብረት'));
bot.action('adel_mac', ctx => delMenu(ctx, MachineryLeasor, it => `${it.type}(${it.phone})`,        'mac', 'ማሽነሪ'));
bot.action(/^adel_do_(cem|trk|stl|mac)_([a-f\d]+)$/i, async ctx => {
    const [, p, id] = ctx.match;
    await MMAP[p].findByIdAndDelete(id);
    ctx.reply('🗑️ ተሰርዟል።'); ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// ═══════  PER-ITEM INLINE ACTIONS  ═══════════════════════
// ──────────────────────────────────────────────────────────

// ─── CEMENT ───────────────────────────────────────────────
bot.action(/^cem_on_([a-f\d]+)$/i, async ctx => {
    const doc = await CementSeller.findByIdAndUpdate(ctx.match[1], { status: 'active' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `✅ *ሁኔታ: አለ (ዝግጁ)*\n\n${cementCard({ ...doc.toObject(), status: 'active' })}`,
        { parse_mode: 'Markdown', ...cementItemKb(doc._id) }
    ).catch(() => ctx.reply(`✅ "${doc.companyName}" — ሁኔታ ወደ አለ ተቀይሯል።`));
    ctx.answerCbQuery('✅ ተቀይሯል');
});

bot.action(/^cem_off_([a-f\d]+)$/i, async ctx => {
    const doc = await CementSeller.findByIdAndUpdate(ctx.match[1], { status: 'off' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `🔴 *ሁኔታ: የለም*\n\n${cementCard({ ...doc.toObject(), status: 'off' })}`,
        { parse_mode: 'Markdown', ...cementItemKb(doc._id) }
    ).catch(() => ctx.reply(`🔴 "${doc.companyName}" — ሁኔታ ወደ የለም ተቀይሯል።`));
    ctx.answerCbQuery('🔴 ተቀይሯል');
});

bot.action(/^cem_price_([a-f\d]+)$/i, ctx => {
    ctx.session.action       = 'UPD_CEM_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን ዋጋ per ኩንታል ያስገቡ (ቁጥር ብቻ):');
    ctx.answerCbQuery();
});

bot.action('cem_add', ctx => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.session.cementData = {};
    ctx.reply('➕ *አዲስ ሲሚንቶ ምዝገባ*\n\n1️⃣ የሲሚንቶ አይነት ያስገቡ (ለምሳሌ: ዳንጎቴ):', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ─── STEEL ────────────────────────────────────────────────
bot.action(/^stl_on_([a-f\d]+)$/i, async ctx => {
    const doc = await SteelSeller.findByIdAndUpdate(ctx.match[1], { status: 'active' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `✅ *ሁኔታ: አለ (ዝግጁ)*\n\n${steelCard({ ...doc.toObject(), status: 'active' })}`,
        { parse_mode: 'Markdown', ...steelItemKb(doc._id) }
    ).catch(() => ctx.reply('✅ ሁኔታ ወደ አለ ተቀይሯል።'));
    ctx.answerCbQuery('✅ ተቀይሯል');
});

bot.action(/^stl_off_([a-f\d]+)$/i, async ctx => {
    const doc = await SteelSeller.findByIdAndUpdate(ctx.match[1], { status: 'off' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `🔴 *ሁኔታ: የለም*\n\n${steelCard({ ...doc.toObject(), status: 'off' })}`,
        { parse_mode: 'Markdown', ...steelItemKb(doc._id) }
    ).catch(() => ctx.reply('🔴 ሁኔታ ወደ የለም ተቀይሯል።'));
    ctx.answerCbQuery('🔴 ተቀይሯል');
});

bot.action(/^stl_price_([a-f\d]+)$/i, ctx => {
    ctx.session.action       = 'UPD_STL_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን የብረት ዋጋ ያስገቡ (ቁጥር ብቻ):');
    ctx.answerCbQuery();
});

bot.action('stl_add', ctx => {
    ctx.session.action = 'REG_STEEL_1';
    ctx.session.steelData = {};
    ctx.reply('➕ *አዲስ ብረት ምዝገባ*\n\n1️⃣ የብረት አይነት ያስገቡ (ለምሳሌ: ባለ 10 ቆርቆሮ):', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ─── MACHINERY ────────────────────────────────────────────
bot.action(/^mac_on_([a-f\d]+)$/i, async ctx => {
    const doc = await MachineryLeasor.findByIdAndUpdate(ctx.match[1], { status: 'active' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `✅ *ሁኔታ: አለ (ዝግጁ)*\n\n${macCard({ ...doc.toObject(), status: 'active' })}`,
        { parse_mode: 'Markdown', ...macItemKb(doc._id) }
    ).catch(() => ctx.reply('✅ ሁኔታ ተቀይሯል።'));
    ctx.answerCbQuery('✅ ተቀይሯል');
});

bot.action(/^mac_off_([a-f\d]+)$/i, async ctx => {
    const doc = await MachineryLeasor.findByIdAndUpdate(ctx.match[1], { status: 'off' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `🔴 *ሁኔታ: የለም*\n\n${macCard({ ...doc.toObject(), status: 'off' })}`,
        { parse_mode: 'Markdown', ...macItemKb(doc._id) }
    ).catch(() => ctx.reply('🔴 ሁኔታ ተቀይሯል።'));
    ctx.answerCbQuery('🔴 ተቀይሯል');
});

bot.action(/^mac_price_([a-f\d]+)$/i, ctx => {
    ctx.session.action       = 'UPD_MAC_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን የማሽነሪ ኪራይ ዋጋ ያስገቡ (ቁጥር ብቻ):');
    ctx.answerCbQuery();
});

bot.action('mac_add', ctx => {
    ctx.session.action = 'REG_MACHINERY_1';
    ctx.session.machineryData = {};
    ctx.reply('➕ *አዲስ ማሽነሪ ምዝገባ*\n\n1️⃣ የማሽነሪ አይነት ያስገቡ (ለምሳሌ: ኤክስካቫተር):', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ─── TRUCK ────────────────────────────────────────────────
bot.action(/^trk_on_([a-f\d]+)$/i, async ctx => {
    const doc = await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'active' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `✅ *ሁኔታ: ዝግጁ*\n\n${truckCard({ ...doc.toObject(), status: 'active' })}`,
        { parse_mode: 'Markdown', ...truckItemKb(doc._id) }
    ).catch(() => ctx.reply('✅ ሁኔታ ወደ ዝግጁ ተቀይሯል።'));
    ctx.answerCbQuery('✅ ዝግጁ');
});

bot.action(/^trk_off_([a-f\d]+)$/i, async ctx => {
    const doc = await TruckLeasor.findByIdAndUpdate(ctx.match[1], { status: 'off' }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    ctx.editMessageText(
        `⏳ *ሁኔታ: ስራ ላይ*\n\n${truckCard({ ...doc.toObject(), status: 'off' })}`,
        { parse_mode: 'Markdown', ...truckItemKb(doc._id) }
    ).catch(() => ctx.reply('⏳ ሁኔታ ወደ ስራ ላይ ተቀይሯል።'));
    ctx.answerCbQuery('⏳ ስራ ላይ');
});

bot.action(/^trk_route_([a-f\d]+)$/i, ctx => {
    ctx.session.action       = 'UPD_TRK_ROUTE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('🗺️ አዲሱን የጉዞ መስመር ያስገቡ (ለምሳሌ: ከአዲስ አበባ ወደ ሀዋሳ):');
    ctx.answerCbQuery();
});

bot.action('trk_add', ctx => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('➕ *አዲስ ትራክ ምዝገባ*\n\n1️⃣ የመኪናውን አይነት ያስገቡ (ለምሳሌ: ሲኖትራክ):', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// MENU TRIGGERS
// ──────────────────────────────────────────────────────────

// ── ሲሚንቶ ለመሸጥ ─────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async ctx => {
    ctx.session.action = null;
    const items = await CementSeller.find({ userId: ctx.from.id }).lean();
    if (!items.length) {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.session.cementData = {};
        return ctx.reply(
            '➕ *አዲስ ሲሚንቶ ምዝገባ*\n\n1️⃣ የሲሚንቶ አይነት ያስገቡ (ለምሳሌ: ዳንጎቴ):',
            { parse_mode: 'Markdown' }
        );
    }
    // Send each item with its own buttons
    await ctx.reply(`📦 *${ctx.from.first_name || 'ተጠቃሚ'} — የሲሚንቶ ዝርዝር*`, { parse_mode: 'Markdown' });
    for (const it of items) {
        await ctx.reply(cementCard(it), { parse_mode: 'Markdown', ...cementItemKb(it._id) });
    }
});

// ── ሲሚንቶ ለመግዛት ────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.session.buyCement = {};
    ctx.reply('🔍 *ሲሚንቶ ፍለጋ*\n\n1️⃣ ምን አይነት ሲሚንቶ ይፈልጋሉ? (ለምሳሌ: ዳንጎቴ)', { parse_mode: 'Markdown' });
});

// ── መኪና ለማከራየት ─────────────────────────────────────────
bot.hears('🚚 መኪና ለማከራየት', async ctx => {
    ctx.session.action = null;
    const items = await TruckLeasor.find({ userId: ctx.from.id }).lean();
    if (!items.length) {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.session.truckData = {};
        return ctx.reply(
            '➕ *አዲስ ትራክ ምዝገባ*\n\n1️⃣ የመኪናውን አይነት ያስገቡ (ለምሳሌ: ሲኖትራክ):',
            { parse_mode: 'Markdown' }
        );
    }
    await ctx.reply(`🚚 *${ctx.from.first_name || 'ተጠቃሚ'} — ትራክ ዝርዝር*`, { parse_mode: 'Markdown' });
    for (const it of items) {
        await ctx.reply(truckCard(it), { parse_mode: 'Markdown', ...truckItemKb(it._id) });
    }
});

// ── መኪና ለመከራየት ─────────────────────────────────────────
bot.hears('🚚 መኪና ለመከራየት', ctx => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.session.rentTruck = {};
    ctx.reply('🔍 *ትራክ ፍለጋ*\n\n1️⃣ ምን አይነት መኪና ይፈልጋሉ? (ለምሳሌ: ሲኖትራክ)', { parse_mode: 'Markdown' });
});

// ── ብረት ለመሸጥ ────────────────────────────────────────────
bot.hears('🟥 ብረት ለመሸጥ', async ctx => {
    ctx.session.action = null;
    const items = await SteelSeller.find({ userId: ctx.from.id }).lean();
    if (!items.length) {
        ctx.session.action = 'REG_STEEL_1';
        ctx.session.steelData = {};
        return ctx.reply(
            '➕ *አዲስ ብረት ምዝገባ*\n\n1️⃣ የብረት አይነት ያስገቡ (ለምሳሌ: ባለ 10 ቆርቆሮ):',
            { parse_mode: 'Markdown' }
        );
    }
    await ctx.reply(`🟥 *${ctx.from.first_name || 'ተጠቃሚ'} — የብረት ዝርዝር*`, { parse_mode: 'Markdown' });
    for (const it of items) {
        await ctx.reply(steelCard(it), { parse_mode: 'Markdown', ...steelItemKb(it._id) });
    }
});

// ── ብረት ለመግዛት ───────────────────────────────────────────
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.session.buySteel = {};
    ctx.reply('🔍 *ብረት ፍለጋ*\n\n1️⃣ ምን አይነት ብረት ይፈልጋሉ?', { parse_mode: 'Markdown' });
});

// ── ማሽነሪ ለማከራየት ────────────────────────────────────────
bot.hears('🔹 ማሽነሪ ለማከራየት', async ctx => {
    ctx.session.action = null;
    const items = await MachineryLeasor.find({ userId: ctx.from.id }).lean();
    if (!items.length) {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.session.machineryData = {};
        return ctx.reply(
            '➕ *አዲስ ማሽነሪ ምዝገባ*\n\n1️⃣ የማሽነሪ አይነት ያስገቡ (ለምሳሌ: ኤክስካቫተር):',
            { parse_mode: 'Markdown' }
        );
    }
    await ctx.reply(`🔹 *${ctx.from.first_name || 'ተጠቃሚ'} — ማሽነሪ ዝርዝር*`, { parse_mode: 'Markdown' });
    for (const it of items) {
        await ctx.reply(macCard(it), { parse_mode: 'Markdown', ...macItemKb(it._id) });
    }
});

// ── ማሽነሪ ለመከራየት ────────────────────────────────────────
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.session.rentMachinery = {};
    ctx.reply('🔍 *ማሽነሪ ፍለጋ*\n\n1️⃣ ምን አይነት ማሽነሪ ይፈልጋሉ?', { parse_mode: 'Markdown' });
});

// ──────────────────────────────────────────────────────────
// TEXT STATE MACHINE
// ──────────────────────────────────────────────────────────
bot.on('text', async (ctx, next) => {
    const text   = ctx.message.text.trim();
    if (text.startsWith('/')) return next();
    const action = ctx.session?.action;
    if (!action) return;
    const uid    = ctx.from.id;

    try {
        // ═══ CEMENT REGISTRATION ═══════════════════════════════
        if (action === 'REG_CEMENT_1') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return ctx.reply('2️⃣ ያለበት ቦታ ያስገቡ (ለምሳሌ: አዲስ አበባ):');
        }
        if (action === 'REG_CEMENT_2') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return ctx.reply('3️⃣ የድርጅቱ ስም ያስገቡ:');
        }
        if (action === 'REG_CEMENT_3') {
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            return ctx.reply('4️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_CEMENT_4') {
            ctx.session.cementData.phone = text;
            ctx.session.action = 'REG_CEMENT_5';
            return ctx.reply('5️⃣ ዋጋ per ኩንታል ያስገቡ (ቁጥር ብቻ, ለምሳሌ: 650):');
        }
        if (action === 'REG_CEMENT_5') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const data = { ...ctx.session.cementData, userId: uid, price, status: 'active' };
            const doc  = await CementSeller.create(data);
            ctx.session.action = null;
            ctx.session.cementData = {};
            await ctx.reply('🎉 *ሲሚንቶ ምዝገባ ተሳክቷል!*', { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject()), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ═══ UPDATE CEMENT PRICE (per-item) ════════════════════
        if (action === 'UPD_CEM_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await CementSeller.findByIdAndUpdate(
                ctx.session.targetItemId, { price }, { new: true }
            );
            ctx.session.action = null;
            ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ መረጃ አልተገኘም።');
            await ctx.reply(`✅ *ዋጋ ወደ ${fmt(price)} ብር/ኩንታል ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject()), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ═══ BUY CEMENT ════════════════════════════════════════
        if (action === 'BUY_CEMENT_1') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            return ctx.reply('2️⃣ ሲሚንቶ የሚፈልጉበት ቦታ ያስገቡ:');
        }
        if (action === 'BUY_CEMENT_2') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'BUY_CEMENT_3') {
            const { type, location } = ctx.session.buyCement;
            logSearch(ctx, 'ሲሚንቶ ፈላጊ', `${type} | ${location}`, text);
            const results = await CementSeller.find({
                type: searchRx(type), location: searchRx(location), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();
            if (results.length) {
                await ctx.reply(`🎉 *${results.length} ሻጭ ተገኝቷል!*`, { parse_mode: 'Markdown' });
                for (const r of results) await ctx.reply(cementCard(r), { parse_mode: 'Markdown' });
                ctx.reply(`\n📞 ለማዘዝ: *${SUPPORT_PHONE}*`, { parse_mode: 'Markdown' });
            } else {
                ctx.reply(`😔 ይቅርታ! ለጊዜው አይገኝም።\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null; ctx.session.buyCement = {};
            return;
        }

        // ═══ TRUCK REGISTRATION ════════════════════════════════
        if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            return ctx.reply('2️⃣ ታርጋ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text.toUpperCase();
            ctx.session.action = 'REG_TRUCK_3';
            return ctx.reply('3️⃣ የጉዞ መስመር ያስገቡ (ለምሳሌ: ከ አ.አ ወደ ሀዋሳ):');
        }
        if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            return ctx.reply('4️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = text;
            const data = { ...ctx.session.truckData, userId: uid, status: 'active' };
            const doc  = await TruckLeasor.create(data);
            ctx.session.action = null; ctx.session.truckData = {};
            await ctx.reply('🎉 *ትራክ ምዝገባ ተሳክቷል!*', { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject()), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ═══ UPDATE TRUCK ROUTE ════════════════════════════════
        if (action === 'UPD_TRK_ROUTE') {
            const doc = await TruckLeasor.findByIdAndUpdate(
                ctx.session.targetItemId, { route: text }, { new: true }
            );
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ *መስመር ወደ "${text}" ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject()), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ═══ RENT TRUCK ════════════════════════════════════════
        if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            return ctx.reply('2️⃣ ጉዞ ከየት ወደ የት? (ለምሳሌ: ከ አ.አ ወደ ሀዋሳ):');
        }
        if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'RENT_TRUCK_3') {
            const { type, route } = ctx.session.rentTruck;
            logSearch(ctx, 'ትራክ ፈላጊ', `${type} | ${route}`, text);
            const found = await TruckLeasor.findOne({
                type: searchRx(type), route: searchRx(route), status: 'active'
            }).sort({ rentedCount: 1 });
            if (found) {
                await ctx.reply('✅ *ትራክ ተገኝቷል!*', { parse_mode: 'Markdown' });
                await ctx.reply(truckCard(found.toObject()), { parse_mode: 'Markdown' });
                ctx.reply(`📞 ለማዘዝ: *${SUPPORT_PHONE}*`, { parse_mode: 'Markdown' });
                TruckLeasor.findByIdAndUpdate(found._id, { $inc: { rentedCount: 1 } }).catch(() => {});
            } else {
                ctx.reply(`😔 ይቅርታ! ለጊዜው አይገኝም።\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null; ctx.session.rentTruck = {};
            return;
        }

        // ═══ STEEL REGISTRATION ════════════════════════════════
        if (action === 'REG_STEEL_1') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return ctx.reply('2️⃣ አድራሻ ያስገቡ:');
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return ctx.reply('3️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = text;
            ctx.session.action = 'REG_STEEL_4';
            return ctx.reply('4️⃣ ዋጋ ያስገቡ (ቁጥር ብቻ, ብር):');
        }
        if (action === 'REG_STEEL_4') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const data = { ...ctx.session.steelData, userId: uid, price, status: 'active' };
            const doc  = await SteelSeller.create(data);
            ctx.session.action = null; ctx.session.steelData = {};
            await ctx.reply('🎉 *ብረት ምዝገባ ተሳክቷል!*', { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject()), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ═══ UPDATE STEEL PRICE ════════════════════════════════
        if (action === 'UPD_STL_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await SteelSeller.findByIdAndUpdate(
                ctx.session.targetItemId, { price }, { new: true }
            );
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ *ዋጋ ወደ ${fmt(price)} ብር ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject()), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ═══ BUY STEEL ═════════════════════════════════════════
        if (action === 'BUY_STEEL_1') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            return ctx.reply('2️⃣ ብረት የሚፈልጉበት ቦታ ያስገቡ:');
        }
        if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel.location = text;
            ctx.session.action = 'BUY_STEEL_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'BUY_STEEL_3') {
            logSearch(ctx, 'ብረት ፈላጊ', ctx.session.buySteel.type, text);
            const results = await SteelSeller.find({
                type: searchRx(ctx.session.buySteel.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();
            if (results.length) {
                await ctx.reply(`🎉 *${results.length} ሻጭ ተገኝቷል!*`, { parse_mode: 'Markdown' });
                for (const r of results) await ctx.reply(steelCard(r), { parse_mode: 'Markdown' });
                ctx.reply(`📞 ለማዘዝ: *${SUPPORT_PHONE}*`, { parse_mode: 'Markdown' });
            } else {
                ctx.reply(`😔 ይቅርታ! ለዛሬ የለም።\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null; ctx.session.buySteel = {};
            return;
        }

        // ═══ MACHINERY REGISTRATION ════════════════════════════
        if (action === 'REG_MACHINERY_1') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return ctx.reply('2️⃣ አድራሻ ያስገቡ:');
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return ctx.reply('3️⃣ ስልክ ቁጥር ያስገቡ:');
        }
        if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData.phone = text;
            ctx.session.action = 'REG_MACHINERY_4';
            return ctx.reply('4️⃣ ኪራይ ዋጋ ያስገቡ (ቁጥር ብቻ, ብር):');
        }
        if (action === 'REG_MACHINERY_4') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const data = { ...ctx.session.machineryData, userId: uid, price, status: 'active' };
            const doc  = await MachineryLeasor.create(data);
            ctx.session.action = null; ctx.session.machineryData = {};
            await ctx.reply('🎉 *ማሽነሪ ምዝገባ ተሳክቷል!*', { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject()), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ═══ UPDATE MACHINERY PRICE ════════════════════════════
        if (action === 'UPD_MAC_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await MachineryLeasor.findByIdAndUpdate(
                ctx.session.targetItemId, { price }, { new: true }
            );
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ *ዋጋ ወደ ${fmt(price)} ብር ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject()), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ═══ RENT MACHINERY ════════════════════════════════════
        if (action === 'RENT_MACHINERY_1') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            return ctx.reply('2️⃣ ማሽነሪ የሚፈልጉበት ቦታ ያስገቡ:');
        }
        if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            return ctx.reply('3️⃣ ስልክ ቁጥርዎን ያስገቡ:');
        }
        if (action === 'RENT_MACHINERY_3') {
            logSearch(ctx, 'ማሽነሪ ፈላጊ', ctx.session.rentMachinery.type, text);
            const results = await MachineryLeasor.find({
                type: searchRx(ctx.session.rentMachinery.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();
            if (results.length) {
                await ctx.reply(`🎉 *${results.length} ማሽነሪ ተገኝቷል!*`, { parse_mode: 'Markdown' });
                for (const r of results) await ctx.reply(macCard(r), { parse_mode: 'Markdown' });
                ctx.reply(`📞 ለማዘዝ: *${SUPPORT_PHONE}*`, { parse_mode: 'Markdown' });
            } else {
                ctx.reply(`😔 ይቅርታ! ለዛሬ የለም።\n📞 ${SUPPORT_PHONE}`);
            }
            ctx.session.action = null; ctx.session.rentMachinery = {};
            return;
        }

    } catch (err) {
        console.error('Handler error:', err);
        ctx.reply('⚠️ ስህተት አጋጥሟል። እባክዎ እንደገና ይሞክሩ።').catch(() => {});
    }
});

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR
// ──────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Bot error [${ctx?.updateType}]:`, err);
    ctx?.reply?.('⚠️ ያልተጠበቀ ስህተት።').catch(() => {});
});
process.on('uncaughtException',  e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('REJECTION:', e));

// ──────────────────────────────────────────────────────────
// HTTP + KEEP-ALIVE
// ──────────────────────────────────────────────────────────
http.createServer((_, res) => {
    res.writeHead(200); res.end('Simple Bot OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP :${PORT}`));

if (RENDER_URL) {
    const base = RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`;
    setInterval(() => {
        http.get(base, r => console.log(`⏱️ ping ${r.statusCode}`))
            .on('error', e => console.warn('ping err:', e.message));
    }, 14 * 60 * 1000);
    console.log(`🔄 Keep-alive → ${base}`);
}

// ──────────────────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────────────────
bot.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
})
.then(() => console.log('🤖 Bot launched!'))
.catch(err => { console.error('Launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
