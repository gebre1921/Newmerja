<!DOCTYPE html>
<html lang="am">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Simple Marketplace Bot — መመሪያ</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Ethiopic:wght@300;400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');

  :root {
    --bg:        #0d0f14;
    --surface:   #161a23;
    --card:      #1c2130;
    --border:    #2a3347;
    --accent:    #4f8ef7;
    --accent2:   #34d39a;
    --warn:      #f7a24f;
    --danger:    #f75f5f;
    --text:      #e8ecf4;
    --muted:     #7a8499;
    --cement:    #d4a84b;
    --steel:     #e05c5c;
    --machinery: #5b9cf7;
    --truck:     #52c97a;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Noto Sans Ethiopic', sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* ── HERO ── */
  .hero {
    position: relative;
    padding: 60px 24px 48px;
    text-align: center;
    overflow: hidden;
  }
  .hero::before {
    content: '';
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 80% 60% at 50% 0%, rgba(79,142,247,.18) 0%, transparent 70%),
      radial-gradient(ellipse 50% 40% at 80% 80%, rgba(52,211,154,.1) 0%, transparent 60%);
    pointer-events: none;
  }
  .hero-icon { font-size: 52px; margin-bottom: 12px; display: block; animation: float 3s ease-in-out infinite; }
  @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }

  .hero h1 {
    font-size: clamp(1.6rem, 5vw, 2.6rem);
    font-weight: 700;
    letter-spacing: -.5px;
    line-height: 1.2;
    margin-bottom: 10px;
  }
  .hero h1 span { color: var(--accent); }
  .hero p { color: var(--muted); font-size: .95rem; max-width: 480px; margin: 0 auto; }

  .badge-row {
    display: flex; flex-wrap: wrap; gap: 8px;
    justify-content: center; margin-top: 20px;
  }
  .badge {
    font-size: .75rem; padding: 4px 12px; border-radius: 99px;
    border: 1px solid; font-weight: 600;
  }
  .badge.cement   { color: var(--cement);    border-color: var(--cement);    background: rgba(212,168,75,.08); }
  .badge.steel    { color: var(--steel);     border-color: var(--steel);     background: rgba(224,92,92,.08); }
  .badge.mach     { color: var(--machinery); border-color: var(--machinery); background: rgba(91,156,247,.08); }
  .badge.truck    { color: var(--truck);     border-color: var(--truck);     background: rgba(82,201,122,.08); }

  /* ── NAV TABS ── */
  .tabs {
    display: flex; gap: 6px; overflow-x: auto; padding: 0 16px 0;
    justify-content: center; flex-wrap: wrap;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab {
    padding: 9px 18px; border-radius: 8px; cursor: pointer;
    background: var(--surface); border: 1px solid var(--border);
    font-size: .85rem; color: var(--muted); transition: all .2s;
    white-space: nowrap;
  }
  .tab.active, .tab:hover {
    background: var(--accent); border-color: var(--accent);
    color: #fff;
  }
  .tab.cement.active  { background: var(--cement);    border-color: var(--cement); }
  .tab.steel.active   { background: var(--steel);     border-color: var(--steel); }
  .tab.mach.active    { background: var(--machinery); border-color: var(--machinery); }
  .tab.truck.active   { background: var(--truck);     border-color: var(--truck); }

  /* ── CONTENT PANELS ── */
  .panels { padding: 24px 16px 60px; max-width: 700px; margin: 0 auto; }
  .panel { display: none; animation: fadeUp .3s ease; }
  .panel.active { display: block; }
  @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }

  /* ── SECTION LABEL ── */
  .section-label {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 20px;
  }
  .section-label .icon { font-size: 1.8rem; }
  .section-label h2 { font-size: 1.25rem; font-weight: 700; }
  .section-label p  { font-size: .82rem; color: var(--muted); }

  /* ── ROLE SWITCH ── */
  .role-switch {
    display: flex; gap: 0; border: 1px solid var(--border);
    border-radius: 10px; overflow: hidden; margin-bottom: 24px;
  }
  .role-btn {
    flex: 1; padding: 10px 6px; text-align: center; cursor: pointer;
    font-size: .82rem; color: var(--muted); background: var(--surface);
    transition: all .2s; border: none; font-family: inherit;
  }
  .role-btn.active { background: var(--card); color: var(--text); font-weight: 600; }

  /* ── STEPS ── */
  .steps { display: flex; flex-direction: column; gap: 14px; }
  .step {
    display: flex; gap: 14px; align-items: flex-start;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px;
    transition: border-color .2s;
  }
  .step:hover { border-color: var(--accent); }
  .step-num {
    min-width: 32px; height: 32px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: .8rem; font-weight: 700; flex-shrink: 0;
  }
  .step-num.cement   { background: var(--cement); }
  .step-num.steel    { background: var(--steel); }
  .step-num.mach     { background: var(--machinery); }
  .step-num.truck    { background: var(--truck); }

  .step-body h3 { font-size: .92rem; font-weight: 600; margin-bottom: 4px; }
  .step-body p  { font-size: .82rem; color: var(--muted); line-height: 1.55; }

  /* ── TIP BOXES ── */
  .tip {
    display: flex; gap: 12px; align-items: flex-start;
    background: rgba(79,142,247,.08); border: 1px solid rgba(79,142,247,.25);
    border-radius: 10px; padding: 14px; margin-top: 18px;
    font-size: .82rem; line-height: 1.55;
  }
  .tip .tip-icon { font-size: 1.2rem; flex-shrink: 0; }

  .warn-tip {
    background: rgba(247,162,79,.08); border-color: rgba(247,162,79,.3);
  }
  .success-tip {
    background: rgba(52,211,154,.08); border-color: rgba(52,211,154,.3);
  }

  /* ── CHAT BUBBLE MOCKUP ── */
  .chat-demo {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px; margin-top: 18px;
  }
  .chat-demo .demo-title {
    font-size: .72rem; text-transform: uppercase; letter-spacing: 1px;
    color: var(--muted); margin-bottom: 12px;
  }
  .bubble {
    max-width: 80%; padding: 9px 14px; border-radius: 16px;
    font-size: .82rem; margin-bottom: 8px; line-height: 1.5;
  }
  .bubble.bot {
    background: var(--card); border-bottom-left-radius: 4px;
    border: 1px solid var(--border);
  }
  .bubble.user {
    background: var(--accent); color: #fff;
    margin-left: auto; border-bottom-right-radius: 4px;
  }
  .bubble.btn-row {
    background: none; border: none; padding: 0;
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .btn-chip {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 6px 12px; font-size: .76rem;
    cursor: default;
  }

  /* ── STATUS LEGEND ── */
  .legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
  .legend-item {
    display: flex; align-items: center; gap: 8px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 8px; padding: 8px 14px; font-size: .8rem;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .dot.green  { background: #34d39a; }
  .dot.red    { background: #f75f5f; }
  .dot.yellow { background: #f7a24f; }

  /* ── OVERVIEW GRID ── */
  .overview-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
    margin-top: 4px;
  }
  @media(max-width:480px){ .overview-grid { grid-template-columns: 1fr; } }
  .ov-card {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 18px 16px; cursor: pointer;
    transition: border-color .2s, transform .2s;
  }
  .ov-card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .ov-card .ov-icon { font-size: 1.8rem; margin-bottom: 8px; display: block; }
  .ov-card h3 { font-size: .95rem; font-weight: 700; margin-bottom: 4px; }
  .ov-card p  { font-size: .78rem; color: var(--muted); line-height: 1.5; }
  .ov-card.cement   { border-top: 3px solid var(--cement); }
  .ov-card.steel    { border-top: 3px solid var(--steel); }
  .ov-card.mach     { border-top: 3px solid var(--machinery); }
  .ov-card.truck    { border-top: 3px solid var(--truck); }

  /* ── DIVIDER ── */
  .divider {
    border: none; border-top: 1px solid var(--border);
    margin: 20px 0;
  }

  /* ── ADMIN SECTION ── */
  .admin-card {
    background: linear-gradient(135deg, rgba(79,142,247,.12), rgba(52,211,154,.06));
    border: 1px solid rgba(79,142,247,.3); border-radius: 12px; padding: 18px;
    margin-bottom: 14px;
  }
  .admin-card h3 { font-size: .95rem; font-weight: 700; margin-bottom: 8px; }
  .admin-card ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .admin-card ul li { font-size: .82rem; color: var(--muted); }
  .admin-card ul li::before { content: '▸ '; color: var(--accent); }

  .mono {
    font-family: 'JetBrains Mono', monospace;
    background: rgba(255,255,255,.06); border-radius: 6px;
    padding: 2px 7px; font-size: .8rem;
  }

  /* ── FOOTER ── */
  footer {
    text-align: center; padding: 30px 16px;
    font-size: .76rem; color: var(--muted);
    border-top: 1px solid var(--border);
  }
  footer strong { color: var(--text); }
</style>
</head>
<body>

<!-- HERO -->
<div class="hero">
  <span class="hero-icon">🏗️</span>
  <h1>Simple <span>Marketplace</span> Bot</h1>
  <p>ሲሚንቶ · ብረት · ማሽነሪ · ትራክ — ሙሉ የተጠቃሚ መመሪያ</p>
  <div class="badge-row">
    <span class="badge cement">🧱 ሲሚንቶ</span>
    <span class="badge steel">🟥 ብረት</span>
    <span class="badge mach">🔹 ማሽነሪ</span>
    <span class="badge truck">🚚 ትራክ</span>
  </div>
</div>

<!-- TABS -->
<div class="tabs" id="tabs">
  <div class="tab active" onclick="showPanel('overview')">🏠 አጠቃላይ</div>
  <div class="tab cement" onclick="showPanel('cement')">🧱 ሲሚንቶ</div>
  <div class="tab steel" onclick="showPanel('steel')">🟥 ብረት</div>
  <div class="tab mach" onclick="showPanel('mach')">🔹 ማሽነሪ</div>
  <div class="tab truck" onclick="showPanel('truck')">🚚 ትራክ</div>
  <div class="tab" onclick="showPanel('admin')">🔧 አድሚን</div>
</div>

<!-- PANELS -->
<div class="panels">

  <!-- ══════════ OVERVIEW ══════════ -->
  <div class="panel active" id="panel-overview">
    <div class="section-label">
      <span class="icon">🏠</span>
      <div>
        <h2>Bot አጠቃቀም — አጠቃላይ ማብራሪያ</h2>
        <p>ከዚህ ዝርዝር ውስጥ ፈልጎ ለማግኘት ቀላል ነው</p>
      </div>
    </div>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <h3>Bot ይጀምሩ — <span class="mono">/start</span></h3>
          <p>Bot ሲከፈቱ <strong>/start</strong> ይምቱ። ዋናው ምናሌ (keyboard) ታች ይታያል። ከዚያ ምን ማድረግ እንደሚፈልጉ ይምረጡ።</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <h3>ሻጭ ወይም ፈላጊ ይሁኑ</h3>
          <p>
            <strong>ለሻጭ/አከራይ:</strong> "ለመሸጥ" ወይም "ለማከራየት" የሚሉ ቁልፎችን ይምረጡ — ምዝገባ ይፈጥሩ።<br><br>
            <strong>ለፈላጊ/ተከራይ:</strong> "ለመግዛት" ወይም "ለመከራየት" ይምረጡ — ዝርዝር ወዲያው ይታያቸዋል።
          </p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <h3>ደረጃ በደረጃ ይሙሉ</h3>
          <p>Bot ጥያቄ ሲጠይቅ አንድ አንድ ይምረጡ ወይም ይጻፉ። ምዝገባ ብዙ ደረጃዎች አሉት — ፈጣን ነው።</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-body">
          <h3>ሁኔታ ያዘምኑ</h3>
          <p>ዕቃ ካለ ✅ <strong>አለ</strong>፣ ካለቀ ❌ <strong>የለም</strong> ይምቱ። ዋጋ ለመቀየር 💰 <strong>ዋጋ ቀይር</strong> ይምቱ።</p>
        </div>
      </div>
    </div>

    <div class="tip success-tip" style="margin-top:20px">
      <span class="tip-icon">✅</span>
      <div>ምዝገባ ከጨረሱ ወዲያው ለፈላጊዎች ይታያል! ሁኔታ (አለ/የለም) ማዘመን ብቻ አይርሱ።</div>
    </div>

    <hr class="divider">

    <p style="font-size:.85rem; color:var(--muted); margin-bottom:14px">ምን ምን አለ? — ዘርፍ ይምረጡ ለዝርዝር:</p>
    <div class="overview-grid">
      <div class="ov-card cement" onclick="showPanel('cement')">
        <span class="ov-icon">🧱</span>
        <h3>ሲሚንቶ</h3>
        <p>ዳንጎቴ፣ ድሬ፣ ናሽናል፣ ሙገር… ለመሸጥ እና ለመግዛት</p>
      </div>
      <div class="ov-card steel" onclick="showPanel('steel')">
        <span class="ov-icon">🟥</span>
        <h3>ብረት</h3>
        <p>ባለ 8፣ 10፣ 12፣ 14፣ 16 — ሁሉም መጠኖች</p>
      </div>
      <div class="ov-card mach" onclick="showPanel('mach')">
        <span class="ov-icon">🔹</span>
        <h3>ማሽነሪ</h3>
        <p>ኤክስካቫተር፣ ቡልዶዘር፣ ክሬን… ለማከራየት/ለመከራየት</p>
      </div>
      <div class="ov-card truck" onclick="showPanel('truck')">
        <span class="ov-icon">🚚</span>
        <h3>ትራክ</h3>
        <p>ዳምፕ፣ ተሳቢ፣ ታንከር፣ ካርጎ… ሁሉም መስመሮች</p>
      </div>
    </div>

    <div class="tip warn-tip" style="margin-top:20px">
      <span class="tip-icon">📞</span>
      <div>ምንም ችግር ካጋጠምዎ ድጋፍ ያግኙ — <strong>📞 ድጋፍ / Support</strong> ቁልፍ ይምቱ ወይም ቀጥታ ይደውሉ።</div>
    </div>
  </div>

  <!-- ══════════ CEMENT ══════════ -->
  <div class="panel" id="panel-cement">
    <div class="section-label">
      <span class="icon">🧱</span>
      <div>
        <h2>ሲሚንቶ</h2>
        <p>ለሻጮች እና ለፈላጊዎች ሙሉ መምሪያ</p>
      </div>
    </div>

    <!-- Role switch -->
    <div class="role-switch">
      <button class="role-btn active" id="cem-sell-btn" onclick="switchRole('cement','sell')">🏪 ሲሚንቶ ለመሸጥ</button>
      <button class="role-btn" id="cem-buy-btn" onclick="switchRole('cement','buy')">🛒 ሲሚንቶ ለመግዛት</button>
    </div>

    <!-- SELL -->
    <div id="cement-sell">
      <div class="steps">
        <div class="step">
          <div class="step-num cement">1</div>
          <div class="step-body">
            <h3>🧱 ሲሚንቶ ለመሸጥ → ይምረጡ</h3>
            <p>ዋናው ምናሌ ላይ <strong>"🧱 ሲሚንቶ ለመሸጥ"</strong> ቁልፍ ይምቱ። ቀደም ሲል ምዝገባ ካለዎ ወዲያው ይታያል — ለማዘመን ቁልፎቹን ይጠቀሙ። ምዝገባ ከሌለ ወደ ምዝገባ ሂደት ይሄዳሉ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">2</div>
          <div class="step-body">
            <h3>የሲሚንቶ አይነት ይምረጡ <span style="color:var(--muted)">[1/5]</span></h3>
            <p>ዳንጎቴ፣ ድሬ፣ ናሽናል፣ ሙገር፣ ደርባ ወይም ሌላ — ከቁልፎቹ ይምረጡ። "ሌላ" ከመረጡ ስም ጽፈው ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">3</div>
          <div class="step-body">
            <h3>ቦታ ይምረጡ <span style="color:var(--muted)">[2/5]</span></h3>
            <p>ሲሚንቶው ያለበትን ቦታ ዝርዝሩ ውስጥ ይምረጡ። አዲስ አበባ፣ ሀዋሳ፣ ባህርዳር… ሌሎችም አሉ። ቦታዎ ካልተገኘ "ሌላ" ምርጠው ጽፈው ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">4</div>
          <div class="step-body">
            <h3>የድርጅት ስም ያስገቡ <span style="color:var(--muted)">[3/5]</span></h3>
            <p>የሚሸጡበት ሱቅ ወይም ድርጅት ስም ጽፈው ያስገቡ። ፈላጊዎች ሲፈልጉ ይህ ስም ይታያቸዋል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">5</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[4/5]</span></h3>
            <p>ፈላጊዎች የሚደውሉበት ስልክ ቁጥር ያስገቡ። ትክክለኛ ቁጥር ያስገቡ — ፈላጊዎች ሲደዉሉ ይህን ቁጥር ይጠቀሳሉ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">6</div>
          <div class="step-body">
            <h3>ዋጋ ያስገቡ <span style="color:var(--muted)">[5/5]</span></h3>
            <p><strong>ቁጥር ብቻ</strong> ያስገቡ — ለምሳሌ: <span class="mono">650</span>. "ብር" ወይም "ኩንታል" አትጽፉ። ዋጋ ሲቀየር 💰 ዋጋ ቀይር ቁልፍ ይጠቀሙ።</p>
          </div>
        </div>
      </div>

      <div class="legend">
        <div class="legend-item"><div class="dot green"></div> ✅ አለ — ዕቃ ዛሬ አለ</div>
        <div class="legend-item"><div class="dot red"></div> ❌ የለም — ለጊዜው አልቋል</div>
        <div class="legend-item"><div class="dot yellow"></div> 💰 ዋጋ ቀይር — ዋጋ ዘምናል</div>
      </div>

      <div class="tip">
        <span class="tip-icon">💡</span>
        <div>ዕቃ ሲቆይ ወዲያው ❌ <strong>የለም</strong> ይምቱ! ፈላጊዎች "ዕቃ አለ" ብለው ስልክ ይደዉሉዎታል — ትዝብት ያስወግዱ።</div>
      </div>

      <div class="chat-demo">
        <div class="demo-title">📱 የ Bot ምሳሌ ውይይት</div>
        <div class="bubble bot">🧱 *ሲሚንቶ ምዝገባ*<br>[1/5] የሲሚንቶ አይነት ይምረጡ:</div>
        <div class="bubble btn-row">
          <span class="btn-chip">ዳንጎቴ</span><span class="btn-chip">ድሬ</span>
          <span class="btn-chip">ናሽናል</span><span class="btn-chip">ሙገር</span>
          <span class="btn-chip">ደርባ</span><span class="btn-chip">ሌላ</span>
        </div>
        <div class="bubble user">ዳንጎቴ ✓</div>
        <div class="bubble bot">[2/5] 📍 ቦታ ይምረጡ:</div>
        <div class="bubble user">አዲስ አበባ ✓</div>
        <div class="bubble bot">[3/5] 🏭 የድርጅቱ ስም ያስገቡ:</div>
        <div class="bubble user">አብርሃም ሲሚንቶ</div>
        <div class="bubble bot">🎉 ምዝገባ ተሳክቷል!</div>
      </div>
    </div>

    <!-- BUY -->
    <div id="cement-buy" style="display:none">
      <div class="steps">
        <div class="step">
          <div class="step-num cement">1</div>
          <div class="step-body">
            <h3>🛒 ሲሚንቶ ለመግዛት → ይምረጡ</h3>
            <p>ዋናው ምናሌ ላይ <strong>"🧱 ሲሚንቶ ለመግዛት"</strong> ቁልፍ ይምቱ። ወዲያው ፍለጋ ሂደት ይጀምራል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">2</div>
          <div class="step-body">
            <h3>ምን አይነት? <span style="color:var(--muted)">[1/3]</span></h3>
            <p>የሚፈልጉትን ሲሚንቶ አይነት ከቁልፎቹ ይምረጡ — ዳንጎቴ፣ ናሽናል… ወይም "ሌላ" ምርጠው ጽፈው ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">3</div>
          <div class="step-body">
            <h3>ቦታ ይምረጡ <span style="color:var(--muted)">[2/3]</span></h3>
            <p>ሲሚንቶ የሚፈልጉበትን ቦታ ይምረጡ። Bot አካባቢዎ ያሉ ሻጮችን ያሳያዎታል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num cement">4</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[3/3]</span></h3>
            <p>የእርስዎን ስልክ ቁጥር ያስገቡ። Bot ሻጮቹን ዝርዝር ያሳይዎታል — ቀጥታ ደውለው ያዙ!</p>
          </div>
        </div>
      </div>
      <div class="tip success-tip">
        <span class="tip-icon">🔍</span>
        <div>Bot ቋንቋ ዘለቅ ፍለጋ (fuzzy search) ይጠቀማል — "ዳንጎቴ" ወይም "Dangote" ቢጽፉ ሁለቱም ተመሳሳይ ውጤት ያመጣሉ!</div>
      </div>
    </div>
  </div>

  <!-- ══════════ STEEL ══════════ -->
  <div class="panel" id="panel-steel">
    <div class="section-label">
      <span class="icon">🟥</span>
      <div><h2>ብረት</h2><p>ለሻጮች እና ለፈላጊዎች</p></div>
    </div>

    <div class="role-switch">
      <button class="role-btn active" id="stl-sell-btn" onclick="switchRole('steel','sell')">🏪 ብረት ለመሸጥ</button>
      <button class="role-btn" id="stl-buy-btn" onclick="switchRole('steel','buy')">🛒 ብረት ለመግዛት</button>
    </div>

    <div id="steel-sell">
      <div class="steps">
        <div class="step">
          <div class="step-num steel">1</div>
          <div class="step-body">
            <h3>🟥 ብረት ለመሸጥ → ይምረጡ</h3>
            <p>ዋናው ምናሌ ላይ <strong>"🟥 ብረት ለመሸጥ"</strong> ቁልፍ ይምቱ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">2</div>
          <div class="step-body">
            <h3>አይነት ይምረጡ <span style="color:var(--muted)">[1/4]</span></h3>
            <p>ባለ 8፣ ባለ 10፣ ባለ 12፣ ባለ 14፣ ባለ 16 ወይም ቆርቆሮ (ሌላ) — አይነት ይምረጡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">3</div>
          <div class="step-body">
            <h3>አድራሻ ያስገቡ <span style="color:var(--muted)">[2/4]</span></h3>
            <p>ሱቁ ወይም መጋዘን ያለበት ቦታ ቀለል ባለ ሁኔታ ጽፈው ያስገቡ — ለምሳሌ: "አ.አ ቡልቡሎ"።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">4</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[3/4]</span></h3>
            <p>ፈላጊዎቹ የሚደዉሉበት ስልክ ቁጥር ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">5</div>
          <div class="step-body">
            <h3>ዋጋ ያስገቡ <span style="color:var(--muted)">[4/4]</span></h3>
            <p><strong>ቁጥር ብቻ</strong> — ለምሳሌ: <span class="mono">4500</span>. ምዝገባ ሲጨርሱ ወዲያው ይታያሉ!</p>
          </div>
        </div>
      </div>
      <div class="tip">
        <span class="tip-icon">💡</span>
        <div>ተጨማሪ ዲያሜትር ካለዎ ➕ <strong>ሌላ ጨምር</strong> ቁልፍ ይጠቀሙ — ለምሳሌ ባለ 8 እና ባለ 12 ለሁለቱም ልዩ ምዝገባ ያስፈልጋቸዋል።</div>
      </div>
    </div>

    <div id="steel-buy" style="display:none">
      <div class="steps">
        <div class="step">
          <div class="step-num steel">1</div>
          <div class="step-body">
            <h3>🛒 ብረት ለመግዛት → ይምረጡ</h3>
            <p><strong>"🟥 ብረት ለመግዛት"</strong> ቁልፍ ይምቱ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">2</div>
          <div class="step-body">
            <h3>አይነት ይምረጡ <span style="color:var(--muted)">[1/3]</span></h3>
            <p>ምን መጠን ብረት ይፈልጋሉ? ከዝርዝሩ ይምረጡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">3</div>
          <div class="step-body">
            <h3>ቦታ ጽፈው ያስገቡ <span style="color:var(--muted)">[2/3]</span></h3>
            <p>ብረቱ የሚፈልጉበት ቦታ ጽፈው ያስገቡ — Bot አካባቢዎ ያሉ ሻጮችን ይፈልጋል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num steel">4</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[3/3]</span></h3>
            <p>ስልክ ካስገቡ ሻጮቹ ዝርዝር ይታይዎታል — ዋጋ አወዳድረው ቀጥታ ደውለው ያዙ!</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ══════════ MACHINERY ══════════ -->
  <div class="panel" id="panel-mach">
    <div class="section-label">
      <span class="icon">🔹</span>
      <div><h2>ማሽነሪ</h2><p>ለአከራዮች እና ለተከራዮች</p></div>
    </div>

    <div class="role-switch">
      <button class="role-btn active" id="mac-sell-btn" onclick="switchRole('mach','sell')">🏗️ ማሽነሪ ለማከራየት</button>
      <button class="role-btn" id="mac-buy-btn" onclick="switchRole('mach','buy')">🔑 ማሽነሪ ለመከራየት</button>
    </div>

    <div id="mach-sell">
      <div class="steps">
        <div class="step">
          <div class="step-num mach">1</div>
          <div class="step-body">
            <h3>🔹 ማሽነሪ ለማከራየት → ይምረጡ</h3>
            <p><strong>"🔹 ማሽነሪ ለማከራየት"</strong> ቁልፍ ይምቱ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">2</div>
          <div class="step-body">
            <h3>አይነት ይምረጡ <span style="color:var(--muted)">[1/4]</span></h3>
            <p>ኤክስካቫተር፣ ቡልዶዘር፣ ጂሬደር፣ ሮለር፣ ሎደር፣ ክሬን፣ ሎ ቤድ፣ ጀነሬተር፣ ሌላ — ይምረጡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">3</div>
          <div class="step-body">
            <h3>አድራሻ ያስገቡ <span style="color:var(--muted)">[2/4]</span></h3>
            <p>ማሽነሪው ያለበት ወይም ሊገኝ የሚችልበት ቦታ ጽፈው ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">4</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[3/4]</span></h3>
            <p>ተከራዮቹ የሚደዉሉበት ስልክ ቁጥር ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">5</div>
          <div class="step-body">
            <h3>ኪራይ ዋጋ ያስገቡ <span style="color:var(--muted)">[4/4]</span></h3>
            <p><strong>ቁጥር ብቻ</strong> — ለምሳሌ: <span class="mono">25000</span>. ምዝገባ ጨርሰው ✅/❌ ቁልፎቹን ሁኔታ ለማዘመን ይጠቀሙ።</p>
          </div>
        </div>
      </div>
      <div class="tip warn-tip">
        <span class="tip-icon">⚠️</span>
        <div>ማሽነሪ ሥራ ላይ ሲውል ❌ <strong>የለም</strong> ይምቱ — ሌሎች ሰዎች ትርጉም ወደሌለው ደዉል ያስቀሩ ሊያሳሱ ይችላሉ።</div>
      </div>
    </div>

    <div id="mach-buy" style="display:none">
      <div class="steps">
        <div class="step">
          <div class="step-num mach">1</div>
          <div class="step-body">
            <h3>🔑 ማሽነሪ ለመከራየት → ይምረጡ</h3>
            <p><strong>"🔹 ማሽነሪ ለመከራየት"</strong> ቁልፍ ይምቱ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">2</div>
          <div class="step-body">
            <h3>አይነት ይምረጡ <span style="color:var(--muted)">[1/3]</span></h3>
            <p>ምን ዓይነት ማሽነሪ ይፈልጋሉ? ዝርዝሩ ውስጥ ይምረጡ — ወይም "ሌላ" ምርጠው ስም ጽፈው ያስገቡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">3</div>
          <div class="step-body">
            <h3>ቦታ ይምረጡ <span style="color:var(--muted)">[2/3]</span></h3>
            <p>ማሽነሪ የሚፈልጉበት ቦታ ይምረጡ — Bot ዝግጁ ማሽነሪ ያሳይዎታል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num mach">4</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[3/3]</span></h3>
            <p>ስልክ ካስገቡ ዝርዝሩ ይታይዎታል — ዋጋ አወዳድረው ቀጥታ ያናግሩ!</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ══════════ TRUCK ══════════ -->
  <div class="panel" id="panel-truck">
    <div class="section-label">
      <span class="icon">🚚</span>
      <div><h2>ትራክ / መኪና</h2><p>ለአከራዮች እና ለተከራዮች</p></div>
    </div>

    <div class="role-switch">
      <button class="role-btn active" id="trk-sell-btn" onclick="switchRole('truck','sell')">🚛 መኪና ለማከራየት</button>
      <button class="role-btn" id="trk-buy-btn" onclick="switchRole('truck','buy')">🛤️ መኪና ለመከራየት</button>
    </div>

    <div id="truck-sell">
      <div class="steps">
        <div class="step">
          <div class="step-num truck">1</div>
          <div class="step-body">
            <h3>🚚 መኪና ለማከራየት → ይምረጡ</h3>
            <p><strong>"🚚 መኪና ለማከራየት"</strong> ቁልፍ ይምቱ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">2</div>
          <div class="step-body">
            <h3>አይነት ይምረጡ <span style="color:var(--muted)">[1/4]</span></h3>
            <p>ዳምፕ፣ ተሳቢ፣ ካብ፣ ታንከር፣ ሎ ቤድ፣ ካርጎ፣ ኮንቴይነር፣ ፍሬጎ፣ ሲሎ፣ ቴምፖ/ፒክአፕ፣ ሚኒባስ፣ ሌላ — ይምረጡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">3</div>
          <div class="step-body">
            <h3>ታርጋ ቁጥር ያስገቡ <span style="color:var(--muted)">[2/4]</span></h3>
            <p>የመኪናው ታርጋ ቁጥር ጽፈው ያስገቡ — ለምሳሌ: <span class="mono">AA 12345</span>. ታርጋ ምዝገባ ለማረጋገጥ ያስፈልጋል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">4</div>
          <div class="step-body">
            <h3>መስመር ያስገቡ <span style="color:var(--muted)">[3/4]</span></h3>
            <p>የጉዞ መስመር ጽፈው ያስገቡ — ለምሳሌ: <span class="mono">ከ አ.አ ወደ ሀዋሳ</span>. ወይም "አዲስ አበባ ከተማ ውስጥ" ይምረጡ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">5</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[4/4]</span></h3>
            <p>ፈላጊዎቹ የሚደዉሉበት ስልክ ቁጥር ያስገቡ። ምዝገባ ጨርሰው ✅ ዝግጁ / 🔴 ስራ ላይ ቁልፎቹን ሁኔታ ለማዘመን ይጠቀሙ።</p>
          </div>
        </div>
      </div>

      <div class="legend">
        <div class="legend-item"><div class="dot green"></div> ✅ ዝግጁ — አሁን ሊያጓጉዙ ዝግጁ</div>
        <div class="legend-item"><div class="dot red"></div> 🔴 ስራ ላይ — መኪናው ጉዞ ላይ ነው</div>
      </div>

      <div class="tip">
        <span class="tip-icon">🛣️</span>
        <div>መስመር ለመቀየር 🗺️ <strong>መስመር ቀይር</strong> ቁልፍ ይጠቀሙ — አዲሱን ጉዞ ጽፈው ያስገቡ።</div>
      </div>
    </div>

    <div id="truck-buy" style="display:none">
      <div class="steps">
        <div class="step">
          <div class="step-num truck">1</div>
          <div class="step-body">
            <h3>🛤️ መኪና ለመከራየት → ይምረጡ</h3>
            <p><strong>"🚚 መኪና ለመከራየት"</strong> ቁልፍ ይምቱ።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">2</div>
          <div class="step-body">
            <h3>አይነት ይምረጡ <span style="color:var(--muted)">[1/3]</span></h3>
            <p>ምን ዓይነት መኪና ይፈልጋሉ? — ዳምፕ፣ ተሳቢ፣ ካርጎ… ወይም "ሌላ"።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">3</div>
          <div class="step-body">
            <h3>ከየት? — መነሻ ቦታ <span style="color:var(--muted)">[2/3 — ክፍል ሀ]</span></h3>
            <p>ጉዞ የሚጀምሩበትን ቦታ ይምረጡ — ዝርዝሩ ውስጥ ወይም "ሌላ" ምርጠው ጽፈው ያስገቡ። <strong>ከተማ ውስጥ</strong> ከሆነ "አዲስ አበባ (ከተማ ውስጥ)" ይምረጡ — መድረሻ ሳያስፈልግ ይቀጠላል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">4</div>
          <div class="step-body">
            <h3>ወዴት? — መድረሻ ቦታ <span style="color:var(--muted)">[2/3 — ክፍል ለ]</span></h3>
            <p>ጉዞ የሚደርሱበትን ቦታ ይምረጡ — Bot ሁለቱን ቦታ ያዋህዶ ይፈልጋል።</p>
          </div>
        </div>
        <div class="step">
          <div class="step-num truck">5</div>
          <div class="step-body">
            <h3>ስልክ ቁጥር ያስገቡ <span style="color:var(--muted)">[3/3]</span></h3>
            <p>ስልክ ካስገቡ ዝግጁ መኪና ዝርዝር ይታይዎታል። ቀጥታ ደውለው ያስያዙ!</p>
          </div>
        </div>
      </div>
      <div class="tip success-tip">
        <span class="tip-icon">🔍</span>
        <div>Bot "ከ አ.አ ወደ ሀዋሳ" ብትጽፉ "ከ አዲስ አበባ ወደ ሀዋሳ" ያለ ምዝገባ ጭምር ያሳያቸዋል — ቋንቋ አይጠብቅም!</div>
      </div>
    </div>
  </div>

  <!-- ══════════ ADMIN ══════════ -->
  <div class="panel" id="panel-admin">
    <div class="section-label">
      <span class="icon">🔧</span>
      <div><h2>አድሚን ፓናል</h2><p>ለ Bot አስተዳዳሪዎች ብቻ</p></div>
    </div>

    <div class="admin-card">
      <h3>🚀 ፓናል ለመክፈት</h3>
      <ul>
        <li>Bot ውስጥ <span class="mono">/admin_panel</span> ይጻፉ</li>
        <li>ፓናሉ ይከፈታል — ዘርፍ ይምረጡ</li>
        <li>ፈቃድ ያለዎ አድሚን ካልሆኑ "⛔ ፈቃድ የለዎትም" ይላል</li>
      </ul>
    </div>

    <div class="admin-card">
      <h3>📋 ምዝገባ ዝርዝር</h3>
      <ul>
        <li>🧱 ሲሚንቶ — ሁሉም ሻጮች ዝርዝር</li>
        <li>🚚 መኪና — ሁሉም አከራዮች ዝርዝር</li>
        <li>🟥 ብረት — ሁሉም ሻጮች ዝርዝር</li>
        <li>🔹 ማሽነሪ — ሁሉም አከራዮች ዝርዝር</li>
        <li>ሁኔታ (አለ/የለም) ቀጥታ ከፓናሉ ማዘመን ይቻላል</li>
      </ul>
    </div>

    <div class="admin-card">
      <h3>📊 ፍለጋ ሪፖርት</h3>
      <ul>
        <li>"📊 ፍለጋ ሪፖርት (ዛሬ)" ቁልፍ ይምቱ</li>
        <li>ዛሬ ስንት ሰዎች ምን እንደፈለጉ ያሳያል</li>
        <li>ስም፣ ስልክ፣ ምን ፈልገዋል — ሁሉም ይታያል</li>
        <li>ዘጋቢ 24 ሰዓት ብቻ ስለሚቆይ ዕለታዊ ይፈትሹ</li>
      </ul>
    </div>

    <div class="admin-card">
      <h3>🗑️ ምዝገባ ማጥፋት</h3>
      <ul>
        <li>"🗑️ ማጥፊያ" ቁልፍ ይምቱ</li>
        <li>ዘርፍ ይምረጡ (ሲሚንቶ፣ ትራክ…)</li>
        <li>ማጥፋት የሚፈልጉትን ምዝገባ ይምረጡ</li>
        <li>⚠️ ይህ ድርጊት ሊቀለበስ አይችልም — ጥንቃቄ ያድርጉ!</li>
      </ul>
    </div>

    <div class="tip warn-tip">
      <span class="tip-icon">🔐</span>
      <div>አድሚን ፈቃድ ያለው ID ሲቀየር ወይም ሲጨምር — Bot code ውስጥ ያለው <span class="mono">ADMIN_IDS</span> environment variable መዘምን ያስፈልጋል።</div>
    </div>
  </div>

</div><!-- /panels -->

<footer>
  <strong>Simple Marketplace Bot v6.1</strong> — ሲሚንቶ · ብረት · ማሽነሪ · ትራክ<br>
  ለድጋፍ ቀጥታ ያናግሩን · 24/7 ክፍት
</footer>

<script>
  function showPanel(id) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.getElementById('panel-' + id).classList.add('active');
    const tabs = document.querySelectorAll('.tab');
    const map = { overview:0, cement:1, steel:2, mach:3, truck:4, admin:5 };
    tabs[map[id]].classList.add('active');
  }

  function switchRole(section, role) {
    const sellId = section + '-sell';
    const buyId  = section + '-buy';
    const sellBtn = document.getElementById(section.slice(0,3) + '-sell-btn') ||
                    document.getElementById(section === 'mach' ? 'mac-sell-btn' : section.slice(0,3) + '-sell-btn');
    const buyBtn  = document.getElementById(section.slice(0,3) + '-buy-btn') ||
                    document.getElementById(section === 'mach' ? 'mac-buy-btn' : section.slice(0,3) + '-buy-btn');

    // map section names to correct IDs
    const btns = {
      cement: { sell: 'cem-sell-btn', buy: 'cem-buy-btn' },
      steel:  { sell: 'stl-sell-btn', buy: 'stl-buy-btn' },
      mach:   { sell: 'mac-sell-btn', buy: 'mac-buy-btn' },
      truck:  { sell: 'trk-sell-btn', buy: 'trk-buy-btn' },
    };

    const sb = document.getElementById(btns[section].sell);
    const bb = document.getElementById(btns[section].buy);

    if (role === 'sell') {
      document.getElementById(sellId).style.display = '';
      document.getElementById(buyId).style.display  = 'none';
      sb.classList.add('active'); bb.classList.remove('active');
    } else {
      document.getElementById(sellId).style.display = 'none';
      document.getElementById(buyId).style.display  = '';
      bb.classList.add('active'); sb.classList.remove('active');
    }
  }

  // overview cards clickable
  document.querySelectorAll('.ov-card').forEach(card => {
    card.addEventListener('click', () => {
      const map = {
        cement: 'cement', steel: 'steel', mach: 'mach', truck: 'truck'
      };
      for (const [cls, panel] of Object.entries(map)) {
        if (card.classList.contains(cls)) showPanel(panel);
      }
    });
  });
</script>
</body>
</html>
