const { Telegraf, Markup } = require('telegraf');
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

// --- 📊 የዳታቤዝ ሰንጠረዦች መዋቅር (Database Models) ---
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

// 🛑 አስተማማኝ የሰሲሽን ማኔጀር
const userSessions = {};
function getSession(userId) {
    if (!userSessions[userId]) {
        userSessions[userId] = { action: null, cementData: {}, truckData: {}, steelData: {}, machineryData: {}, buyCement: {}, rentTruck: {}, buySteel: {}, rentMachinery: {}, editingTruckId: null };
    }
    return userSessions[userId];
}

// --- ⌨️ ዋና ሜኑ ---
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

bot.start((ctx) => {
    const session = getSession(ctx.from.id);
    session.action = null;
    ctx.reply('እንኳን ወደ Simple ቦት በሰላም መጡ! እባክዎ ከታች ካሉት አማራጮች አንዱን ይምረጡ።', mainKeyboard);
});

// --- 👑 1. የአድሚን መቆጣጠሪያ ፓናል ---
bot.command('admin_panel', async (ctx) => {
    const adminId = 7423347375; 
    if (ctx.from.id !== adminId) return ctx.reply(`⛔ ይቅርታ፣ ይህንን የአድሚን ትዕዛዝ ለመጠቀም ፈቃድ የለዎትም!`);

    try {
        const trucks = await TruckLeasor.find({});
        if (trucks.length === 0) return ctx.reply('👑 አድሚን፡ በዳታቤዝ ውስጥ ምንም የተመዘገበ መኪና የለም።');

        const buttons = trucks.map(truck => [
            Markup.button.callback(`📇 ታርጋ፦ ${truck.plate || 'የለም'} (${truck.type || 'FSR'})`, 'none'),
            Markup.button.callback('🗑️ ከአድሚን ሰርዝ', `del_a_${truck._id}`)
        ]);
        await ctx.reply('👑 የአድሚን መቆጣጠሪያ ፓናል\n\nከዳታቤዝ ሙሉ በሙሉ ማጥፋት የሚፈልጉትን መኪና ይምረጡ፡', Markup.inlineKeyboard(buttons));
    } catch (error) {
        ctx.reply("❌ ዳታቤዝ ላይ መረጃዎችን ማምጣት አልተቻለም።");
    }
});

// --- 🧱 2. የዋና ሜኑ ምርጫዎች (Hears) ---
bot.hears('🧱 ሲሚንቶ ለመሸጥ', async (ctx) => {
    const cementSellerInline = Markup.inlineKeyboard([
        [Markup.button.callback('✅ አለ', 'cement_active'), Markup.button.callback('❌ የለም', 'cement_off')],
        [Markup.button.callback('➕ አዲስ ለመመዝገብ', 'cement_re_reg'), Markup.button.callback('💰 ዋጋ ለማሻሻል', 'cement_update_price')]
    ]);
    const existing = await CementSeller.findOne({ userId: ctx.from.id });
    if (existing) ctx.reply(`አንተ ቀድሞውኑ የተመዘገብክ ቋሚ ደንበኛ ነህ። የአሁኑ ሁኔታህ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}\nምን ማድረግ ትፈልጋለህ?`, cementSellerInline);
    else { const session = getSession(ctx.from.id); session.action = 'REG_CEMENT_1'; ctx.reply('የሲሚንቶ አይነት ያስገቡ፡'); }
});

bot.hears('🧱 ሲሚንቶ ለመግዛት', (ctx) => { const session = getSession(ctx.from.id); session.action = 'BUY_CEMENT_1'; ctx.reply('1. ምን አይነት ሲሚንቶ ነው የሚፈልጉት?'); });

// 🚚 እጅግ የዘመነው የመኪና ማከራያ ክፍል
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    await showUserTrucks(ctx, ctx.from.id);
});

// የባለቤት መኪናዎችን ዝርዝር የሚያሳይ ፈንክሽን
async function showUserTrucks(ctx, userId, isEdit = false) {
    try {
        const trucks = await TruckLeasor.find({ userId });
        if (trucks.length > 0) {
            let textMsg = `📋 **የተመዘገቡ መኪናዎችዎ ዝርዝር**\n\nእባክዎ ማስተዳደር የሚፈልጉትን መኪና ታርጋ ቁጥር ከታች ይምረጡ፦`;
            const buttons = trucks.map(t => [Markup.button.callback(`🚚 ታርጋ: ${t.plate} (${t.type})`, `t_view_${t._id}`)]);
            buttons.push([Markup.button.callback('➕ አዲስ መኪና መዝግብ', 'truck_re_reg')]);

            if (isEdit) await ctx.editMessageText(textMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
            else await ctx.reply(textMsg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        } else {
            const session = getSession(userId);
            session.action = 'REG_TRUCK_1';
            await ctx.reply('ምን አይነት መኪና እንደሆነ ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
        }
    } catch (e) {
        ctx.reply("❌ መረጃ ማምጣት አልተቻለም።");
    }
}

bot.hears('🚚 መኪና ለመከራየት', (ctx) => { const session = getSession(ctx.from.id); session.action = 'RENT_TRUCK_1'; ctx.reply('1. ምን አይነት መኪና ይፈልጋሉ?'); });
bot.hears('🟥 ብረት ለመሸጥ', async (ctx) => { const steelSellerInline = Markup.inlineKeyboard([[Markup.button.callback('✅ አለ', 'steel_active'), Markup.button.callback('❌ የለም', 'steel_off')],[Markup.button.callback('💰 ዋጋ ለማሻሻል', 'steel_update_price')]]); const existing = await SteelSeller.findOne({ userId: ctx.from.id }); if (existing) ctx.reply(`ቀድሞውኑ የተመዘገቡ የብረት ሻጭ ነዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, steelSellerInline); else { const session = getSession(ctx.from.id); session.action = 'REG_STEEL_1'; ctx.reply('1. የብረት አይነቶችን ያስገቡ፡'); } });
bot.hears('🟥 ብረት ለመግዛት', (ctx) => { const session = getSession(ctx.from.id); session.action = 'BUY_STEEL_1'; ctx.reply('1. ምን አይነት ብረት ይፈልጋሉ?'); });
bot.hears('🔹 ማሽነሪ ለማከራየት', async (ctx) => { const machineryLeasorInline = Markup.inlineKeyboard([[Markup.button.callback('✅ አለ', 'machinery_active'), Markup.button.callback('❌ የለም', 'machinery_off')]]); const existing = await MachineryLeasor.findOne({ userId: ctx.from.id }); if (existing) ctx.reply(`ቀድሞውኑ የተመዘገበ ማሽነሪ አለዎት። ሁኔታ፡ ${existing.status === 'active' ? '✅ አለ' : '❌ የለም'}`, machineryLeasorInline); else { const session = getSession(ctx.from.id); session.action = 'REG_MACHINERY_1'; ctx.reply('1. የማሽነሪው አይነት ያስገቡ፡'); } });
bot.hears('🔹 ማሽነሪ ለመከራየት', (ctx) => { const session = getSession(ctx.from.id); session.action = 'RENT_MACHINERY_1'; ctx.reply('1. የሚፈልጉት የማሽነሪ አይነት ያስገቡ፡'); });

// --- 🔘 3. የውስጥ በተኖች አሠራር (Inline Callbacks) ---

// 👑 የአድሚን ስረዛ ማስተናገጃ
bot.action(/^del_a_(.+)$/, async (ctx) => {
    if (ctx.from.id !== 7423347375) return ctx.answerCbQuery('ፈቃድ የለዎትም!', { show_alert: true });
    try {
        const idParam = ctx.match;
        await TruckLeasor.findByIdAndDelete(idParam);
        await ctx.answerCbQuery(`መረጃው ከአድሚን ጠፍቷል!`, { show_alert: true });
        const remaining = await TruckLeasor.find({});
        if (remaining.length === 0) return ctx.editMessageText('👑 አድሚን፡ ሁሉም መኪናዎች አልቀዋል።');
        const nextButtons = remaining.map(t => [Markup.button.callback(`📇 ታርጋ፦ ${t.plate} (${t.type})`, 'none'), Markup.button.callback('🗑️ ከአድሚን ሰርዝ', `del_a_${t._id}`)]);
        await ctx.editMessageText('👑 መኪናው ጠፍቷል። የቀሩት ዝርዝር፦', Markup.inlineKeyboard(nextButtons));
    } catch (e) { await ctx.answerCbQuery('ማጥፋት አልተሳካም!', { show_alert: true }); }
});

// 🚚 የተወሰነ መኪናን የመምረጫ ሰሌዳ መመልከቻ (Single Truck View)
bot.action(/^t_view_(.+)$/, async (ctx) => {
    try {
        const truckId = ctx.match;
        const truck = await TruckLeasor.findById(truckId);
        if (!truck) return ctx.answerCbQuery('ይህ መኪና አልተገኘም!', { show_alert: true });

        const statusText = truck.status === 'active' ? '✅ አለ (ለስራ ዝግጁ)' : '❌ የለም (ስራ ላይ/የተከራየ)';
        const toggleLabel = truck.status === 'active' ? '❌ ወደ [የለም] ቀይር' : '✅ ወደ [አለ] ቀይር';

        const text = `⚙️ **የመኪና ማስተዳደሪያ ሰሌዳ**\n\n• **የመኪና አይነት፦** ${truck.type}\n• **ታርጋ ቁጥር፦** \`${truck.plate}\`\n• **የጉዞ መስመር፦** ${truck.route}\n• **የአሁን ሁኔታ፦** ${statusText}`;
        
        const buttons = [
            [Markup.button.callback(toggleLabel, `t_tog_${truck._id}`)],
            [Markup.button.callback('🛣️ መስመር ለመቀየር', `t_rte_${truck._id}`), Markup.button.callback('🗑️ መኪናውን ሰርዝ', `t_del_${truck._id}`)],
            [Markup.button.callback('🔙 ወደ መኪናዎች ዝርዝር', 't_list')]
        ];

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        ctx.answerCbQuery();
    } catch (e) { ctx.answerCbQuery('ስህተት ተፈጥሯል!'); }
});

// የባለቤት መኪናዎች ዝርዝር መመለሻ
bot.action('t_list', async (ctx) => { await showUserTrucks(ctx, ctx.from.id, true); ctx.answerCbQuery(); });

// የአንድን የተወሰነ መኪና ሁኔታ (Active/Off) የመቀያየሪያ ቁልፍ
bot.action(/^t_tog_(.+)$/, async (ctx) => {
    try {
        const truckId = ctx.match;
        const truck = await TruckLeasor.findById(truckId);
        if (!truck) return ctx.answerCbQuery('መኪናው አልተገኘም!');
        
        const newStatus = truck.status === 'active' ? 'off' : 'active';
        await TruckLeasor.findByIdAndUpdate(truckId, { status: newStatus });
        
        await ctx.answerCbQuery(`ሁኔታው ወደ [${newStatus === 'active' ? 'አለ' : 'የለም'}] ተቀይሯል!`);
        // ገጹን በራሱ ሰዓት Refresh ለማድረግ ተመሳሳዩን ገጽ በድጋሚ እንጠራዋለን
        ctx.match = truckId;
        bot.handleUpdate(ctx); 
    } catch (e) { ctx.answerCbQuery('መቀየር አልተቻለም!'); }
});

// የአንድን የተወሰነ መኪና መስመር ለመቀየር ትዕዛዝ መቀበያ
bot.action(/^t_rte_(.+)$/, async (ctx) => {
    const truckId = ctx.match;
    const session = getSession(ctx.from.id);
    session.editingTruckId = truckId; // የትኛውን መኪና እየቀየርን እንደሆነ ሴሽን ላይ እንይዛለን
    session.action = 'CONFIRM_TRUCK_ROUTE';
    await ctx.reply('እባክዎ ለዚህ መኪና አዲሱን የጉዞ መስመር ያስገቡ (ምሳሌ፡ ከአዲስ አበባ ወደ ናዝሬት)፦');
    ctx.answerCbQuery();
});

// ባለቤቱ የራሱን መኪና ብቻ እንዲሰርዝ ማድረጊያ
bot.action(/^t_del_(.+)$/, async (ctx) => {
    try {
        const truckId = ctx.match;
        await TruckLeasor.findByIdAndDelete(truckId);
        await ctx.answerCbQuery('መኪናው በተሳካ ሁኔታ ከዝርዝርዎ ላይ ተሰርዟል!', { show_alert: true });
        await showUserTrucks(ctx, ctx.from.id, true);
    } catch (e) { ctx.answerCbQuery('መሰረዝ አልተቻለም!'); }
});

bot.action('none', (ctx) => ctx.answerCbQuery());
bot.action('cement_active', async (ctx) => { await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('ሁኔታዎ ወደ [አለ] ተቀይሯል።'); ctx.answerCbQuery(); });
bot.action('cement_off', async (ctx) => { await CementSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('ሁኔታዎ ወደ [የለም] ተቀይሯል።'); ctx.answerCbQuery(); });
bot.action('cement_re_reg', (ctx) => { const session = getSession(ctx.from.id); session.action = 'REG_CEMENT_1'; ctx.reply('የሲሚንቶ አይነት ያስገቡ፡'); ctx.answerCbQuery(); });
bot.action('cement_update_price', (ctx) => { const session = getSession(ctx.from.id); session.action = 'UPDATE_CEMENT_PRICE'; ctx.reply('አዲሱን የአንድ ኩንታል ዋጋ ያስገቡ፡'); ctx.answerCbQuery(); });
bot.action('truck_re_reg', (ctx) => { const session = getSession(ctx.from.id); session.action = 'REG_TRUCK_1'; ctx.reply('ምን አይነት መኪና እንደሆነ ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡'); ctx.answerCbQuery(); });
bot.action('steel_active', async (ctx) => { await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('የብረት ምርትዎ ዝግጁ ተደርጓል።'); ctx.answerCbQuery(); });
bot.action('steel_off', async (ctx) => { await SteelSeller.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('የብረት ምርትዎ [የለም] ተደርጓል።'); ctx.answerCbQuery(); });
bot.action('steel_update_price', (ctx) => { const session = getSession(ctx.from.id); session.action = 'UPDATE_STEEL_PRICE'; ctx.reply('አዲሱን የብረት ዋጋ ያስገቡ፡'); ctx.answerCbQuery(); });
bot.action('machinery_active', async (ctx) => { await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'active' }); ctx.reply('ማሽነሪዎ ዝግጁ ተደርጓል።'); ctx.answerCbQuery(); });
bot.action('machinery_off', async (ctx) => { await MachineryLeasor.findOneAndUpdate({ userId: ctx.from.id }, { status: 'off' }); ctx.reply('ማሽነሪዎ [የለም] ተደርጓል።'); ctx.answerCbQuery(); });

// --- 💬 4. የፅሁፍ መልዕክቶች ማቀናበሪያ (Text Handler) ---
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = ctx.from.id;
    const session = getSession(userId);

    if (text.startsWith('/')) { session.action = null; return next(); }

    const mainButtons = ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት', '🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት', '🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት', '🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት'];
    if (mainButtons.includes(text)) { session.action = null; return next(); }

    const action = session.action;
    if (!action) return;

    if (action === 'REG_CEMENT_1') { session.cementData = { type: text }; session.action = 'REG_CEMENT_2'; ctx.reply('2. ያለበት ቦታ ያስገቡ፡'); }
    else if (action === 'REG_CEMENT_2') { session.cementData.location = text; session.action = 'REG_CEMENT_3'; ctx.reply('3. የድርጅቱ ስም ያስገቡ፡'); }
    else if (action === 'REG_CEMENT_3') { session.cementData.companyName = text; session.action = 'REG_CEMENT_4'; ctx.reply('4. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'REG_CEMENT_4') { session.cementData.phone = text; session.cementData.userId = userId; session.cementData.price = 1300; session.cementData.status = 'active'; await CementSeller.findOneAndUpdate({ userId }, session.cementData, { upsert: true }); session.action = null; ctx.reply('መረጃዎ በትክክል ተመዝግቧል!'); }
    else if (action === 'UPDATE_CEMENT_PRICE') { await CementSeller.findOneAndUpdate({ userId }, { price: Number(text) }); ctx.reply(`የሲሚንቶ ዋጋ ወደ ${text} ብር ተሻሽሏል!`); session.action = null; }
    else if (action === 'BUY_CEMENT_1') { session.buyCement = { type: text }; session.action = 'BUY_CEMENT_2'; ctx.reply('2. አድራሻ ያስገቡ፡'); }
    else if (action === 'BUY_CEMENT_2') { session.buyCement.address = text; session.action = 'BUY_CEMENT_3'; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'BUY_CEMENT_3') { const available = await CementSeller.findOne({ type: new RegExp(session.buyCement.type, 'i'), status: 'active' }); if (available) { ctx.reply(`እኛ ጋር ይገኛል\nየአሁን ዋጋ፡ ${available.price} ብር\nበ 0960336138 ይደውሉ`); } else { ctx.reply('የጠየቁት የሲሚንቶ አይነት የለም'); } session.action = null; }

    // 🚚 አዲስ የመኪና ምዝገባ ሂደት
    else if (action === 'REG_TRUCK_1') { session.truckData = { type: text }; session.action = 'REG_TRUCK_2'; ctx.reply('የመኪናው ታርጋ ያስገቡ፡'); }
    else if (action === 'REG_TRUCK_2') { session.truckData.plate = text; session.action = 'REG_TRUCK_3'; ctx.reply('የጉዞ መስመር ያስገቡ (ምሳሌ፡ ሀዋሳ አዳማ)፡'); }
    else if (action === 'REG_TRUCK_3') { session.truckData.route = text; session.action = 'REG_TRUCK_4'; ctx.reply('ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'REG_TRUCK_4') { 
        session.truckData.phone = text; 
        session.truckData.userId = userId; 
        session.truckData.status = 'active'; 
        
        const exist = await TruckLeasor.findOne({ plate: session.truckData.plate });
        if (!exist) session.truckData.rentedCount = 0;

        await TruckLeasor.findOneAndUpdate({ plate: session.truckData.plate }, session.truckData, { upsert: true }); 
        session.action = null; 
        ctx.reply('መረጃዎ በትክክል ደርሶናል!'); 
        await showUserTrucks(ctx, userId);
    }
    // 🛣️ የተወሰነ መኪና ላይ ብቻ መስመር መቀየሪያ የፅሁፍ ማስተናገጃ
    else if (action === 'CONFIRM_TRUCK_ROUTE') {
        if (session.editingTruckId) {
            const updated = await TruckLeasor.findByIdAndUpdate(session.editingTruckId, { route: text });
            if (updated) ctx.reply(`የታርጋ ቁጥር ${updated.plate} የጉዞ መስመር ወደ "${text}" ተቀይሯል!`);
            else ctx.reply('ይህንን መኪና ማሻሻል አልተቻለም።');
        }
        session.editingTruckId = null;
        session.action = null;
    }
    // 🔀 ፍትሃዊ አከፋፈል (Fair Matching Algorithm)
    else if (action === 'RENT_TRUCK_1') { session.rentTruck = { type: text }; session.action = 'RENT_TRUCK_2'; ctx.reply('2. የጉዞ መስመር ያስገቡ፡'); }
    else if (action === 'RENT_TRUCK_2') { session.rentTruck.route = text; session.action = 'RENT_TRUCK_3'; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'RENT_TRUCK_3') { 
        const cleanRoute = session.rentTruck.route.toLowerCase();
        let searchRegex = (cleanRoute.includes("gondar") || cleanRoute.includes("ጎንደር")) ? new RegExp("(gondar|ጎንደር)", "i") : new RegExp(session.rentTruck.route, "i");
        
        const foundTruck = await TruckLeasor.findOne({ type: new RegExp(session.rentTruck.type, 'i'), route: searchRegex, status: 'active' }).sort({ rentedCount: 1, _id: 1 });
        
        if (foundTruck) { 
            ctx.reply(`የሚፈልጉት መኪና ይገኛል!\nአይነት፡ ${foundTruck.type}\nታርጋ፡ ${foundTruck.plate}\nበ 0960336138 ይደውሉልን`); 
            await TruckLeasor.findByIdAndUpdate(foundTruck._id, { $inc: { rentedCount: 1 } }); 
        } else { 
            ctx.reply('በዚህ መስመር የሚጓዝ መኪና የለም'); 
        }
        session.action = null; 
    }

    else if (action === 'REG_STEEL_1') { session.steelData = { type: text }; session.action = 'REG_STEEL_2'; ctx.reply('2. አድራሻ ያስገቡ፡'); }
    else if (action === 'REG_STEEL_2') { session.steelData.address = text; session.action = 'REG_STEEL_3'; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'REG_STEEL_3') { session.steelData.phone = text; session.steelData.action = 'REG_STEEL_4'; ctx.reply('4. ዋጋ ያስገቡ፡'); }
    else if (action === 'REG_STEEL_4') { session.steelData.price = text; session.steelData.userId = userId; session.steelData.status = 'active'; await SteelSeller.findOneAndUpdate({ userId }, session.steelData, { upsert: true }); session.action = null; ctx.reply('የብረት መረጃዎ ተመዝግቧል!'); }
    else if (action === 'UPDATE_STEEL_PRICE') { await SteelSeller.findOneAndUpdate({ userId }, { price: text }); ctx.reply(`ዋጋ ወደ ${text} ብር ተሻሽሏል!`); session.action = null; }
    else if (action === 'BUY_STEEL_1') { session.buySteel = { type: text }; session.action = 'BUY_STEEL_2'; ctx.reply('2. አድራሻ ያስገቡ፡'); }
    else if (action === 'BUY_STEEL_2') { session.buySteel.address = text; session.action = 'BUY_STEEL_3'; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'BUY_STEEL_3') { const available = await SteelSeller.findOne({ type: new RegExp(session.buySteel.type, 'i'), status: 'active' }); if (available) { ctx.reply('ብረቱ ይገኛል በ 0960336138 ይደውሉ'); } else { ctx.reply('ብረቱ የለም'); } session.action = null; }

    else if (action === 'REG_MACHINERY_1') { session.machineryData = { type: text }; session.action = 'REG_MACHINERY_2'; ctx.reply('2. አድራሻ ያስገቡ፡'); }
    else if (action === 'REG_MACHINERY_2') { session.machineryData.address = text; session.action = 'REG_MACHINERY_3'; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'REG_MACHINERY_3') { session.machineryData.phone = text; session.machineryData.action = 'REG_MACHINERY_4'; ctx.reply('4. ዋጋ ያስገቡ፡'); }
    else if (action === 'REG_MACHINERY_4') { session.machineryData.price = text; session.machineryData.userId = userId; session.machineryData.status = 'active'; await MachineryLeasor.findOneAndUpdate({ userId }, session.machineryData, { upsert: true }); session.action = null; ctx.reply('ማሽነሪዎ ተመዝግቧል!'); }
    else if (action === 'RENT_MACHINERY_1') { session.rentMachinery = { type: text }; session.action = 'RENT_MACHINERY_2'; ctx.reply('2. አድራሻ ያስገቡ፡'); }
    else if (action === 'RENT_MACHINERY_2') { session.rentMachinery.address = text; session.rentMachinery.userId = userId; ctx.reply('3. ስልክ ቁጥር ያስገቡ፡'); }
    else if (action === 'RENT_MACHINERY_3') { const available = await MachineryLeasor.findOne({ type: new RegExp(session.rentMachinery.type, 'i'), status: 'active' }); if (available) { ctx.reply('ማሽነሪው ይገኛል በ0960336138 ይደውሉ'); } else { ctx.reply('ማሽነሪው አይገኝም'); } session.action = null; }
});

// --- 🌐 Render የዌብ ሰርቨር ፖርት ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is Running!');
}).listen(PORT);

bot.launch().then(() => console.log('Bot is alive on Render!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
