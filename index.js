const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');

// --- 🌐 የ Express ሰርቨር ማዘጋጃ ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => { res.send('ቦቱ እየሰራ ነው!'); });

const BOT_TOKEN = process.env.BOT_TOKEN ? process.env.BOT_TOKEN.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI).then(() => console.log("✅ DB Connected")).catch(err => console.error(err));

// --- 📊 Schemas ---
const CementSeller = mongoose.model('CementSeller', new mongoose.Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String }));
const SteelSeller = mongoose.model('SteelSeller', new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String }));
const MachineryLeasor = mongoose.model('MachineryLeasor', new mongoose.Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String }));
const TruckLeasor = mongoose.model('TruckLeasor', new mongoose.Schema({ userId: Number, type: String, plate: String, route: String, phone: String, status: String, rentedCount: { type: Number, default: 0 } }));
const BotSession = mongoose.model('BotSession', new mongoose.Schema({ key: String, data: Object }));

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

// --- 👑 የአድሚን ፓናል (ተስተካከለ) ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) return ctx.reply('ይቅርታ፣ ፈቃድ የለዎትም!');
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('🧱 ሲሚንቶ አጥፋ', 'adm_manage_cement'), Markup.button.callback('🚚 መኪና አጥፋ', 'adm_manage_truck')],
        [Markup.button.callback('🟥 ብረት አጥፋ', 'adm_manage_steel'), Markup.button.callback('🔹 ማሽነሪ አጥፋ', 'adm_manage_machinery')]
    ]);
    ctx.reply('ማጥፋት የሚፈልጉትን ዘርፍ ይምረጡ፦', adminMenu);
});

// 1. መጀመሪያ ዝርዝሩን ማሳያ (List Items)
bot.action(/adm_manage_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const type = ctx.match[1]; // cement, truck, steel, machinery
    let items = [];
    if (type === 'cement') items = await CementSeller.find();
    else if (type === 'truck') items = await TruckLeasor.find();
    else if (type === 'steel') items = await SteelSeller.find();
    else if (type === 'machinery') items = await MachineryLeasor.find();

    if (items.length === 0) return ctx.reply('ምንም መረጃ የለም።');
    
    let buttons = [];
    items.forEach(i => {
        const label = i.companyName || i.plate || i.type || 'ያልታወቀ';
        buttons.push([Markup.button.callback(`❌ አጥፋ: ${label}`, `del_${type}_${i._id}`)]);
    });
    ctx.reply('ለማጥፋት የሚፈልጉትን ይምረጡ፦', Markup.inlineKeyboard(buttons));
});

// 2. ትክክለኛው የማጥፊያ ትዕዛዝ (Delete Action)
bot.action(/del_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.match[1].split('_'); // [type, id]
    const type = data[0];
    const id = data[1];

    if (type === 'cement') await CementSeller.findByIdAndDelete(id);
    else if (type === 'truck') await TruckLeasor.findByIdAndDelete(id);
    else if (type === 'steel') await SteelSeller.findByIdAndDelete(id);
    else if (type === 'machinery') await MachineryLeasor.findByIdAndDelete(id);
    
    ctx.reply('✅ መረጃው በተሳካ ሁኔታ ተሰርዟል!');
});

// --- 🚚 የ መኪና በተኖች (ተስተካከለ) ---
bot.action(/tr_(act|off|route)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const action = ctx.match[1]; 
    const id = ctx.match[2];

    if (action === 'act') {
        await TruckLeasor.findByIdAndUpdate(id, { status: 'active' });
        ctx.reply('✅ መኪናዎ አሁን "🟢 ዝግጁ" ሆኗል።');
    } else if (action === 'off') {
        await TruckLeasor.findByIdAndUpdate(id, { status: 'off' });
        ctx.reply('🔴 መኪናዎ አሁን "🔴 ስራ ላይ" ሆኗል።');
    } else if (action === 'route') {
        ctx.session.action = 'UPDATE_TRUCK_ROUTE';
        ctx.session.targetTruckId = id;
        ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ፡');
    }
});

// --- ሌሎች ኮዶች እንደነበሩ ---
bot.start((ctx) => ctx.reply('እንኳን በደህና መጡ!'));

bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const myTrucks = await TruckLeasor.find({ userId: ctx.from.id });
    if (myTrucks.length > 0) {
        let buttons = [];
        myTrucks.forEach(t => {
            buttons.push([Markup.button.callback(`🚗 ${t.plate}`, 'none')]);
            buttons.push([
                Markup.button.callback('🟢 ዝግጁ', `tr_act_${t._id}`),
                Markup.button.callback('🔴 ስራ ላይ', `tr_off_${t._id}`),
                Markup.button.callback('📍 መስመር ቀይር', `tr_route_${t._id}`)
            ]);
        });
        ctx.reply('የእርስዎ መኪናዎች:', Markup.inlineKeyboard(buttons));
    } else {
        ctx.reply('ምንም የተመዘገበ መኪና የለዎትም።');
    }
});

// --- መነሻ ---
app.listen(port, () => {
    bot.launch().then(() => console.log('🤖 ቦቱ ስራ ጀምሯል!'));
});
