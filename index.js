const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- 🌐 የ Express ሰርቨር ማዘጋጃ ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('ቦቱ በጥሩ ሁኔታ እየሰራ ነው!');
});

// --- 🛠️ የቶክን ማጽጃ ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

// --- 🗄️ ከማንጎ ዲቢ (MongoDB) ጋር ማገናኛ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ ማንጎ ዲቢ ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!"))
    .catch(err => console.error("❌ የዳታቤዝ ግንኙነት ስህተት:", err));

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር (Schemas) ---
const cementSchema = new mongoose.Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });
cementSchema.index({ type: 1, status: 1 });
const CementSeller = mongoose.model('CementSeller', cementSchema);

const steelSchema = new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
steelSchema.index({ type: 1, status: 1 });
const SteelSeller = mongoose.model('SteelSeller', steelSchema);

const machinerySchema = new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachineryLeasor = mongoose.model('MachineryLeasor', machinerySchema);

const truckSchema = new mongoose.Schema({ 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    phone: String, 
    status: String,
    rentedCount: { type: Number, default: 0 } 
});
truckSchema.index({ type: 1, route: 1, status: 1 });
const TruckLeasor = mongoose.model('TruckLeasor', truckSchema);

const SearchLog = mongoose.model('SearchLog', new mongoose.Schema({
    userId: Number,
    username: String,
    category: String, 
    searchedFor: String, 
    phone: String,
    createdAt: { type: Date, default: Date.now }
}));

const ActiveLog = mongoose.model('ActiveLog', new mongoose.Schema({
    userId: Number,
    name: String,
    category: String, 
    detail: String, 
    dateStr: String, 
    createdAt: { type: Date, default: Date.now }
}));

const BotSession = mongoose.model('BotSession', new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    data: { type: Object, default: {} }
}));

const bot = new Telegraf(BOT_TOKEN);

// --- Session Middleware ---
bot.use(async (ctx, next) => {
    try {
        if (!ctx.from) return next();
        const sessionKey = `${ctx.from.id}:${ctx.from.id}`;
        let sessionDoc = await BotSession.findOne({ key: sessionKey });
        ctx.session = sessionDoc ? sessionDoc.data : {};
        await next();
        await BotSession.updateOne({ key: sessionKey }, { $set: { data: ctx.session } }, { upsert: true });
    } catch (err) {
        console.error("Session Error:", err);
        await next();
    }
});

function getTodayDateString() {
    const d = new Date();
    d.setHours(d.getHours() + 3); 
    return d.toISOString().split('T')[0]; 
}

function createSearchRegex(input) {
    if (!input) return new RegExp('', 'i');
    let clean = input.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (/[a-zA-Z]/.test(clean)) {
        const fuzzyPattern = clean.split('').map(char => `${char}*`).join('.*');
        return new RegExp(fuzzyPattern, 'i');
    } else {
        return new RegExp(clean, 'i');
    }
}

// --- ⌨️ ዋና ሜኑ ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

bot.start((ctx) => {
    ctx.session = {}; 
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- 👑 የአድሚን መቆጣጠሪያ ፓናል ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) {
        return ctx.reply('ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!');
    }
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 ሲሚንቶ ሪፖርት', 'rep_cement'), Markup.button.callback('📊 መኪና ሪፖርት', 'rep_truck')],
        [Markup.button.callback('📊 ብረት ሪፖርት', 'rep_steel'), Markup.button.callback('📊 ማሽነሪ ሪፖርት', 'rep_machinery')],
        [Markup.button.callback('🔍 የፈላጊዎች ፍላጎት', 'rep_searches'), Markup.button.callback('📅 Active ተጠቃሚዎች', 'rep_actives')],
        [Markup.button.callback('❌ ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]);
    ctx.reply('👑 እንኳን ወደ አድሚን ፓናል በሰላም መጡ።', adminMenu);
});

// --- 📊 የአድሚን ሪፖርት ማሳያ ---
bot.action(/rep_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    const action = ctx.callbackQuery.data;
    if (action === 'rep_cement') {
        const items = await CementSeller.find().limit(20).lean();
        let msg = '📊 የሲሚንቶ ሻጮች:\n\n';
        items.forEach(i => msg += `${i.companyName} (${i.type}) - ${i.status}\n`);
        ctx.reply(msg || 'ባዶ');
    } else if (action === 'rep_truck') {
        const items = await TruckLeasor.find().limit(20).lean();
        let msg = '📊 የመኪና አከራዮች:\n\n';
        items.forEach(i => msg += `${i.plate} - ${i.status}\n`);
        ctx.reply(msg || 'ባዶ');
    }
    // (ሌሎች ሪፖርቶችን በተመሳሳይ መልኩ ቀጥል...)
});

// --- ❌ የአድሚን ማጥፊያ ፓናል (FIXED) ---
bot.action('admin_delete_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const delMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('🔹 ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    ctx.reply('ማጥፋት የሚፈልጉትን ዘርፍ ይምረጡ፦', delMenu);
});

// 1. መዘርዝር (List Items)
bot.action(/adm_manage_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const type = ctx.match[1];
    let items = [];
    if (type === 'cement') items = await CementSeller.find().limit(20);
    else if (type === 'truck') items = await TruckLeasor.find().limit(20);
    else if (type === 'steel') items = await SteelSeller.find().limit(20);
    else if (type === 'machinery') items = await MachineryLeasor.find().limit(20);

    if (items.length === 0) return ctx.reply('ምንም መረጃ የለም።');
    
    let buttons = items.map(i => [Markup.button.callback(`❌ አጥፋ: ${i.companyName || i.plate || i.type || 'መረጃ'}`, `del_${type}_${i._id}`)]);
    ctx.reply('ማጥፋት የሚፈልጉትን ይምረጡ፦', Markup.inlineKeyboard(buttons));
});

// 2. ትክክለኛው የማጥፊያ ትዕዛዝ (Delete Action)
bot.action(/del_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split('_'); // [del, type, id]
    const type = parts[1];
    const id = parts[2];

    if (type === 'cement') await CementSeller.findByIdAndDelete(id);
    else if (type === 'truck') await TruckLeasor.findByIdAndDelete(id);
    else if (type === 'steel') await SteelSeller.findByIdAndDelete(id);
    else if (type === 'machinery') await MachineryLeasor.findByIdAndDelete(id);
    
    ctx.reply('✅ መረጃው በተሳካ ሁኔታ ተሰርዟል!');
});

// --- 🚚 የመኪና በተኖች Handler (FIXED) ---
bot.action(/tr_(act|off|route)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const parts = ctx.callbackQuery.data.split('_'); 
    const action = parts[1]; 
    const truckId = parts[2];

    if (action === 'act') {
        await TruckLeasor.findByIdAndUpdate(truckId, { status: 'active' });
        ctx.reply('✅ መኪናዎ አሁን "🟢 ዝግጁ" (Active) ሆኗል።');
    } else if (action === 'off') {
        await TruckLeasor.findByIdAndUpdate(truckId, { status: 'off' });
        ctx.reply('🔴 መኪናዎ አሁን "🔴 ስራ ላይ" ተደርጓል።');
    } else if (action === 'route') {
        ctx.session.action = 'UPDATE_TRUCK_ROUTE';
        ctx.session.targetTruckId = truckId;
        ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከባህር ዳር አዲስ አበባ)፡');
    }
});

// ... (ቀሪው ኮድህ እዚህ ይቀጥላል - ምንም አልተቀየረም)
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    // ... ቀድሞ የነበረው ኮድህ ...
    // (ምንም አልቀየርኩም)
    const myTrucks = await TruckLeasor.find({ userId: ctx.from.id }).lean();
    if (myTrucks.length > 0) {
        let buttons = [];
        myTrucks.forEach(t => {
            buttons.push([Markup.button.callback(`🇪🇹 ታርጋ፡ ${t.plate}`, 'none')]);
            buttons.push([
                Markup.button.callback('🟢 ዝግጁ', `tr_act_${t._id}`),
                Markup.button.callback('🔴 ስራ ላይ', `tr_off_${t._id}`),
                Markup.button.callback('📍 መስመር ቀይር', `tr_route_${t._id}`)
            ]);
        });
        ctx.reply('የእርስዎ መኪናዎች:', Markup.inlineKeyboard(buttons));
    } else {
        // ...
    }
});

// [እዚህ ጋር ቀሪውን የ text handler እና ሌሎች functions እንደነበሩ አስገባቸው]

// --- ሰርቨር ማስነሻ ---
app.listen(port, () => {
    bot.launch().then(() => console.log('🤖 ቦቱ ስራ ጀምሯል!'));
});
