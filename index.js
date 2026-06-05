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

// 1. ዋናው ሜኑ
const mainKeyboard = Markup.keyboard([
    ['🧱 ሲሚንቶ ለመሸጥ', '🧱 ሲሚንቶ ለመግዛት'],
    ['🚚 መኪና ለማከራየት', '🚚 መኪና ለመከራየት'],
    ['🟥 ብረት ለመሸጥ', '🟥 ብረት ለመግዛት'],
    ['🔹 ማሽነሪ ለማከራየት', '🔹 ማሽነሪ ለመከራየት']
]).resize();

bot.start((ctx) => ctx.reply('እንኳን በደህና መጡ! ምን ይፈልጋሉ?', mainKeyboard));

// 2. መኪና ለማከራየት (ብዙ መኪናዎችን ይዘረዝራል)
bot.hears('🚚 መኪና ለማከራየት', async (ctx) => {
    const trucks = await TruckLeasor.find({ userId: ctx.from.id });
    if (trucks.length === 0) {
        userState[ctx.from.id] = { action: 'REG_TRUCK_1' };
        return ctx.reply('ለመመዝገብ የመኪናውን አይነት ያስገቡ፡');
    }
    let msg = "የያዟቸው መኪናዎች:\n";
    const buttons = trucks.map(t => [
        Markup.button.callback(`${t.plate} (${t.status})`, `toggle_${t._id}`)
    ]);
    buttons.push([Markup.button.callback('➕ ሌላ መኪና ጨምር', 'add_new_truck')]);
    ctx.reply(msg, Markup.inlineKeyboard(buttons));
});

// 3. የአድሚን ፓናል
bot.command('admin_panel', async (ctx) => {
    const ADMIN_ID = 7423347375;
    if (ctx.from.id !== ADMIN_ID) return ctx.reply("ፈቃድ የለዎትም!");

    const trucks = await TruckLeasor.find({});
    if (trucks.length === 0) return ctx.reply("ምንም መኪና የለም።");

    const buttons = trucks.map(t => [
        Markup.button.callback(`❌ ሰርዝ: ${t.plate}`, `admin_del_${t._id}`)
    ]);
    ctx.reply("ማጥፋት የሚፈልጉትን መኪና ይምረጡ:", Markup.inlineKeyboard(buttons));
});

// 4. መስተጋብር (Toggle & Delete)
bot.action(/toggle_(.+)/, async (ctx) => {
    const id = ctx.match;
    const t = await TruckLeasor.findById(id);
    const newStatus = t.status === 'active' ? 'off' : 'active';
    await TruckLeasor.findByIdAndUpdate(id, { status: newStatus });
    ctx.answerCbQuery(`ሁኔታው ወደ ${newStatus} ተቀይሯል`);
    ctx.editMessageText(`መኪናው አሁን ${newStatus} ነው።`);
});

bot.action(/admin_del_(.+)/, async (ctx) => {
    await TruckLeasor.findByIdAndDelete(ctx.match);
    ctx.answerCbQuery("ተሰርዟል!");
    ctx.editMessageText("መኪናው ተሰርዟል።");
});

bot.action('add_new_truck', (ctx) => {
    userState[ctx.from.id] = { action: 'REG_TRUCK_1' };
    ctx.reply('የአዲሱን መኪና አይነት ያስገቡ፡');
});

// 5. የጽሁፍ ማቀናበሪያ
bot.on('text', async (ctx) => {
    const state = userState[ctx.from.id];
    if (!state) return;

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
            userId: ctx.from.id, type: state.type, plate: state.plate, route: ctx.message.text, status: 'active' 
        });
        userState[ctx.from.id] = { action: null };
        ctx.reply('ተመዝግቧል!');
    }
});

bot.launch();
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end('Bot is Live!')).listen(PORT);
