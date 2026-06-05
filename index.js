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

// --- 🗄️ ከማንጎ ዲቢ (MongoDB) ጋር ማገናኛ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log("ማንጎ ዲቢ ዳታቤዝ በተሳካ ሁኔታ ተገናኝቷል!"))
    .catch(err => console.error("የዳታቤዝ ግንኙነት ስህተት:", err));

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር ---
const CementSeller = mongoose.model('CementSeller', { userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });
const SteelSeller = mongoose.model('SteelSeller', { userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachineryLeasor = mongoose.model('MachineryLeasor', { userId: Number, type: String, address: String, phone: String, price: String, status: String });

// 🚚 ማሻሻያ፡ አንድ ሰው ብዙ መኪና መመዝገብ እንዲችል የሰንጠረዡ መዋቅር
const TruckLeasor = mongoose.model('TruckLeasor', { 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    phone: String, 
    status: String,
    rentedCount: { type: Number, default: 0 } 
});

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

// --- 🧱 ሲሚንቶ ክፍል ---
const cementSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
    [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
]);

bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
    if (existing) {
        ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። የአሁኑ ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, cementSellerInline);
    } else {
        ctx.session.action = 'REG_CEMENT_1';
        ctx.reply('የሲሚንቶ አይነት ያስገቡ፡');
    }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => {
    ctx.session.action = 'BUY_CEMENT_1';
    ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?');
});

// --- 🚚 መኪና ክፍል (የተስተካከለ) ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const trucks = await TruckLeasor.find({ userId: ctx.from.id });
    
    // መኪና ከሌለው በቀጥታ ወደ ምዝገባ
    if (trucks.length === 0) {
        ctx.session.action = 'REG_TRUCK_1';
        ctx.session.truckData = {};
        return ctx.reply('ምንም የተመዘገበ መኪና የለዎትም። ለመመዝገብ የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }

    // መኪና ካለው በዝርዝር ያሳየዋል
    let msg = "የያዟቸው መኪናዎች ዝርዝር፦\nማስተዳደር የሚፈልጉትን መኪና ታርጋ ይጫኑ፡";
    const buttons = trucks.map(t => [
        Markup.button.callback(`🚚 ታርጋ፡ ${t.plate} (${t.status === 'active' ? '✅ አለ' : '❌ የለም'})`, `manage_truck_${t._id}`)
    ]);
    buttons.push([Markup.button.callback('➕ ሌላ አዲስ መኪና ጨምር', 'truck_re_reg')]);
    
    ctx.reply(msg, Markup.inlineKeyboard(buttons));
});

// ተጠቃሚው መኪናውን ሲመርጥ የሚመጡ ትንንሽ በተኖች (አለ፣ የለም፣ መስመር ቀይር)
bot.action(/manage_truck_(.+)/, async (ctx) => {
    const truckId = ctx.match;
    const truck = await TruckLeasor.findById(truckId);
    if (!truck) return ctx.answerCbQuery('መኪናው አልተገኘም!');

    const inline = Markup.inlineKeyboard([
        [
            Markup.button.callback('✅ አለ በል', `t_status_active_${truckId}`),
            Markup.button.callback('❌ የለም በል', `t_status_off_${truckId}`)
        ],
        [Markup.button.callback('🔄 የጉዞ መስመር ለመቀየር', `t_route_change_${truckId}`)]
    ]);

    ctx.reply(`የመኪና መረጃ፦\nአይነት፡ ${truck.type}\nታርጋ፡ ${truck.plate}\nመስመር፡ ${truck.route}\nሁኔታ፡ ${truck.status === 'active' ? '✅ አለ' : '❌ የለም'}\n\nምን ማድረግ ይፈልጋሉ?`, inline);
    ctx.answerCbQuery();
});

bot.hears('🚚 መኪና ለመከራየት', (ctx) => {
    ctx.session.action = 'RENT_TRUCK_1';
    ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?');
});

// --- 🟥 ብረት ክፍል ---
const steelSellerInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],
    [Markup.button.callback('💰 ዋጋ ለማሻሻል', 'steel_update_price')]
]);

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
const machineryLeasorInline = Markup.inlineKeyboard([
    [Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]
]);

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
    if (!ctx.session) ctx.session = {};
    const action = ctx.session.action;
    const text = ctx.message.text;
    const userId = ctx.from.id;

    if (!action) return;

    // ሲሚንቶ ምዝገባ ሎጂክ
    if (action === 'REG_CEMENT_1') {
        ctx.session.cementData = { type: text };
        ctx.session.action = 'REG_CEMENT_2';
        ctx.reply('2. ያለበት ቦታ ያስገቡ፡');
    } else if (action === 'REG_CEMENT_2') {
        ctx.session.cementData.location = text;
        ctx.session.action = 'REG_CEMENT_3';
        ctx.reply('3. የድርጅቱ ስም ያስገቡ፡');
    } else if (action === 'REG_CEMENT_3') {
        ctx.session.cementData.companyName = text;
        ctx.session.action = 'REG_CEMENT_4';
        ctx.reply('4. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_CEMENT_4') {
        ctx.session.cementData.phone = text;
        ctx.session.cementData.userId = userId;
        ctx.session.cementData.price = 1300; 
        ctx.session.cementData.status = 'active';
        await CementSeller.findOneAndUpdate({ userId }, ctx.session.cementData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('መረጃዎ በትክክል ተመዝግቧል! አሁን እርስዎ ቋሚ ደንበኛ ሆነዋል።', cementSellerInline);
    }
    else if (action === 'UPDATE_CEMENT_PRICE') {
        await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) });
        ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር በተሳካ ሁኔታ ተሻሽሏል!`);
        ctx.session.action = null;
    }

    // መኪና ምዝገባ ሎጂክ (የተስተካከለ)
    else if (action === 'REG_TRUCK_1') {
        ctx.session.truckData = { type: text };
        ctx.session.action = 'REG_TRUCK_2';
        ctx.reply('የመኪናው ታርጋ ያስገቡ፡');
    } else if (action === 'REG_TRUCK_2') {
        ctx.session.truckData.plate = text;
        ctx.session.action = 'REG_TRUCK_3';
        ctx.reply('የጉዞ መስመር ያስገቡ (ምሳሌ፡ ሀዋሳ አዳማ)፡');
    } else if (action === 'REG_TRUCK_3') {
        ctx.session.truckData.route = text;
        ctx.session.action = 'REG_TRUCK_4';
        ctx.reply('ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_TRUCK_4') {
        ctx.session.truckData.phone = text;
        ctx.session.truckData.userId = userId;
        ctx.session.truckData.status = 'active';
        ctx.session.truckData.rentedCount = 0; 
        
        // እዚህ ጋር በታርጋው ጭምር ቼክ ያደርጋል (አንድ ሰው ብዙ መኪና እንዲመዘግብ)
        await TruckLeasor.findOneAndUpdate(
            { userId: userId, plate: ctx.session.truckData.plate }, 
            ctx.session.truckData, 
            { upsert: true }
        );
        ctx.session.action = null;
        ctx.reply('መኪናዎ በትክክል ተመዝግቧል! ፈላጊ ሲኖር እናሳውቆታለን።');
    }
    else if (action.startsWith('CHANGE_ROUTE_FOR_')) {
        const truckId = action.split('_');
        await TruckLeasor.findByIdAndUpdate(truckId, { route: text });
        ctx.reply(`የመኪናው የጉዞ መስመር ወደ "${text}" በተሳካ ሁኔታ ተቀይሯል!`);
        ctx.session.action = null;
    }

    // ብረት ምዝገባ ሎጂክ
    else if (action === 'REG_STEEL_1') {
        ctx.session.steelData = { type: text };
        ctx.session.action = 'REG_STEEL_2';
        ctx.reply('2. ያሉበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_STEEL_2') {
        ctx.session.steelData.address = text;
        ctx.session.action = 'REG_STEEL_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_STEEL_3') {
        ctx.session.steelData.phone = text;
        ctx.session.steelData.action = 'REG_STEEL_4';
        ctx.reply('4. ዋጋ ያስገቡ፡');
    } else if (action === 'REG_STEEL_4') {
        ctx.session.steelData.price = text;
        ctx.session.steelData.userId = userId;
        ctx.session.steelData.status = 'active';
        await SteelSeller.findOneAndUpdate({ userId }, ctx.session.steelData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('የብረት መረጃዎ በተሳካ ሁኔታ ተመዝግቧል!', steelSellerInline);
    }

    // ማሽነሪ ምዝገባ ሎጂክ
    else if (action === 'REG_MACHINERY_1') {
        ctx.session.machineryData = { type: text };
        ctx.session.action = 'REG_MACHINERY_2';
        ctx.reply('2. የሚገኝበት አድራሻ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_2') {
        ctx.session.machineryData.address = text;
        ctx.session.action = 'REG_MACHINERY_3';
        ctx.reply('3. ስልክ ቁጥር ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_3') {
        ctx.session.machineryData.phone = text;
        ctx.session.machineryData.action = 'REG_MACHINERY_4';
        ctx.reply('4. የማሽነሪው የኪራይ ዋጋ ያስገቡ፡');
    } else if (action === 'REG_MACHINERY_4') {
        ctx.session.machineryData.price = text;
        ctx.session.machineryData.userId = userId;
        ctx.session.machineryData.status = 'active';
        await MachineryLeasor.findOneAndUpdate({ userId }, ctx.session.machineryData, { upsert: true });
        ctx.session.action = null;
        ctx.reply('ማሽነሪዎ በትክክል ተመዝግቧል!', machineryLeasorInline);
    }
});

// --- 🔘 የውስጥ በተኖች አሠራር (የተስተካከለ) ---

// የመኪና ሁኔታ 'active' የማድረጊያ
bot.action(/t_status_active_(.+)/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match, { status: 'active' });
    ctx.reply('የመኪናው ሁኔታ ወደ [✅ አለ] ተቀይሯል።');
    ctx.answerCbQuery();
});

// የመኪና ሁኔታ 'off' የማድረጊያ
bot.action(/t_status_off_(.+)/, async (ctx) => {
    await TruckLeasor.findByIdAndUpdate(ctx.match, { status: 'off' });
    ctx.reply('የመኪናው ሁኔታ ወደ [❌ የለም] ተቀይሯል።');
    ctx.answerCbQuery();
});

// የመኪና መስመር መቀየሪያ በተን
bot.action(/t_route_change_(.+)/, (ctx) => {
    const truckId = ctx.match;
    ctx.session.action = `CHANGE_ROUTE_FOR_${truckId}`;
    ctx.reply('እባክዎ አዲሱን የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ጎንደር)፡');
    ctx.answerCbQuery();
});

// አዲስ መኪና ለመጨመር በተን ሲጫን
bot.action('truck_re_reg', (ctx) => {
    ctx.session.action = 'REG_TRUCK_1';
    ctx.session.truckData = {};
    ctx.reply('የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    ctx.answerCbQuery();
});

// የሌሎች ምርቶች በተኖች (ሲሚንቶ፣ ብረት፣ ማሽነሪ)
bot.action('cement_active', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ሁኔታዎ ወደ [አለ] ተቀይሯል።'); ctx.answerCbQuery();
});
bot.action('cement_off', async (ctx) => {
    await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ሁኔታዎ ወደ [የለም] ተቀይሯል።'); ctx.answerCbQuery();
});
bot.action('cement_re_reg', (ctx) => {
    ctx.session.action = 'REG_CEMENT_1';
    ctx.reply('የሲሚንቶ አይነት ያስገቡ፡'); ctx.answerCbQuery();
});
bot.action('cement_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_CEMENT_PRICE';
    ctx.reply('አዲሱን የአንድ ኩንታል ዋጋ ያስገቡ፡'); ctx.answerCbQuery();
});

bot.action('steel_active', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('የብረት ምርትዎ ዝግጁ ተደርጓል።'); ctx.answerCbQuery();
});
bot.action('steel_off', async (ctx) => {
    await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('የብረት ምርትዎ [የለም] ተጓል።'); ctx.answerCbQuery();
});
bot.action('steel_update_price', (ctx) => {
    ctx.session.action = 'UPDATE_STEEL_PRICE';
    ctx.reply('አዲሱን የብረት ዋጋ ያስገቡ፡'); ctx.answerCbQuery();
});

bot.action('machinery_active', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' });
    ctx.reply('ማሽነሪዎ ዝግጁ ተደርጓል።'); ctx.answerCbQuery();
});
bot.action('machinery_off', async (ctx) => {
    await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' });
    ctx.reply('ማሽነሪዎ [የለም] ተደርጓል።'); ctx.answerCbQuery();
});

// --- 👑 አዲሱ የአድሚን መቆጣጠሪያ ፓናል (Admin Dashboard - የተስተካከለ) ---
bot.command('admin_panel', async (ctx) => {
    if (ctx.from.id !== 7423347375) { 
        return ctx.reply('ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!');
    }

    const trucks = await TruckLeasor.find({});
    if (trucks.length === 0) {
        return ctx.reply('👑 አድሚን፡ በዳታቤዝ ውስጥ የተመዘገበ ምንም መኪማ የለም።');
    }

    const buttons = trucks.map(truck => {
        return [
            Markup.button.callback(`🚚 ${truck.plate} (${truck.type})`, 'none'),
            Markup.button.callback('❌ ሰርዝ', `admin_del_${truck._id}`)
        ];
    });

    ctx.reply('👑 እንኳን ወደ አድሚን ማጥፊያ ፓናል በሰላም መጡ። ማጥፋት የሚፈልጉትን መኪና ❌ የሚለውን ይንኩ፡', Markup.inlineKeyboard(buttons));
});

// የ "❌ ሰርዝ" በተን (Regex ስህተቱ የተስተካከለበት)
bot.action(/^admin_del_(.+)$/, async (ctx) => {
    if (ctx.from.id !== 7423347375) { 
        return ctx.answerCbQuery('ፈቃድ የለዎትም!', { show_alert: true });
    }

    const truckId = ctx.match; // እዚህ ጋር ተጨምሯል!
    const deleted = await TruckLeasor.findByIdAndDelete(truckId);

    if (deleted) {
        ctx.answerCbQuery(`ታርጋ ${deleted.plate} ተሰርዟል!`);
        
        const remainingTrucks = await TruckLeasor.find({});
        if (remainingTrucks.length === 0) {
            return ctx.editMessageText('👑 አድሚን፡ ሁሉም መኪናዎች ከዳታቤዝ ላይ ተደምስሰዋል።');
        }

        const nextButtons = remainingTrucks.map(t => [
            Markup.button.callback(`🚚 ${t.plate} (${t.type})`, 'none'),
            Markup.button.callback('❌ ሰርዝ', `admin_del_${t._id}`)
        ]);

        ctx.editMessageText('👑 መኪናው በተሳካ ሁኔታ ተሰርዟል። የቀሩት ዝርዝር፡', Markup.inlineKeyboard(nextButtons));
    } else {
        ctx.answerCbQuery('ይህ መኪና በዳታቤዝ ውስጥ አልተገኘም!', { show_alert: true });
    }
});

bot.action('none', (ctx) => ctx.answerCbQuery());

// --- 🌐 Render ፖርት ማስከፈቻ የዌብ ሰርቨር ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Running with MongoDB connection!');
}).listen(PORT);

bot.launch().then(() => console.log('Simple Bot is alive on Render with Permanent DB!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
