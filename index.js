const { Telegraf, Markup, session } = require('telegraf');
const mongoose = require('mongoose');

// --- ⚙️ Config ---
const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN_HERE';
const MONGO_URI = 'YOUR_MONGODB_CONNECTION_STRING_HERE';

mongoose.connect(MONGO_URI).then(() => console.log("DB Connected"));

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// --- 📊 Database Schemas ---
const Schema = mongoose.Schema;
const CementSchema = new Schema({ userId: Number, type: String, location: String, companyName: String, phone: String, price: {type: Number, default: 1300}, status: String });
const TruckSchema = new Schema({ userId: Number, type: String, plate: String, route: String, phone: String, status: String });
const SteelSchema = new Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachinerySchema = new Schema({ userId: Number, type: String, address: String, phone: String, price: String, status: String });

const CementSeller = mongoose.model('CementSeller', CementSchema);
const TruckLeasor = mongoose.model('TruckLeasor', TruckSchema);
const SteelSeller = mongoose.model('SteelSeller', SteelSchema);
const MachineryLeasor = mongoose.model('MachineryLeasor', MachinerySchema);

// --- ⌨️ Main Keyboard ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

// --- 🔄 Action Buttons (Inline) ---
const getStatusInline = (type) => Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', `${type}_active`), Markup.button.callback('❌ የለም', `${type}_off`)],
    [Markup.button.callback('🆕 አዲስ ለመመዝገብ', `${type}_re_reg`), Markup.button.callback('💰 ዋጋ ለማሻሻል', `${type}_update_price`)]
]);

// --- 🏁 Start ---
bot.start((ctx) => {
    ctx.session = {};
    ctx.reply('እንኳን ወደ አገልግሎታችን በሰላም መጡ! የሚፈልጉትን ይምረጡ።', mainKeyboard);
});

// --- 🧱 ሲሚንቶ Logic ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    const seller = await CementSeller.findOne({ userId: ctx.from.id });
    if(seller) {
        ctx.reply(`አሁን ያለዎት ሁኔታ: ${seller.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ይፈልጋሉ?`, getStatusInline('cement'));
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply('1. የሲሚንቶ አይነት ያስገቡ፡');
    }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});

// --- 🚚 መኪና Logic ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const truck = await TruckLeasor.findOne({ userId: ctx.from.id });
    if(truck) {
        ctx.reply('ምን ማድረግ ይፈልጋሉ?', Markup.inlineKeyboard([
            [Markup.button.callback('✅ አለ', 'truck_active'), Markup.button.callback('❌ የለም', 'truck_off')],
            [Markup.button.callback('🔄 የጉዞ መስመር ለመቀየር', 'truck_change_route')]
        ]));
    } else {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.reply('1. የመኪና አይነት ያስገቡ፡');
    }
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 🟥 ብረት Logic ---
bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => {
    const seller = await SteelSeller.findOne({ userId: ctx.from.id });
    if(seller) {
        ctx.reply('ምን ማድረግ ይፈልጋሉ?', getStatusInline('steel'));
    } else {
        ctx.session.action = 'REG_STEEL_1';
        ctx.reply('1. የብረት አይነቶችን ያስገቡ፡');
    }
});

bot.hears('🟥 ብረት ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_STEEL_1';
    ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?');
});

// --- 🔹 ማሽነሪ Logic ---
bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => {
    const mach = await MachineryLeasor.findOne({ userId: ctx.from.id });
    if(mach) {
        ctx.reply('ምን ማድረግ ይፈልጋሉ?', Markup.inlineKeyboard([
            [Markup.button.callback('✅ አለ', 'mach_active'), Markup.button.callback('❌ የለም', 'mach_off')]
        ]));
    } else {
        ctx.session.action = 'REG_MACH_1';
        ctx.reply('1. የማሽነሪ አይነት ያስገቡ፡');
    }
});

bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_MACH_1';
    ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡');
});

// --- 📝 Text Handler (Form Processing) ---
bot.on('text', async (ctx) => {
    const action = ctx.session.action;
    const text = ctx.message.text;

    if (!action) return;

    // ሲሚንቶ ሽያጭ ምዝገባ
    if (action === 'REG_CEMENT_1') { ctx.session.data = { type: text }; ctx.session.action = 'REG_CEMENT_2'; ctx.reply('2. ያለበት ቦታ ያስገቡ፡'); }
    else if (action === 'REG_CEMENT_2') { ctx.session.data.location = text; ctx.session.action = 'REG_CEMENT_3'; ctx.reply('3. የድርጅት ስም ያስገቡ፡'); }
    else if (action === 'REG_CEMENT_3') { ctx.session.data.phone = text; ctx.session.action = null; 
        await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { ...ctx.session.data, status: 'active' }, { upsert: true });
        ctx.reply('ተመዝግበዋል!');
    }
    
    // ሲሚንቶ ግዢ
    else if (action === 'BUY_CEMENT_1') { ctx.session.data = { type: text }; ctx.session.action = 'BUY_CEMENT_2'; ctx.reply('2. አድራሻ ያስገቡ፡'); }
    else if (action === 'BUY_CEMENT_2') { ctx.session.data.address = text; ctx.session.action = 'BUY_CEMENT_3'; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'BUY_CEMENT_3') {
        const item = await CementSeller.findOne({ type: new RegExp(ctx.session.data.type, 'i'), status: 'active' });
        ctx.reply(item ? `የጠየቁት ሲሚንቶ ይገኛል! ዋጋ 1300 ብር። በ 0960336138 ይደውሉልን።` : 'ይቅርታ የጠየቁት የሲሚንቶ አይነት ለዛሬ የለም።');
        ctx.session.action = null;
    }

    // መኪና ምዝገባ (በተመሳሳይ ይቀጥላል...)
    // ... ለሌሎች ክፍሎችም ይህንኑ መዋቅር በመከተል ማጠናቀቅ ይቻላል
});

// --- 🔘 Callback Queries (Status Updates) ---
bot.action(/cement_active/, async (ctx) => { await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('ሁኔታዎ [አለ] ተብሎ ተቀምጧል'); });
bot.action(/cement_off/, async (ctx) => { await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('ሁኔታዎ [የለም] ተብሎ ተቀምጧል'); });
bot.action(/truck_active/, async (ctx) => { await TruckLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('መኪናዎ ዝግጁ ነው'); });
bot.action(/truck_off/, async (ctx) => { await TruckLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('መኪናዎ ከእይታ ውጪ ሆኗል'); });

// (የቀሩትን በተኖች በተመሳሳይ መንገድ ይጨምሩ)

bot.launch();
