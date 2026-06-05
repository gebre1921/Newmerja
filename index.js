const { Telegraf, Markup, session } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// --- 🛠️ የቶክን ማጽጃ ክፍል ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

console.log(`-> ቶክኑ በተሳካ ሁኔታ ተነቧል! ርዝመት: ${BOT_TOKEN.length} ቁምፊዎች።`);

// --- 🗄️ ከማንጎ ዲቢ (MongoDB) ጋር ማገናኛ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("ማንጎ ዲቢ ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!"))
    .catch(err => console.error("የዳታቤዝ ግንኙነት ስህተት:", err));

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር ---
const CementSeller = mongoose.model('CementSeller', { userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });

const TruckLeasor = mongoose.model('TruckLeasor', { 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    phone: String, 
    status: String,
    rentedCount: { type: Number, default: 0 } 
});

const SteelSeller = mongoose.model('SteelSeller', { userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachineryLeasor = mongoose.model('MachineryLeasor', { userId: Number, type: String, address: String, phone: String, price: String, status: String });

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

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

// --- 🎛️ የውስጥ በተኖች (Inline Keyboards) ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
]);

// 🚚 የተሻሻለው የመኪና ባለቤት በተኖች
const truckLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ መኪና አለ', 'truck_active'), Markup.button.callback('❌ መኪና የለም', 'truck_off')],
    [Markup.button.callback('➕ አዲስ መኪና ጨምር', 'truck_re_reg'), Markup.button.callback('🔄 መስመር ቀይር', 'truck_change_route')]
]);

const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],
    [Markup.button.callback('💰 ዋጋ ለማሻሻል', 'steel_update_price')]
]);

const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]
]);

// --- 🧱 ሲሚንቶ ክፍል ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። የአሁኑ ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, cementSellerInline);
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply('የሲሚንቶ አይነት ያስገቡ：');
    }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});

// --- 🚚 መኪና ክፍል ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const existing = await TruckLeasor.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ መኪና አለዎት (ታርጋ፡ ${existing.plate})።\nምን ማድረግ ትፈልጋለህ?`, truckLeasorInline);
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.reply('ምን አይነት መኪና እንደሆነ ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 🟥 ብረት ክፍል ---
bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    const existing = await SteelSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገቡ የብረት ሻጭ ነዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, steelSellerInline);
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.reply('1. የብረት አይነቶችን ያስገቡ፡');
    }
});

bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});

// --- 🔹 ማሽነሪ ክፍል ---
bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    const existing = await MachineryLeasor.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`ቀድሞውኑ የተመዘገበ ማሽነሪ አለዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, machineryLeasorInline);
    } else {
        ctx.session.action = 'REG_MACHINERY_1';
        ctx.reply('1. የማሽነሪው አይነት ያስገቡ፡');
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACHINERY_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

// --- 💬 የፅሁፍ መልዕክቶች ማቀናበሪያ (Text Handler) ---
bot.on('text', async (ctx) => {
    const action = ctx.session?.action;
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (!action) return;

    // ሲሚንቶ ሂደት
    if (action === 'REG_CEMENT_1') {
        ctx.session.cementData = { type: text };
        ctx.session.action = 'REG_CEMENT_2';
        ctx.reply('2. ያለበት ቦታ ያስገቡ：');
    } else if (action === 'REG_CEMENT_2') {
        ctx.session.cementData.location = text;
        ctx.session.action = 'REG_CEMENT_3';
        ctx.reply('3. የድርጅቱ ስም ያስገቡ：');
    } else if (action === 'REG_CEMENT_3') {
        ctx.session.cementData.companyName = text;
        ctx.session.action = 'REG_CEMENT_4';
        ctx.reply('4. ስልክ ቁጥር ያስገቡ：');
    } else if (action === 'REG_CEMENT_4') {
        ctx.session.cementData.phone = text;
        ctx.session.cementData.userId = userId;
        ctx.session.cementData.price = 1300; 
        ctx.session.cementData.status = 'active';
        
        await CementSeller.findOneAndUpdate({ userId }, ctx.session.cementData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል!', cementSellerInline);
    }
    else if (action === 'UPDATE_CEMENT_PRICE') {
        await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) });
        ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር በተሳካ ሁኔታ ተሻሽሏል!`);
        ctx.session.action = null;
    }
    // ... (BUY_CEMENT logical blocks omitted for brevity but remain same)

    // 🚚 መኪና ሂደት
    else if (action === 'REG_TRUCK_1') {
        ctx.session.truckData = { type: text };
        ctx.session.action = 'REG_TRUCK_2';
        ctx.reply('የመኪናው ታርጋ ያስገቡ：');
    } else if (action === 'REG_TRUCK_2') {
        ctx.session.truckData.plate = text;
        ctx.session.action = 'REG_TRUCK_3';
        ctx.reply('የጉዞ መስመር ያስገቡ (ምሳሌ፡ ሀዋሳ አዳማ)፡');
    } else if (action === 'REG_TRUCK_3') {
        ctx.session.truckData.route = text;
        ctx.session.action = 'REG_TRUCK_4';
        ctx.reply('ስልክ ቁጥር ያስገቡ：');
    } else if (action === 'REG_TRUCK_4') {
        ctx.session.truckData.phone = text;
        ctx.session.truckData.userId = userId;
        ctx.session.truckData.status = 'active';
        ctx.session.truckData.rentedCount = 0; 
        await TruckLeasor.findOneAndUpdate({ userId }, ctx.session.truckData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል!', truckLeasorInline);
    }
    else if (action === 'CHANGE_TRUCK_ROUTE') {
        await TruckLeasor.findOneAndUpdate({ userId }, { route: text });
        ctx.reply(`የጉዞ መስመርዎ ወደ "${text}" ተቀይሯል!`);
        ctx.session.action = null;
    }
    // ... (REST OF THE LOGIC STAYS SAME)

    // (ማሳሰቢያ: ಉಳሎቹን (ብረት/ማሽነሪ) እንደነበሩ ያቆዩዋቸው)
});

// --- 🔘 የውስጥ በተኖች አሠራር ---
// (ሲሚንቶ/ብረት/ማሽነሪ አክሽኖች እንደነበሩ ይቆዩ)

// 🚚 የመኪና በተን አክሽኖች
bot.action('truck_active', async (ctx) => {
    await TruckLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('መኪናዎ ዝግጁ (Active) ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('truck_off', async (ctx) => {
    await TruckLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('መኪናዎ ከእይታ ውጪ [የለም] ተደርጓል።');
    ctx.answerCbQuery();
});
bot.action('truck_change_route', (ctx) => {
    ctx.session.action = 'CHANGE_TRUCK_ROUTE';
    ctx.reply('አዲሱን የጉዞ መስመር ያስገቡ：');
    ctx.answerCbQuery();
});
bot.action('truck_re_reg', (ctx) => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.reply('አዲስ መኪና ለመመዝገብ፣ እባክዎ የመኪናውን አይነት ያስገቡ：');
    ctx.answerCbQuery();
});

// --- 👑 አድሚን ፓነል ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) return ctx.reply('ፈቃድ የለዎትም!');
    const trucks = await TruckLeasor.find({});
    const buttons = trucks.map(truck => [
        Markup.button.callback(`🚚 ${truck.plate}`, 'none'),
        Markup.button.callback('❌ ሰርዝ', `admin_del_${truck._id}`)
    ]);
    ctx.reply('👑 አድሚን ፓነል:', Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_del_(.+)$/, async (ctx) => {
    const deleted = await TruckLeasor.findByIdAndDelete(ctx.match);
    ctx.answerCbQuery('ተሰርዟል!');
    ctx.editMessageText('መኪናው ተሰርዟል');
});

bot.action('none', (ctx) => ctx.answerCbQuery());

// --- 🌐 Server ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot is Running!')).listen(PORT);
bot.launch().then(() => console.log('Simple Bot is alive!'));
