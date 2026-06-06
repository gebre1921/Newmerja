const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');
const express = require('express');

// --- ⚙️ ለፍጥነት የተጨመሩ Cache-ዎች ---
const sessionCache = new Map();
const searchCache = new Map();

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
mongoose.connect(MONGO_URI, { maxPoolSize: 50 })
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
    userId: Number, username: String, category: String, searchedFor: String, phone: String, createdAt: { type: Date, default: Date.now }
}));

const ActiveLog = mongoose.model('ActiveLog', new mongoose.Schema({
    userId: Number, name: String, category: String, detail: String, dateStr: String, createdAt: { type: Date, default: Date.now }
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
        
        if (sessionCache.has(sessionKey)) {
            ctx.session = sessionCache.get(sessionKey);
        } else {
            let sessionDoc = await BotSession.findOne({ key: sessionKey });
            if (!sessionDoc) {
                sessionDoc = await BotSession.create({ key: sessionKey, data: {} });
            }
            ctx.session = sessionDoc.data || {};
            sessionCache.set(sessionKey, ctx.session);
        }

        await next();
        
        sessionCache.set(sessionKey, ctx.session);
        await BotSession.updateOne({ key: sessionKey }, { $set: { data: ctx.session } });
    } catch (err) {
        console.error("Session Error:", err);
        await next();
    }
});

// [ተስተካክሏል] String እንዲመልስ ተደርጓል
function getTodayDateString() {
    const d = new Date();
    d.setHours(d.getHours() + 3); 
    return d.toISOString().split('T');
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
    if (ctx.from.id !== 7423347375) return ctx.reply('ይቅርታ፣ ፈቃድ የለዎትም!');
    ctx.session.action = null;
    const adminMenu = Markup.inlineKeyboard([
        [Markup.button.callback('📊 ሲሚንቶ ሪፖርት', 'rep_cement'), Markup.button.callback('📊 መኪና ሪፖርት', 'rep_truck')],
        [Markup.button.callback('📊 ብረት ሪፖርት', 'rep_steel'), Markup.button.callback('📊 ማሽነሪ ሪፖርት', 'rep_machinery')],
        [Markup.button.callback('🔍 የፈላጊዎች ፍላጎት', 'rep_searches')],
        [Markup.button.callback('📅 የዛሬ Active', 'rep_actives')],
        [Markup.button.callback('❌ ማጥፊያ ፓናል', 'admin_delete_menu')]
    ]);
    ctx.reply('👑 እንኳን ወደ አድሚን ፓናል በሰላም መጡ።', adminMenu);
});

// --- 📊 የአድሚን ሪፖርት ማሳያ ---
bot.action(/rep_.+/, async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const action = ctx.callbackQuery.data;
        if (action === 'rep_cement') {
            const items = await CementSeller.find({}).lean();
            if (items.length === 0) return ctx.reply('🧱 ምንም የለም።');
            let msg = '📊 የሲሚንቶ ሻጮች ሪፖርት፦\n\n';
            items.forEach((item, idx) => { msg += `${idx + 1}. ድርጅት: ${item.companyName}\n   አይነት: ${item.type}\n   ስልክ: ${item.phone}\n   ሁኔታ: ${item.status}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_truck') {
            const items = await TruckLeasor.find({}).lean();
            if (items.length === 0) return ctx.reply('🚚 ምንም የለም።');
            let msg = '📊 የመኪና አከራዮች ሪፖርት፦\n\n';
            items.forEach((item, idx) => { msg += `${idx + 1}. ታርጋ: ${item.plate}\n   መስመር: ${item.route}\n   ሁኔታ: ${item.status}\n────────────────\n`; });
            ctx.reply(msg);
        } else if (action === 'rep_searches') {
             const logs = await SearchLog.find({}).sort({ createdAt: -1 }).limit(30).lean();
             if (logs.length === 0) return ctx.reply('🔍 ምንም የፍለጋ ታሪክ የለም።');
             let msg = '🔍 የፈላጊዎች ፍላጎት ሪፖርት፦\n\n';
             logs.forEach((log, idx) => { msg += `${idx + 1}. ዘርፍ: ${log.category}\n   የፈለገው: ${log.searchedFor}\n────────────────\n`; });
             ctx.reply(msg);
        } else if (action === 'rep_actives') {
            const todayStr = getTodayDateString();
            const logs = await ActiveLog.find({ dateStr: todayStr }).sort({ createdAt: -1 }).lean();
            if (logs.length === 0) return ctx.reply(`📅 ዛሬ (${todayStr}) እንቅስቃሴ የለም።`);
            let msg = `📅 የዛሬ (${todayStr}) የActive ተጠቃሚዎች ሪፖርት፦\n\n`;
            logs.forEach((log, idx) => { msg += `${idx + 1}. ስም: ${log.name}\n   ዘርፍ: ${log.category}\n────────────────\n`; });
            ctx.reply(msg);
        }
    } catch(e) { console.error(e); }
});

// --- 🚚 የመኪና በተኖች Handler [ተስተካክሏል] ---
bot.action(/tr_(act|off|route)_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const data = ctx.callbackQuery.data.split('_'); 
    const action = data; 
    const truckId = data; 

    if (action === 'act') {
        await TruckLeasor.findByIdAndUpdate(truckId, { status: 'active' });
        ctx.reply('✅ መኪናዎ አሁን "🟢 ዝግጁ" ሆኗል።');
    } else if (action === 'off') {
        await TruckLeasor.findByIdAndUpdate(truckId, { status: 'off' });
        ctx.reply('🔴 መኪናዎ አሁን "🔴 ስራ ላይ" ተደርጓል።');
    } else if (action === 'route') {
        ctx.session.action = 'UPDATE_TRUCK_ROUTE';
        ctx.session.targetTruckId = truckId;
        ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ፡');
    }
});

bot.action('truck_new_reg', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ፡');
});

// --- Menu Listeners ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.reply(`እንኳን ደህና መጡ! ለመመዝገብ የሲሚንቶ አይነት ያስገቡ፡`);
});

bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
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
        buttons.push([Markup.button.callback('➕ አዲስ መኪና ለመመዝገብ', 'truck_new_reg')]);
        ctx.reply(`📋 የእርስዎ መኪናዎች ማስተዳደሪያ፡`, Markup.inlineKeyboard(buttons));
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.reply(`ለመመዝገብ የመኪናውን አይነት ያስገቡ፡`);
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return next();
    
    const action = ctx.session.action;
    const userId = ctx.from.id;
    if (!action) return;

    try {
        if (action === 'RENT_TRUCK_1') {
            ctx.session.rentTruck = { type: text };
            ctx.session.action = 'RENT_TRUCK_2';
            ctx.reply('2. የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር)፡');
        } else if (action === 'RENT_TRUCK_2') {
            ctx.session.rentTruck.route = text;
            ctx.session.action = 'RENT_TRUCK_3';
            ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'RENT_TRUCK_3') {
            ctx.session.rentTruck.phone = text; 
            const userRoute = ctx.session.rentTruck.route || "";
            const cleanRoute = userRoute.toLowerCase();
            let searchRegex = (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር")) ? new RegExp("(gondar|ጎንደር)", "i") : createSearchRegex(userRoute);
            const typeRegex = createSearchRegex(ctx.session.rentTruck.type);
            
            const foundTruck = await TruckLeasor.findOne({ type: typeRegex, route: searchRegex, status: 'active' }); 
            if (foundTruck) {
                ctx.reply(`✅ የሚፈልጉት መኪና ይገኛል!\nታርጋ፡ ${foundTruck.plate}\nለማዘዝ በ 0960336138 ደውሉ`);
                await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $inc: { rentedCount: 1 } });
            } else {
                ctx.reply('❌ በዚህ የጉዞ መስመር የሚጓዝ መኪና አልተገኘም።');
            }
            ctx.session.action = null;
        } else if (action === 'REG_TRUCK_1') {
            ctx.session.truckData = { type: text };
            ctx.session.action = 'REG_TRUCK_2';
            ctx.reply('የመኪናው ታርጋ ያስገቡ፡');
        } else if (action === 'REG_TRUCK_2') {
            ctx.session.truckData.plate = text;
            ctx.session.action = 'REG_TRUCK_3';
            ctx.reply('የጉዞ መስመር ያስገቡ፡');
        } else if (action === 'REG_TRUCK_3') {
            ctx.session.truckData.route = text;
            ctx.session.action = 'REG_TRUCK_4';
            ctx.reply('ስልክ ቁጥር ያስገቡ፡');
        } else if (action === 'REG_TRUCK_4') {
            ctx.session.truckData.phone = text;
            ctx.session.truckData.userId = userId;
            ctx.session.truckData.status = 'active';
            await TruckLeasor.findOneAndUpdate({ userId, plate: ctx.session.truckData.plate }, ctx.session.truckData, { upsert: true });
            ctx.session.action = null;
            ctx.reply('መኪናዎ በትክክል ተመዝግቧል!');
        } else if (action === 'UPDATE_TRUCK_ROUTE') {
            await TruckLeasor.findByIdAndUpdate(ctx.session.targetTruckId, { route: text });
            ctx.reply(`መስመር ወደ [ ${text} ] ተቀይሯል!`);
            ctx.session.action = null;
        }
    } catch (error) {
        console.error("Handler Error:", error);
    }
});

app.listen(port, () => {
    console.log(`🌐 ዌብ ሰርቨሩ በፖርት ${port} ላይ እየሰራ ነው...`);
    bot.launch().then(() => console.log('🤖 ቦቱ ስራ ጀምሯል!')).catch(err => console.error(err));
});
