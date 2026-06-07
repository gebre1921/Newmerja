'use strict';

// ╔══════════════════════════════════════════════════════════════╗
// ║          Simple Marketplace Bot  v5.0  ✨                   ║
// ║      ሲሚንቶ  ·  ብረት  ·  ማሽነሪ  ·  ትራክ                        ║
// ╚══════════════════════════════════════════════════════════════╝

const { Telegraf, Markup } = require('telegraf');
const http     = require('http');
const mongoose = require('mongoose');

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

if (!BOT_TOKEN || !MONGO_URI) {
    console.error('❌  BOT_TOKEN ወይም MONGO_URI አልተገኘም!');
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
    price:       { type: Number, default: 0 },
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
        console.log('✅  MongoDB Connected');
    } catch (err) {
        console.error('❌  MongoDB failed:', err.message);
        setTimeout(connectMongo, 5000);
    }
}
mongoose.connection.on('disconnected', () => setTimeout(connectMongo, 3000));
mongoose.connection.on('error', err => console.error('Mongo:', err));
connectMongo();

// ──────────────────────────────────────────────────────────
// BOT + SESSION (LRU in-memory cache)
// ──────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN, {
    handlerTimeout: 90_000,
    telegram: { webhookReply: false }
});

const sessionCache = new Map();
function lruSet(k, v) {
    if (sessionCache.size >= 5000 && !sessionCache.has(k))
        sessionCache.delete(sessionCache.keys().next().value);
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
// UTILITIES
// ──────────────────────────────────────────────────────────
const isAdmin = ctx => ADMIN_IDS.includes(ctx.from?.id);
const fmt     = n   => Number(n).toLocaleString('en');
function esc(s) { return String(s || '').replace(/([*_`[])/g, '\\$1'); }

function searchRx(s) {
    if (!s) return new RegExp('', 'i');
    const c = s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return /[a-zA-Z]/.test(c) ? new RegExp(c.split('').join('.*'), 'i') : new RegExp(c, 'i');
}
function logSearch(ctx, category, searchedFor, phone) {
    SearchLog.create({ userId: ctx.from.id, username: ctx.from.username || 'N/A',
        category, searchedFor, phone }).catch(() => {});
}

// ──────────────────────────────────────────────────────────
// CARD FORMATTERS  ✨ Beautiful, clean, scannable
// ──────────────────────────────────────────────────────────

// ─── STATUS BADGE ──────────────────────────────────────────
// For buyer/user view — clean and friendly
function statusBadge(status) {
    return status === 'active'
        ? '🟢  *አለ — ዝግጁ*'
        : '🔴  *የለም — ለጊዜው አይሸጥም*';
}
function truckStatusBadge(status) {
    return status === 'active'
        ? '🟢  *ዝግጁ — መከራየት ይቻላል*'
        : '⏳  *ስራ ላይ — ለጊዜው አይቻልም*';
}

// ─── ADMIN STATUS BADGE — bold, high-contrast ─────────────
function adminStatusBadge(status) {
    return status === 'active'
        ? '╔══════════════════╗\n║  ✅  A L E  —  Z I G J U  ║\n╚══════════════════╝'
        : '╔══════════════════╗\n║  ❌  Y E L E M  —  L E G I Z E  ║\n╚══════════════════╝';
}
function adminTruckStatusBadge(status) {
    return status === 'active'
        ? '╔══════════════════╗\n║  ✅  Z I G J U  —  A Y C H I L M  ║\n╚══════════════════╝'
        : '╔══════════════════╗\n║  ⏳  S I R A   L A Y  ║\n╚══════════════════╝';
}

// ─── USER CARDS (buyer view) ───────────────────────────────
function cementCard(it, adminView = false) {
    const status = adminView ? adminStatusBadge(it.status) : statusBadge(it.status);
    return (
        `╭──────────────────────╮\n` +
        `│  🧱  *${esc(it.companyName || it.type)}*\n` +
        `╰──────────────────────╯\n` +
        `▸ አይነት   ፦  ${esc(it.type)}\n` +
        `▸ 📍 ቦታ   ፦  ${esc(it.location)}\n` +
        `▸ 📞 ስልክ  ፦  \`${esc(it.phone)}\`\n` +
        `▸ 💰 ዋጋ   ፦  *${fmt(it.price)} ብር / ኩንታል*\n` +
        `▸ ሁኔታ    ፦  ${status}`
    );
}

function steelCard(it, adminView = false) {
    const status = adminView ? adminStatusBadge(it.status) : statusBadge(it.status);
    return (
        `╭──────────────────────╮\n` +
        `│  🟥  *${esc(it.type)}*\n` +
        `╰──────────────────────╯\n` +
        `▸ 📍 አድራሻ ፦  ${esc(it.address)}\n` +
        `▸ 📞 ስልክ  ፦  \`${esc(it.phone)}\`\n` +
        `▸ 💰 ዋጋ   ፦  *${fmt(it.price)} ብር*\n` +
        `▸ ሁኔታ    ፦  ${status}`
    );
}

function macCard(it, adminView = false) {
    const status = adminView ? adminStatusBadge(it.status) : statusBadge(it.status);
    return (
        `╭──────────────────────╮\n` +
        `│  🔹  *${esc(it.type)}*\n` +
        `╰──────────────────────╯\n` +
        `▸ 📍 አድራሻ ፦  ${esc(it.address)}\n` +
        `▸ 📞 ስልክ  ፦  \`${esc(it.phone)}\`\n` +
        `▸ 💰 ኪራይ  ፦  *${fmt(it.price)} ብር*\n` +
        `▸ ሁኔታ    ፦  ${status}`
    );
}

function truckCard(it, adminView = false) {
    const status = adminView ? adminTruckStatusBadge(it.status) : truckStatusBadge(it.status);
    return (
        `╭──────────────────────╮\n` +
        `│  🚚  *${esc(it.type)}*\n` +
        `╰──────────────────────╯\n` +
        `▸ 🚗 ታርጋ   ፦  ${esc(it.plate)}\n` +
        `▸ 🛣️ መስመር  ፦  ${esc(it.route)}\n` +
        `▸ 📞 ስልክ   ፦  \`${esc(it.phone)}\`\n` +
        `▸ ሁኔታ     ፦  ${status}`
    );
}

// ──────────────────────────────────────────────────────────
// PER-ITEM KEYBOARDS
// ──────────────────────────────────────────────────────────
const cementItemKb  = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅  አለ — ዝግጁ',   `cem_on_${id}`),
     Markup.button.callback('❌  የለም',         `cem_off_${id}`)],
    [Markup.button.callback('💰  ዋጋ ቀይር',     `cem_price_${id}`),
     Markup.button.callback('➕  ሌላ ጨምር',     'cem_add')]
]);

const steelItemKb   = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅  አለ — ዝግጁ',   `stl_on_${id}`),
     Markup.button.callback('❌  የለም',         `stl_off_${id}`)],
    [Markup.button.callback('💰  ዋጋ ቀይር',     `stl_price_${id}`),
     Markup.button.callback('➕  ሌላ ጨምር',     'stl_add')]
]);

const macItemKb     = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅  አለ — ዝግጁ',   `mac_on_${id}`),
     Markup.button.callback('❌  የለም',         `mac_off_${id}`)],
    [Markup.button.callback('💰  ዋጋ ቀይር',     `mac_price_${id}`),
     Markup.button.callback('➕  ሌላ ጨምር',     'mac_add')]
]);

const truckItemKb   = id => Markup.inlineKeyboard([
    [Markup.button.callback('✅  ዝግጁ',         `trk_on_${id}`),
     Markup.button.callback('⏳  ስራ ላይ',      `trk_off_${id}`)],
    [Markup.button.callback('🗺️  መስመር ቀይር',   `trk_route_${id}`),
     Markup.button.callback('➕  ሌላ ጨምር',     'trk_add')]
]);

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
// START
// ──────────────────────────────────────────────────────────
bot.start(ctx => {
    ctx.session = {};
    const name = ctx.from.first_name || 'ጎብኚ';
    ctx.reply(
        `👋 *ሰላም ${esc(name)}!*\n\n` +
        `🏗️ *Simple Marketplace Bot* へ እንኳን ደህና መጡ!\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `እዚህ ቦት ላይ ማድረግ የሚችሉት:\n\n` +
        `🧱  ሲሚንቶ  — *መሸጥ / መግዛት*\n` +
        `🟥  ብረት    — *መሸጥ / መግዛት*\n` +
        `🔹  ማሽነሪ  — *ማከራየት / መከራየት*\n` +
        `🚚  ትራክ   — *ማከራየት / መከራየት*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `👇 *ከታቹ አንዱን ይምረጡ ➜*`,
        { parse_mode: 'Markdown', ...mainKb }
    );
});

// ──────────────────────────────────────────────────────────
// ADMIN PANEL
// ──────────────────────────────────────────────────────────
bot.command('admin_panel', async ctx => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ ፈቃድ የለዎትም!');
    ctx.reply(
        `🔧 *አድሚን ፓናል*\n━━━━━━━━━━━━━━━━━━━━━\nዘርፍ ይምረጡ:`,
        { parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ ሪፖርት',  'rep_cem'),
             Markup.button.callback('🚚 ትራክ ሪፖርት',   'rep_trk')],
            [Markup.button.callback('🟥 ብረት ሪፖርት',   'rep_stl'),
             Markup.button.callback('🔹 ማሽነሪ ሪፖርት', 'rep_mac')],
            [Markup.button.callback('📊 የፍለጋ ሪፖርት', 'rep_searches')],
            [Markup.button.callback('🗑️ ማጥፊያ ፓናል',  'admin_del')]
          ])
        }
    );
});

// ─── Admin report — each item its own message with clear status badge ─────
async function adminReport(ctx, Model, title, cardFn, itemKb) {
    await ctx.answerCbQuery?.();
    const items = await Model.find({}).sort({ status: -1, createdAt: -1 }).lean();
    if (!items.length) {
        return ctx.reply(`📭 *${title}*\n\nምንም ምዝገባ አልተገኘም።`, { parse_mode: 'Markdown' });
    }

    const activeCount  = items.filter(i => i.status === 'active').length;
    const offCount     = items.length - activeCount;

    await ctx.reply(
        `📋 *${title}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 ጠቅላላ፦ *${items.length}*   ` +
        `✅ አለ፦ *${activeCount}*   ` +
        `❌ የለም፦ *${offCount}*`,
        { parse_mode: 'Markdown' }
    );

    for (const it of items) {
        // Pass adminView=true so card shows bold status banner
        await ctx.reply(cardFn(it, true), { parse_mode: 'Markdown', ...itemKb(it._id) });
    }
}

bot.action('rep_cem', ctx => adminReport(ctx, CementSeller,    '🧱 ሲሚንቶ ሻጮች',  cementCard, cementItemKb));
bot.action('rep_trk', ctx => adminReport(ctx, TruckLeasor,     '🚚 ትራክ አከራዮች', truckCard,  truckItemKb));
bot.action('rep_stl', ctx => adminReport(ctx, SteelSeller,     '🟥 ብረት ሻጮች',   steelCard,  steelItemKb));
bot.action('rep_mac', ctx => adminReport(ctx, MachineryLeasor, '🔹 ማሽነሪ',       macCard,    macItemKb));

// ─── Search logs report — clean separate cards, no clutter ───────────────
bot.action('rep_searches', async ctx => {
    await ctx.answerCbQuery();
    const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(60).lean();
    if (!logs.length) return ctx.reply('📭 ምንም የፍለጋ ታሪክ አልተገኘም።');

    // Group by category
    const groups = {};
    for (const l of logs) {
        (groups[l.category] = groups[l.category] || []).push(l);
    }

    await ctx.reply(
        `📊 *የፈላጊዎች ሪፖርት*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔢 ጠቅላላ ፍለጋ፦ *${logs.length}*`,
        { parse_mode: 'Markdown' }
    );

    for (const [cat, entries] of Object.entries(groups)) {
        // Header per category
        await ctx.reply(
            `${cat}\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n` +
            `📈 ቁጥር፦ *${entries.length} ፍለጋ*`,
            { parse_mode: 'Markdown' }
        );

        // Each entry as a clean standalone card
        for (const e of entries) {
            const d       = new Date(e.createdAt);
            const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
            const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const uname   = e.username && e.username !== 'N/A' ? `@${e.username}` : '—';

            await ctx.reply(
                `╭─────────────────────╮\n` +
                `│  🔍  *${esc(e.searchedFor)}*\n` +
                `╰─────────────────────╯\n` +
                `▸ 📞 ደዋይ    ፦  \`${esc(e.phone)}\`\n` +
                `▸ 👤 ስም     ፦  ${esc(uname)}\n` +
                `▸ 📅 ቀን     ፦  ${dateStr}  🕐 ${timeStr}`,
                { parse_mode: 'Markdown' }
            );
        }
    }
});

// ─── Admin delete ──────────────────────────────────────────
bot.action('admin_del', ctx => {
    ctx.reply('🗑️ *ማጥፊያ ፓናል* — ዘርፍ ይምረጡ:', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🧱 ሲሚንቶ',  'adel_cem'),
             Markup.button.callback('🚚 ትራክ',   'adel_trk')],
            [Markup.button.callback('🟥 ብረት',   'adel_stl'),
             Markup.button.callback('🔹 ማሽነሪ',  'adel_mac')]
        ])
    });
    ctx.answerCbQuery();
});

const MMAP = { cem: CementSeller, trk: TruckLeasor, stl: SteelSeller, mac: MachineryLeasor };

async function delMenu(ctx, Model, labelFn, prefix, title) {
    await ctx.answerCbQuery();
    const items = await Model.find({}).lean();
    if (!items.length) return ctx.reply('📭 የሚጠፋ ምዝገባ የለም።');
    ctx.reply(`🗑️ *${title}* — የሚያጠፉትን ይምረጡ:`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(items.map(it => [
            Markup.button.callback(`🗑️ ${labelFn(it)}`, `adel_do_${prefix}_${it._id}`)
        ]))
    });
}

bot.action('adel_cem', ctx => delMenu(ctx, CementSeller,    it => `${it.companyName} (${it.phone})`, 'cem', 'ሲሚንቶ'));
bot.action('adel_trk', ctx => delMenu(ctx, TruckLeasor,     it => `${it.plate} (${it.phone})`,       'trk', 'ትራክ'));
bot.action('adel_stl', ctx => delMenu(ctx, SteelSeller,     it => `${it.type} (${it.phone})`,        'stl', 'ብረት'));
bot.action('adel_mac', ctx => delMenu(ctx, MachineryLeasor, it => `${it.type} (${it.phone})`,        'mac', 'ማሽነሪ'));

bot.action(/^adel_do_(cem|trk|stl|mac)_([a-f\d]+)$/i, async ctx => {
    const [, p, id] = ctx.match;
    await MMAP[p].findByIdAndDelete(id);
    ctx.reply('✅ ምዝገባው ከዳታቤዝ ተሰርዟል።');
    ctx.answerCbQuery('🗑️ ተሰርዟል');
});

// ──────────────────────────────────────────────────────────
// PER-ITEM ACTIONS — STATUS TOGGLE & PRICE/ROUTE UPDATE
// ──────────────────────────────────────────────────────────
async function toggleItem(ctx, Model, id, newStatus, cardFn, kb) {
    const doc = await Model.findByIdAndUpdate(id, { status: newStatus }, { new: true });
    if (!doc) { ctx.answerCbQuery('❗ አልተገኘም'); return; }
    const label = newStatus === 'active' ? '✅ ወደ "አለ" ተቀይሯል!' : '🔴 ወደ "የለም" ተቀይሯል!';
    ctx.editMessageText(cardFn(doc.toObject(), true), { parse_mode: 'Markdown', ...kb(doc._id) })
       .catch(() => ctx.reply(cardFn(doc.toObject(), true), { parse_mode: 'Markdown', ...kb(doc._id) }));
    ctx.answerCbQuery(label);
}

// ─── CEMENT ────────────────────────────────────────────────
bot.action(/^cem_on_([a-f\d]+)$/i,  ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'active', cementCard, cementItemKb));
bot.action(/^cem_off_([a-f\d]+)$/i, ctx => toggleItem(ctx, CementSeller, ctx.match[1], 'off',    cementCard, cementItemKb));

bot.action(/^cem_price_([a-f\d]+)$/i, ctx => {
    ctx.session.action = 'UPD_CEM_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን ዋጋ ያስገቡ _(per ኩንታል, ቁጥር ብቻ — ለምሳሌ: 680)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('cem_add', ctx => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.session.cementData = {};
    ctx.reply('➕ *አዲስ ሲሚንቶ ምዝገባ*\n\n`[1/5]` 🧱 የሲሚንቶ አይነት ያስገቡ _(ለምሳሌ: ዳንጎቴ, ድሬ)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ─── STEEL ─────────────────────────────────────────────────
bot.action(/^stl_on_([a-f\d]+)$/i,  ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'active', steelCard, steelItemKb));
bot.action(/^stl_off_([a-f\d]+)$/i, ctx => toggleItem(ctx, SteelSeller, ctx.match[1], 'off',    steelCard, steelItemKb));

bot.action(/^stl_price_([a-f\d]+)$/i, ctx => {
    ctx.session.action = 'UPD_STL_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን የብረት ዋጋ ያስገቡ _(ቁጥር ብቻ, ብር)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('stl_add', ctx => {
    ctx.session.action = 'REG_STEEL_1';
    ctx.session.steelData = {};
    ctx.reply('➕ *አዲስ ብረት ምዝገባ*\n\n`[1/4]` 🟥 የብረት አይነት ያስገቡ _(ለምሳሌ: ባለ 10 ቆርቆሮ)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ─── MACHINERY ─────────────────────────────────────────────
bot.action(/^mac_on_([a-f\d]+)$/i,  ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'active', macCard, macItemKb));
bot.action(/^mac_off_([a-f\d]+)$/i, ctx => toggleItem(ctx, MachineryLeasor, ctx.match[1], 'off',    macCard, macItemKb));

bot.action(/^mac_price_([a-f\d]+)$/i, ctx => {
    ctx.session.action = 'UPD_MAC_PRICE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('💰 አዲሱን ኪራይ ዋጋ ያስገቡ _(ቁጥር ብቻ, ብር)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('mac_add', ctx => {
    ctx.session.action = 'REG_MACHINERY_1';
    ctx.session.machineryData = {};
    ctx.reply('➕ *አዲስ ማሽነሪ ምዝገባ*\n\n`[1/4]` 🔹 የማሽነሪ አይነት ያስገቡ _(ለምሳሌ: ኤክስካቫተር, ቡልዶዘር)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ─── TRUCK ─────────────────────────────────────────────────
bot.action(/^trk_on_([a-f\d]+)$/i,  ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'active', truckCard, truckItemKb));
bot.action(/^trk_off_([a-f\d]+)$/i, ctx => toggleItem(ctx, TruckLeasor, ctx.match[1], 'off',    truckCard, truckItemKb));

bot.action(/^trk_route_([a-f\d]+)$/i, ctx => {
    ctx.session.action = 'UPD_TRK_ROUTE';
    ctx.session.targetItemId = ctx.match[1];
    ctx.reply('🗺️ አዲሱን የጉዞ መስመር ያስገቡ _(ለምሳሌ: ከ አ.አ ወደ ሀዋሳ)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});
bot.action('trk_add', ctx => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('➕ *አዲስ ትራክ ምዝገባ*\n\n`[1/4]` 🚚 የመኪናውን አይነት ያስገቡ _(ለምሳሌ: ሲኖትራክ, ፎው)_:', { parse_mode: 'Markdown' });
    ctx.answerCbQuery();
});

// ──────────────────────────────────────────────────────────
// MENU HEARS — seller/lessor dashboard
// ──────────────────────────────────────────────────────────
async function openDashboard(ctx, Model, cardFn, kb, emptyAction, emptySession, emptyMsg, firstStepText) {
    ctx.session.action = null;
    const items = await Model.find({ userId: ctx.from.id }).sort({ createdAt: -1 }).lean();
    if (!items.length) {
        ctx.session.action        = emptyAction;
        ctx.session[emptySession] = {};
        return ctx.reply(
            `📋 *${emptyMsg}*\n\n` +
            `እስካሁን ምዝገባ አልተገኘም።\n` +
            `አሁን እንጀምር! 👇\n\n` +
            `\`[1]\` ${firstStepText}`,
            { parse_mode: 'Markdown' }
        );
    }
    const name = esc(ctx.from.first_name || 'ተጠቃሚ');
    await ctx.reply(
        `👤 *${name} — የእርስዎ ምዝገባዎች*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 ጠቅላላ፦ *${items.length}* ምዝገባ\n\n` +
        `ሁኔታ ለመቀየር ወይም ዋጋ ለማሻሻል ከታቹ ያለውን ✅/❌ button ይጠቀሙ 👇`,
        { parse_mode: 'Markdown' }
    );
    for (const it of items) {
        // Show normal (non-admin) card + management buttons
        await ctx.reply(cardFn(it, false), { parse_mode: 'Markdown', ...kb(it._id) });
    }
}

bot.hears('🧱 ሲሚንቶ ለመሸጥ',    ctx => openDashboard(ctx, CementSeller,    cementCard, cementItemKb, 'REG_CEMENT_1',    'cementData',    'ሲሚንቶ ምዝገባ',    '🧱 የሲሚንቶ አይነት ያስገቡ (ለምሳሌ: ዳንጎቴ):'));
bot.hears('🟥 ብረት ለመሸጥ',     ctx => openDashboard(ctx, SteelSeller,     steelCard,  steelItemKb,  'REG_STEEL_1',     'steelData',     'ብረት ምዝገባ',      '🟥 የብረት አይነት ያስገቡ (ለምሳሌ: ባለ 10 ቆርቆሮ):'));
bot.hears('🔹 ማሽነሪ ለማከራየት', ctx => openDashboard(ctx, MachineryLeasor, macCard,    macItemKb,    'REG_MACHINERY_1', 'machineryData', 'ማሽነሪ ምዝገባ',    '🔹 የማሽነሪ አይነት ያስገቡ (ለምሳሌ: ኤክስካቫተር):'));
bot.hears('🚚 መኪና ለማከራየት',   ctx => openDashboard(ctx, TruckLeasor,     truckCard,  truckItemKb,  'REG_TRUCK_1',     'truckData',     'ትራክ ምዝገባ',      '🚚 የመኪናውን አይነት ያስገቡ (ለምሳሌ: ሲኖትራክ):'));

// ──────────────────────────────────────────────────────────
// MENU HEARS — buyer/renter search
// ──────────────────────────────────────────────────────────
bot.hears('🧱 ሲሚንቶ ለመግዛት', ctx => {
    ctx.session.action = 'BUY_CEMENT_1'; ctx.session.buyCement = {};
    ctx.reply(
        `🔍 *ሲሚንቶ ፍለጋ*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`[1/3]\` 🧱 ምን አይነት ሲሚንቶ ይፈልጋሉ?\n` +
        `_ለምሳሌ: ዳንጎቴ, ድሬ, ናሽናል_`,
        { parse_mode: 'Markdown' }
    );
});
bot.hears('🟥 ብረት ለመግዛት', ctx => {
    ctx.session.action = 'BUY_STEEL_1'; ctx.session.buySteel = {};
    ctx.reply(
        `🔍 *ብረት ፍለጋ*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`[1/3]\` 🟥 ምን አይነት ብረት ይፈልጋሉ?\n` +
        `_ለምሳሌ: ባለ 10 ቆርቆሮ, ባለ 8_`,
        { parse_mode: 'Markdown' }
    );
});
bot.hears('🔹 ማሽነሪ ለመከራየት', ctx => {
    ctx.session.action = 'RENT_MACHINERY_1'; ctx.session.rentMachinery = {};
    ctx.reply(
        `🔍 *ማሽነሪ ፍለጋ*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`[1/3]\` 🔹 ምን አይነት ማሽነሪ ይፈልጋሉ?\n` +
        `_ለምሳሌ: ኤክስካቫተር, ቡልዶዘር, ሞጦ ጂሬደር_`,
        { parse_mode: 'Markdown' }
    );
});
bot.hears('🚚 መኪና ለመከራየት', ctx => {
    ctx.session.action = 'RENT_TRUCK_1'; ctx.session.rentTruck = {};
    ctx.reply(
        `🔍 *ትራክ ፍለጋ*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `\`[1/3]\` 🚚 ምን አይነት መኪና ይፈልጋሉ?\n` +
        `_ለምሳሌ: ሲኖትራክ, ፎው, ኢሱዙ_`,
        { parse_mode: 'Markdown' }
    );
});

// ──────────────────────────────────────────────────────────
// TEXT STATE MACHINE
// ──────────────────────────────────────────────────────────
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();
    const action = ctx.session?.action;
    if (!action) return;
    const uid = ctx.from.id;

    // Step progress bar helper
    const step = (cur, total, label) =>
        `\`[${cur}/${total}]\` ${label}`;

    try {
        // ══════════════════════════════════════════════════
        // CEMENT REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_CEMENT_1') {
            ctx.session.cementData = { type: text };
            ctx.session.action = 'REG_CEMENT_2';
            return ctx.reply(step(2, 5, '📍 ያለበት ቦታ ያስገቡ _(ለምሳሌ: አዲስ አበባ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_2') {
            ctx.session.cementData.location = text;
            ctx.session.action = 'REG_CEMENT_3';
            return ctx.reply(step(3, 5, '🏭 የድርጅቱ ስም ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_3') {
            ctx.session.cementData.companyName = text;
            ctx.session.action = 'REG_CEMENT_4';
            return ctx.reply(step(4, 5, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_4') {
            ctx.session.cementData.phone = text;
            ctx.session.action = 'REG_CEMENT_5';
            return ctx.reply(step(5, 5, '💰 ዋጋ per ኩንታል ያስገቡ _(ቁጥር ብቻ — ለምሳሌ: 650)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_CEMENT_5') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0)
                return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ _(ለምሳሌ: 650)_:', { parse_mode: 'Markdown' });
            const doc = await CementSeller.create({ ...ctx.session.cementData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.cementData = {};
            await ctx.reply(
                `🎉 *ምዝገባ ተሳክቷል!*\n\n` +
                `✅ ሲሚንቶዎ ለገዥዎች ይታያል።\n` +
                `ሁኔታ ለመቀየር ወይም ዋጋ ለማሻሻል ከታቹ ያለውን ቁልፍ ይጠቀሙ 👇`,
                { parse_mode: 'Markdown' }
            );
            return ctx.reply(cementCard(doc.toObject(), false), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // UPDATE CEMENT PRICE
        // ══════════════════════════════════════════════════
        if (action === 'UPD_CEM_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await CementSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ መረጃ አልተገኘም።');
            await ctx.reply(`✅ *ዋጋ ወደ ${fmt(price)} ብር/ኩንታል ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(cementCard(doc.toObject(), false), { parse_mode: 'Markdown', ...cementItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // BUY CEMENT
        // ══════════════════════════════════════════════════
        if (action === 'BUY_CEMENT_1') {
            ctx.session.buyCement = { type: text };
            ctx.session.action = 'BUY_CEMENT_2';
            return ctx.reply(step(2, 3, '📍 ሲሚንቶ የሚፈልጉበት ቦታ ያስገቡ _(ለምሳሌ: አዲስ አበባ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_CEMENT_2') {
            ctx.session.buyCement.location = text;
            ctx.session.action = 'BUY_CEMENT_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ _(ለወደፊት ማሳወቂያ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_CEMENT_3') {
            const { type, location } = ctx.session.buyCement;
            logSearch(ctx, '🧱 ሲሚንቶ ፈላጊ', `${type} | ${location}`, text);
            const results = await CementSeller.find({
                type: searchRx(type), location: searchRx(location), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(
                    `🎉 *${results.length} ሻጭ ተገኝቷል!*\n` +
                    `ዝቅተኛ ዋጋ ያለው ቅድሚያ ቀርቧል 👇`,
                    { parse_mode: 'Markdown' }
                );
                for (const r of results)
                    await ctx.reply(cementCard(r, false), { parse_mode: 'Markdown' });

                await ctx.reply(
                    `━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📞 *ለማዘዝ ወይም ለተጨማሪ:*  \`${SUPPORT_PHONE}\`\n` +
                    `ወይም ከሻጩ ቀጥታ ደውሉ!`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(
                    `😔 *ይቅርታ!*\n\n` +
                    `🔍 *"${esc(type)}"* — *${esc(location)}*\n\n` +
                    `ፍለጋዎ ለጊዜው አልተገኘም።\n` +
                    `ሲገኝ ወዲያውኑ እናሳውቀዎታለን! 🔔\n\n` +
                    `📞 ለተጨማሪ ድጋፍ:  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
            }
            ctx.session.action = null; ctx.session.buyCement = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // TRUCK REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            return ctx.reply(step(2, 4, '🚗 ታርጋ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text.toUpperCase();
            ctx.session.action = 'REG_TRUCK_3';
            return ctx.reply(step(3, 4, '🛣️ የጉዞ መስመር ያስገቡ _(ለምሳሌ: ከ አ.አ ወደ ሀዋሳ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            return ctx.reply(step(4, 4, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = text;
            const doc = await TruckLeasor.create({ ...ctx.session.truckData, userId: uid, status: 'active' });
            ctx.session.action = null; ctx.session.truckData = {};
            await ctx.reply(
                `🎉 *ምዝገባ ተሳክቷል!*\n\n` +
                `✅ ትራኩ ለፈላጊዎች ይታያል።\n` +
                `ሁኔታ ለመቀየር ከታቹ ያለውን ቁልፍ ይጠቀሙ 👇`,
                { parse_mode: 'Markdown' }
            );
            return ctx.reply(truckCard(doc.toObject(), false), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // UPDATE TRUCK ROUTE
        // ══════════════════════════════════════════════════
        if (action === 'UPD_TRK_ROUTE') {
            const doc = await TruckLeasor.findByIdAndUpdate(ctx.session.targetItemId, { route: text }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ *መስመር ወደ "${esc(text)}" ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(truckCard(doc.toObject(), false), { parse_mode: 'Markdown', ...truckItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // RENT TRUCK
        // ══════════════════════════════════════════════════
        if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            return ctx.reply(step(2, 3, '🛣️ ጉዞ ከየት ወደ የት? _(ለምሳሌ: ከ አ.አ ወደ ሀዋሳ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ _(ለወደፊት ማሳወቂያ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_TRUCK_3') {
            const { type, route } = ctx.session.rentTruck;
            logSearch(ctx, '🚚 ትራክ ፈላጊ', `${type} | ${route}`, text);
            const found = await TruckLeasor.findOne({
                type: searchRx(type), route: searchRx(route), status: 'active'
            }).sort({ rentedCount: 1 });

            if (found) {
                await ctx.reply(
                    `✅ *ትራክ ተገኝቷል!*\n\nአሁን ለመነጋገር ደውሉ 👇`,
                    { parse_mode: 'Markdown' }
                );
                await ctx.reply(truckCard(found.toObject(), false), { parse_mode: 'Markdown' });
                await ctx.reply(
                    `━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📞 *ድጋፍ:*  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
                TruckLeasor.findByIdAndUpdate(found._id, { $inc: { rentedCount: 1 } }).catch(() => {});
            } else {
                await ctx.reply(
                    `😔 *ይቅርታ!*\n\n` +
                    `🔍 *"${esc(type)}"* — *${esc(route)}*\n\n` +
                    `ለጊዜው ዝግጁ ትራክ አልተገኘም።\n` +
                    `ሲኖር ወዲያውኑ እናሳውቀዎታለን! 🔔\n\n` +
                    `📞 ለተጨማሪ:  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
            }
            ctx.session.action = null; ctx.session.rentTruck = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // STEEL REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_STEEL_1') {
            ctx.session.steelData = { type: text };
            ctx.session.action = 'REG_STEEL_2';
            return ctx.reply(step(2, 4, '📍 አድራሻ ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_2') {
            ctx.session.steelData.address = text;
            ctx.session.action = 'REG_STEEL_3';
            return ctx.reply(step(3, 4, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_3') {
            ctx.session.steelData.phone = text;
            ctx.session.action = 'REG_STEEL_4';
            return ctx.reply(step(4, 4, '💰 ዋጋ ያስገቡ _(ቁጥር ብቻ, ብር)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_STEEL_4') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await SteelSeller.create({ ...ctx.session.steelData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.steelData = {};
            await ctx.reply(
                `🎉 *ምዝገባ ተሳክቷል!*\n\n` +
                `✅ ብረቱ ለፈላጊዎች ይታያል።\n` +
                `ሁኔታ ለመቀየር ከታቹ ያለውን ቁልፍ ይጠቀሙ 👇`,
                { parse_mode: 'Markdown' }
            );
            return ctx.reply(steelCard(doc.toObject(), false), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // UPDATE STEEL PRICE
        // ══════════════════════════════════════════════════
        if (action === 'UPD_STL_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await SteelSeller.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ *ዋጋ ወደ ${fmt(price)} ብር ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(steelCard(doc.toObject(), false), { parse_mode: 'Markdown', ...steelItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // BUY STEEL
        // ══════════════════════════════════════════════════
        if (action === 'BUY_STEEL_1') {
            ctx.session.buySteel = { type: text };
            ctx.session.action = 'BUY_STEEL_2';
            return ctx.reply(step(2, 3, '📍 ብረት የሚፈልጉበት ቦታ ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_STEEL_2') {
            ctx.session.buySteel.location = text;
            ctx.session.action = 'BUY_STEEL_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ _(ለወደፊት ማሳወቂያ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'BUY_STEEL_3') {
            logSearch(ctx, '🟥 ብረት ፈላጊ', ctx.session.buySteel.type, text);
            const results = await SteelSeller.find({
                type: searchRx(ctx.session.buySteel.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`🎉 *${results.length} ሻጭ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                for (const r of results)
                    await ctx.reply(steelCard(r, false), { parse_mode: 'Markdown' });
                await ctx.reply(
                    `━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📞 *ለማዘዝ:*  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(
                    `😔 *ይቅርታ!*\n\n` +
                    `🔍 *"${esc(ctx.session.buySteel.type)}"* ለዛሬ አልተገኘም።\n\n` +
                    `ሲኖር ወዲያውኑ እናሳውቀዎታለን! 🔔\n` +
                    `📞  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
            }
            ctx.session.action = null; ctx.session.buySteel = {};
            return;
        }

        // ══════════════════════════════════════════════════
        // MACHINERY REGISTRATION
        // ══════════════════════════════════════════════════
        if (action === 'REG_MACHINERY_1') {
            ctx.session.machineryData = { type: text };
            ctx.session.action = 'REG_MACHINERY_2';
            return ctx.reply(step(2, 4, '📍 አድራሻ ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_2') {
            ctx.session.machineryData.address = text;
            ctx.session.action = 'REG_MACHINERY_3';
            return ctx.reply(step(3, 4, '📞 ስልክ ቁጥር ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_3') {
            ctx.session.machineryData.phone = text;
            ctx.session.action = 'REG_MACHINERY_4';
            return ctx.reply(step(4, 4, '💰 ኪራይ ዋጋ ያስገቡ _(ቁጥር ብቻ, ብር)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'REG_MACHINERY_4') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await MachineryLeasor.create({ ...ctx.session.machineryData, userId: uid, price, status: 'active' });
            ctx.session.action = null; ctx.session.machineryData = {};
            await ctx.reply(
                `🎉 *ምዝገባ ተሳክቷል!*\n\n` +
                `✅ ማሽነሪዎ ለፈላጊዎች ይታያል።\n` +
                `ሁኔታ ለመቀየር ከታቹ ያለውን ቁልፍ ይጠቀሙ 👇`,
                { parse_mode: 'Markdown' }
            );
            return ctx.reply(macCard(doc.toObject(), false), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // UPDATE MACHINERY PRICE
        // ══════════════════════════════════════════════════
        if (action === 'UPD_MAC_PRICE') {
            const price = parseFloat(text.replace(/,/g, ''));
            if (isNaN(price) || price <= 0) return ctx.reply('⚠️ ትክክለኛ ቁጥር ያስገቡ:');
            const doc = await MachineryLeasor.findByIdAndUpdate(ctx.session.targetItemId, { price }, { new: true });
            ctx.session.action = null; ctx.session.targetItemId = null;
            if (!doc) return ctx.reply('❗ አልተገኘም።');
            await ctx.reply(`✅ *ዋጋ ወደ ${fmt(price)} ብር ተሻሽሏል!*`, { parse_mode: 'Markdown' });
            return ctx.reply(macCard(doc.toObject(), false), { parse_mode: 'Markdown', ...macItemKb(doc._id) });
        }

        // ══════════════════════════════════════════════════
        // RENT MACHINERY
        // ══════════════════════════════════════════════════
        if (action === 'RENT_MACHINERY_1') {
            ctx.session.rentMachinery = { type: text };
            ctx.session.action = 'RENT_MACHINERY_2';
            return ctx.reply(step(2, 3, '📍 ማሽነሪ የሚፈልጉበት ቦታ ያስገቡ:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_MACHINERY_2') {
            ctx.session.rentMachinery.location = text;
            ctx.session.action = 'RENT_MACHINERY_3';
            return ctx.reply(step(3, 3, '📞 ስልክ ቁጥርዎን ያስገቡ _(ለወደፊት ማሳወቂያ)_:'), { parse_mode: 'Markdown' });
        }
        if (action === 'RENT_MACHINERY_3') {
            logSearch(ctx, '🔹 ማሽነሪ ፈላጊ', ctx.session.rentMachinery.type, text);
            const results = await MachineryLeasor.find({
                type: searchRx(ctx.session.rentMachinery.type), status: 'active'
            }).sort({ price: 1 }).limit(5).lean();

            if (results.length) {
                await ctx.reply(`🎉 *${results.length} ማሽነሪ ተገኝቷል!* 👇`, { parse_mode: 'Markdown' });
                for (const r of results)
                    await ctx.reply(macCard(r, false), { parse_mode: 'Markdown' });
                await ctx.reply(
                    `━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📞 *ለማዘዝ:*  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
            } else {
                await ctx.reply(
                    `😔 *ይቅርታ!*\n\n` +
                    `🔍 *"${esc(ctx.session.rentMachinery.type)}"* ለዛሬ አልተገኘም።\n\n` +
                    `ሲኖር ወዲያውኑ እናሳውቀዎታለን! 🔔\n` +
                    `📞  \`${SUPPORT_PHONE}\``,
                    { parse_mode: 'Markdown' }
                );
            }
            ctx.session.action = null; ctx.session.rentMachinery = {};
            return;
        }

    } catch (err) {
        console.error('Handler error:', err);
        ctx.reply('⚠️ ስህተት አጋጥሟል። እባክዎ ቆይተው እንደገና ይሞክሩ።').catch(() => {});
    }
});

// ──────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLERS
// ──────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
    console.error(`Bot error [${ctx?.updateType}]:`, err);
    ctx?.reply?.('⚠️ ያልተጠበቀ ስህተት አጋጥሟል።').catch(() => {});
});
process.on('uncaughtException',  e => console.error('UNCAUGHT:', e));
process.on('unhandledRejection', e => console.error('REJECTION:', e));

// ──────────────────────────────────────────────────────────
// HTTP SERVER + KEEP-ALIVE
// ──────────────────────────────────────────────────────────
http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Simple Marketplace Bot v5.0 — OK');
}).listen(PORT, '0.0.0.0', () => console.log(`🌐 HTTP :${PORT}`));

if (RENDER_URL) {
    const base = RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`;
    setInterval(() => {
        http.get(base, r => console.log(`⏱️  ping → ${r.statusCode}`))
            .on('error', e => console.warn('ping err:', e.message));
    }, 14 * 60 * 1000);
    console.log(`🔄 Keep-alive → ${base}`);
} else {
    console.warn('⚠️  RENDER_EXTERNAL_URL not set — keep-alive disabled');
}

// ──────────────────────────────────────────────────────────
// LAUNCH
// ──────────────────────────────────────────────────────────
bot.launch({
    allowedUpdates: ['message', 'callback_query'],
    dropPendingUpdates: true
})
.then(() => console.log('🤖 Bot v5.0 launched!'))
.catch(err => { console.error('Launch failed:', err); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
