const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => { res.send('ቦቱ በጥሩ ሁኔታ እየሰራ ነው!'); });

const BOT_TOKEN = process.env.BOT_TOKEN ? process.env.BOT_TOKEN.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ ዳታቤዝ ተገናኝቷል!"))
    .catch(err => console.error("❌ የዳታቤዝ ስህተት:", err));

// --- Schemas ---
const CementSeller = mongoose.model('CementSeller', new mongoose.Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String }));
const SteelSeller = mongoose.model('SteelSeller', new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String }));
const MachineryLeasor = mongoose.model('MachineryLeasor', new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String }));
const TruckLeasor = mongoose.model('TruckLeasor', new mongoose.Schema({ userId: Number, type: String, plate: String, route: String, phone: String, status: String, rentedCount: { type: Number, default: 0 } }));
const BotSession = mongoose.model('BotSession', new mongoose.Schema({ key: { type: String, required: true, unique: true }, data: { type: Object, default: {} } }));
const SearchLog = mongoose.model('SearchLog', new mongoose.Schema({ userId: Number, username: String, category: String, searchedFor: String, phone: String, createdAt: { type: Date, default: Date.now } }));
const ActiveLog = mongoose.model('ActiveLog', new mongoose.Schema({ userId: Number, name: String, category: String, detail: String, dateStr: String, createdAt: { type: Date, default: Date.now } }));

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
    } catch (err) { await next(); }
});

// --- መለኪያ ተግባራት ---
function getTodayDateString() {
    const d = new Date();
    d.setHours(d.getHours() + 3); 
    return d.toISOString().split('T'); 
}

// --- የቦት ዋና ዋና ትዕዛዞች ---
bot.start((ctx) => {
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', Markup.keyboard([
        ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
        ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
        ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
        ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
    ]).resize());
});

// --- አድሚን ፓናል ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) return;
    ctx.reply('👑 የአድሚን ፓናል', Markup.inlineKeyboard([
        [Markup.button.callback('❌ ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]));
});

bot.action('admin_delete_menu', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply('ማጥፋት የሚፈልጉትን ይምረጡ፦', Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement')],
        [Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel')],
        [Markup.button.callback('🔹 ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]));
});

bot.action(/adm_manage_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const type = ctx.match;
    let items = [];
    if (type === 'cement') items = await CementSeller.find().limit(10);
    else if (type === 'truck') items = await TruckLeasor.find().limit(10);
    else if (type === 'steel') items = await SteelSeller.find().limit(10);
    else if (type === 'machinery') items = await MachineryLeasor.find().limit(10);
    
    if (items.length === 0) return ctx.reply('ምንም መረጃ የለም');
    const buttons = items.map(i => [Markup.button.callback(`❌ ${i.companyName || i.plate || i.type || 'አጥፋ'}`, `del_${type}_${i._id}`)]);
    ctx.reply('ለማጥፋት ይምረጡ፦', Markup.inlineKeyboard(buttons));
});

bot.action(/del_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const [_, type, id] = ctx.callbackQuery.data.split('_');
    if (type === 'cement') await CementSeller.findByIdAndDelete(id);
    else if (type === 'truck') await TruckLeasor.findByIdAndDelete(id);
    else if (type === 'steel') await SteelSeller.findByIdAndDelete(id);
    else if (type === 'machinery') await MachineryLeasor.findByIdAndDelete(id);
    ctx.reply('✅ ተሰርዟል!');
});

// --- መኪና በተን ---
bot.action(/tr_(act|off|route)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const [_, action, truckId] = ctx.callbackQuery.data.split('_');
    if (action === 'act') await TruckLeasor.findByIdAndUpdate(truckId, { status: 'active' });
    else if (action === 'off') await TruckLeasor.findByIdAndUpdate(truckId, { status: 'off' });
    else if (action === 'route') {
        ctx.session.action = 'UPDATE_TRUCK_ROUTE';
        ctx.session.targetTruckId = truckId;
        return ctx.reply('አዲስ መስመር ያስገቡ፡');
    }
    ctx.reply('ተከናውኗል!');
});

// --- ሰርቨር እና ቦት ማስነሻ (FIXED) ---
const server = app.listen(port, () => {
    console.log(`🌐 ሰርቨር በፖርት ${port} ላይ እየሰራ ነው`);
});

bot.launch().then(() => {
    console.log('🤖 ቦቱ ስራ ጀምሯል!');
}).catch(err => console.error("ቦት ማስነሳት አልተቻለም:", err));

// --- 💡 ይሄ ክፍል ነው የ 409 error የሚከላከለው ---
const gracefulShutdown = (signal) => {
    console.log(`Received ${signal}. Closing bot...`);
    bot.stop(signal); // ቦቱን በሰላም ዘጋው
    server.close();   // ሰርቨሩንም ዝጋው
    process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
