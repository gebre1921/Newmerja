const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

// --- 🛠️ 1. ኮንፊግሬሽን ---
const rawToken = process.env.BOT_TOKEN;
const BOT_TOKEN = rawToken ? rawToken.trim().replace(/['"]/g, '') : undefined;
const MONGO_URI = process.env.MONGO_URI;

if (!BOT_TOKEN || !MONGO_URI) {
    console.error("ስህተት: BOT_TOKEN ወይም MONGO_URI በ Render Environment Variables ላይ አልተገኘም!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("ዳታቤዝ ተገናኝቷል!"))
    .catch(err => console.error("የዳታቤዝ ስህተት:", err));

const TruckLeasor = mongoose.model('TruckLeasor', { 
    userId: Number, type: String, plate: String, route: String, phone: String, status: String, rentedCount: { type: Number, default: 0 } 
});

const CementSeller = mongoose.model('CementSeller', { userId: Number, type: String, location: String, companyName: String, phone: String, price: Number, status: String });
const SteelSeller = mongoose.model('SteelSeller', { userId: Number, type: String, address: String, phone: String, price: String, status: String });
const MachineryLeasor = mongoose.model('MachineryLeasor', { userId: Number, type: String, address: String, phone: String, price: String, status: String });

const bot = new Telegraf(BOT_TOKEN);
const userSessions = {};
function getSession(userId) {
    if (!userSessions[userId]) userSessions[userId] = { action: null, cementData: {}, truckData: {}, steelData: {}, machineryData: {}, buyCement: {}, rentTruck: {}, buySteel: {}, rentMachinery: {}, editingTruckId: null };
    return userSessions[userId];
}

// --- ⚙️ የዩቲሊቲ ፈንክሽኖች (አዲሱ አስተማማኝ አሰራር) ---
async function renderSingleTruck(ctx, truckId) {
    const truck = await TruckLeasor.findById(truckId);
    if (!truck) return ctx.reply('ይህ መኪና አልተገኘም!');

    const statusText = truck.status === 'active' ? '✅ አለ (ለስራ ዝግጁ)' : '❌ የለም (ስራ ላይ/የተከራየ)';
    const toggleLabel = truck.status === 'active' ? '❌ ወደ [የለም] ቀይር' : '✅ ወደ [አለ] ቀይር';

    const text = `⚙️ **የመኪና ማስተዳደሪያ ሰሌዳ**\n\n• **የመኪና አይነት፦** ${truck.type}\n• **ታርጋ ቁጥር፦** \`${truck.plate}\`\n• **የጉዞ መስመር፦** ${truck.route}\n• **የአሁን ሁኔታ፦** ${statusText}`;
    
    const buttons = [
        [Markup.button.callback(toggleLabel, `t_tog_${truck._id}`)],
        [Markup.button.callback('🛣️ መስመር ለመቀየር', `t_rte_${truck._id}`), Markup.button.callback('🗑️ መኪናውን ሰርዝ', `t_del_${truck._id}`)],
        [Markup.button.callback('🔙 ወደ መኪናዎች ዝርዝር', 't_list')]
    ];

    // አሮጌውን መልዕክት እየሰረዝን አዲስ እንልካለን (ይህ ስህተትን ይከላከላል)
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showUserTrucks(ctx, userId, isEdit = false) {
    const trucks = await TruckLeasor.find({ userId });
    if (trucks.length > 0) {
        let textMsg = `📋 **የተመዘገቡ መኪናዎችዎ ዝርዝር**`;
        const buttons = trucks.map(t => [Markup.button.callback(`🚚 ታርጋ: ${t.plate} (${t.type})`, `t_view_${t._id}`)]);
        buttons.push([Markup.button.callback('➕ አዲስ መኪና መዝግብ', 'truck_re_reg')]);
        
        if (isEdit) { await ctx.deleteMessage().catch(() => {}); await ctx.reply(textMsg, Markup.inlineKeyboard(buttons)); }
        else await ctx.reply(textMsg, Markup.inlineKeyboard(buttons));
    } else {
        getSession(userId).action = 'REG_TRUCK_1';
        ctx.reply('የመኪና አይነት ያስገቡ፡');
    }
}

// --- 🤖 የቦት ትዕዛዞች ---
bot.start((ctx) => ctx.reply('እንኳን በደህና መጡ!', Markup.keyboard([['🚚 መኪና ለማከራየት']]).resize()));

bot.action(/^t_view_(.+)$/, async (ctx) => { await ctx.answerCbQuery(); await renderSingleTruck(ctx, ctx.match); });
bot.action('t_list', async (ctx) => { await ctx.answerCbQuery(); await showUserTrucks(ctx, ctx.from.id, true); });
bot.action(/^t_tog_(.+)$/, async (ctx) => {
    const truckId = ctx.match;
    const truck = await TruckLeasor.findById(truckId);
    if (truck) {
        const newStatus = truck.status === 'active' ? 'off' : 'active';
        await TruckLeasor.findByIdAndUpdate(truckId, { status: newStatus });
        await ctx.answerCbQuery(`ወደ ${newStatus} ተቀይሯል!`);
        await renderSingleTruck(ctx, truckId);
    }
});
bot.action(/^t_del_(.+)$/, async (ctx) => {
    await TruckLeasor.findByIdAndDelete(ctx.match);
    await ctx.answerCbQuery('ተሰርዟል!', { show_alert: true });
    await showUserTrucks(ctx, ctx.from.id, true);
});

bot.hears('🚚 መኪና ለማከራየት', (ctx) => showUserTrucks(ctx, ctx.from.id));

// --- 🌐 ሰርቨር ---
http.createServer((req, res) => res.end('Running')).listen(3000);
bot.launch().then(() => console.log('ቦቱ ተጀምሯል!'));
