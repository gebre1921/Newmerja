const { Telegraf, Markup } = require('telegraf');
const http = require('http');
const mongoose = require('mongoose');

const bot = new Telegraf(process.env.BOT_TOKEN);
mongoose.connect(process.env.MONGO_URI);

const TruckLeasor = mongoose.model('TruckLeasor', { 
    userId: Number, 
    type: String, 
    plate: String, 
    route: String, 
    status: String 
});

const userState = {};

// --- 🚚 መኪና ለማከራየት (ብዙ መኪና የሚፈቅድ) ---
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const trucks = await TruckLeasor.find({ userId: ctx.from.id });

    if (trucks.length > 0) {
        let msg = "የያዟቸው መኪናዎች ዝርዝር:\n";
        const buttons = [];
        
        trucks.forEach(t => {
            const statusIcon = t.status === 'active' ? '✅' : '❌';
            msg += `${statusIcon} ታርጋ: ${t.plate} - መስመር: ${t.route}\n`;
            buttons.push([Markup.button.callback(`${t.plate}: ${t.status === 'active' ? 'አጥፋ (❌)' : 'አንቃ (✅)'}`, `toggle_${t._id}`)]);
        });
        
        buttons.push([Markup.button.callback('➕ ሌላ መኪና ጨምር', 'add_new_truck')]);
        ctx.reply(msg, Markup.inlineKeyboard(buttons));
    } else {
        userState[ctx.from.id] = { action: 'REG_TRUCK_1' };
        ctx.reply('የመኪናውን አይነት ያስገቡ (ለምሳሌ፡ ሲኖትራክ)፡');
    }
});

// --- 🔄 መኪናን ማብራት/ማጥፋት ---
bot.action(/toggle_(.+)/, async (ctx) => {
    const truckId = ctx.match;
    const truck = await TruckLeasor.findById(truckId);
    
    const newStatus = truck.status === 'active' ? 'off' : 'active';
    await TruckLeasor.findByIdAndUpdate(truckId, { status: newStatus });
    
    ctx.answerCbQuery(`መኪናው አሁን ${newStatus === 'active' ? 'ለኪራይ ዝግጁ ነው' : 'ከዝርዝር ወጥቷል'}`);
    
    // መልዕክቱን ማደስ
    const trucks = await TruckLeasor.find({ userId: ctx.from.id });
    let msg = "የዘመነ ዝርዝር:\n";
    const buttons = trucks.map(t => [Markup.button.callback(`${t.plate}: ${t.status === 'active' ? 'አጥፋ (❌)' : 'አንቃ (✅)'}`, `toggle_${t._id}`)]);
    buttons.push([Markup.button.callback('➕ ሌላ መኪና ጨምር', 'add_new_truck')]);
    
    ctx.editMessageText(msg, Markup.inlineKeyboard(buttons));
});

// --- ➕ አዲስ መኪና መመዝገብ ---
bot.action('add_new_truck', (ctx) => {
    userState[ctx.from.id] = { action: 'REG_TRUCK_1' };
    ctx.reply('የአዲሱን መኪና አይነት ያስገቡ፡');
    ctx.answerCbQuery();
});

// --- 💬 የጽሁፍ ማቀናበሪያ (Text Handler) ---
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const state = userState[userId];
    if (!state || !state.action) return;

    if (state.action === 'REG_TRUCK_1') {
        state.type = ctx.message.text;
        state.action = 'REG_TRUCK_2';
        ctx.reply('ታርጋ ቁጥር ያስገቡ፡');
    } else if (state.action === 'REG_TRUCK_2') {
        state.plate = ctx.message.text;
        state.action = 'REG_TRUCK_3';
        ctx.reply('የጉዞ መስመር ያስገቡ፡');
    } else if (state.action === 'REG_TRUCK_3') {
        await TruckLeasor.create({ 
            userId, type: state.type, plate: state.plate, route: ctx.message.text, status: 'active' 
        });
        userState[userId] = { action: null };
        ctx.reply('አዲሱ መኪናዎ ተመዝግቧል!');
    }
});

// [እዚህ ላይ ሌሎቹ የሲሚንቶ እና ብረት ኮዶችዎን ያስገቡ]

bot.launch();
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot is Live!')).listen(PORT);
