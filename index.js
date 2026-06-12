import { useState, useEffect, useCallback } from "react";

const BINGO_LETTERS = ["B", "I", "N", "G", "O"];
const RANGES = { B: [1,15], I: [16,30], N: [31,45], G: [46,60], O: [61,75] };

function getRandom(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateCard() {
  return BINGO_LETTERS.map((letter) => {
    const [min, max] = RANGES[letter];
    const nums = new Set();
    while (nums.size < 5) nums.add(getRandom(min, max));
    return [...nums];
  });
}

function checkWin(marked, card) {
  const isMarked = (col, row) => col === 2 && row === 2 ? true : marked[`${col}-${row}`];

  // Rows
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => isMarked(c, r))) return true;
  }
  // Columns
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => isMarked(c, r))) return true;
  }
  // Diagonals
  if ([0,1,2,3,4].every(i => isMarked(i, i))) return true;
  if ([0,1,2,3,4].every(i => isMarked(i, 4-i))) return true;
  return false;
}

export default function BingoGame() {
  const [card, setCard] = useState(() => generateCard());
  const [marked, setMarked] = useState({});
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastCalled, setLastCalled] = useState(null);
  const [won, setWon] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [allNumbers] = useState(() => {
    const all = [];
    BINGO_LETTERS.forEach(l => {
      const [min, max] = RANGES[l];
      for (let i = min; i <= max; i++) all.push({ letter: l, num: i });
    });
    return all.sort(() => Math.random() - 0.5);
  });
  const [callIndex, setCallIndex] = useState(0);

  const callNumber = useCallback(() => {
    if (callIndex >= allNumbers.length) {
      setGameOver(true);
      return;
    }
    const called = allNumbers[callIndex];
    setLastCalled(called);
    setCalledNumbers(prev => [called, ...prev]);
    setCallIndex(i => i + 1);
  }, [callIndex, allNumbers]);

  const toggleMark = (col, row) => {
    if (won) return;
    if (col === 2 && row === 2) return;
    const key = `${col}-${row}`;
    const num = card[col][row];
    const isCalled = calledNumbers.some(c => c.num === num);
    if (!isCalled) return;
    setMarked(prev => {
      const next = { ...prev, [key]: !prev[key] };
      if (checkWin(next, card)) setWon(true);
      return next;
    });
  };

  const isMarked = (col, row) => {
    if (col === 2 && row === 2) return true;
    return !!marked[`${col}-${row}`];
  };

  const isCalled = (num) => calledNumbers.some(c => c.num === num);

  const restart = () => {
    setCard(generateCard());
    setMarked({});
    setCalledNumbers([]);
    setLastCalled(null);
    setWon(false);
    setGameOver(false);
    setCallIndex(0);
  };

  const colColors = ["#3B82F6","#8B5CF6","#EF4444","#F59E0B","#10B981"];
  const colDark   = ["#1D4ED8","#6D28D9","#B91C1C","#B45309","#047857"];

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 50%, #0F172A 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "flex-start",
      padding: "20px 16px",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: "#F8FAFC"
    }}>

      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 style={{
          fontSize: "clamp(2rem, 8vw, 3.5rem)",
          fontWeight: 900,
          letterSpacing: "0.15em",
          margin: 0,
          background: "linear-gradient(90deg, #F59E0B, #EF4444, #8B5CF6, #3B82F6, #10B981)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          textShadow: "none",
          filter: "drop-shadow(0 0 20px rgba(245,158,11,0.4))"
        }}>
          ቢ • ን • ጎ
        </h1>
        <p style={{ color: "#94A3B8", fontSize: 13, margin: "4px 0 0", letterSpacing: 2 }}>BINGO GAME</p>
      </div>

      {/* Win Banner */}
      {won && (
        <div style={{
          background: "linear-gradient(135deg, #F59E0B, #EF4444)",
          borderRadius: 16,
          padding: "16px 32px",
          marginBottom: 20,
          textAlign: "center",
          animation: "pulse 0.5s ease",
          boxShadow: "0 0 40px rgba(245,158,11,0.6)"
        }}>
          <div style={{ fontSize: 40 }}>🎉</div>
          <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 3 }}>ቢንጎ! አሸነፍክ!</div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>YOU WON!</div>
        </div>
      )}

      {/* Called Number Display */}
      <div style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 20,
        padding: "16px 32px",
        marginBottom: 16,
        textAlign: "center",
        minWidth: 200,
        backdropFilter: "blur(10px)"
      }}>
        <div style={{ fontSize: 11, color: "#94A3B8", letterSpacing: 3, marginBottom: 8 }}>
          የተጠራ ቁጥር / CALLED
        </div>
        {lastCalled ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <span style={{
              fontSize: 28,
              fontWeight: 900,
              color: colColors[BINGO_LETTERS.indexOf(lastCalled.letter)],
              filter: "drop-shadow(0 0 10px currentColor)"
            }}>{lastCalled.letter}</span>
            <span style={{ fontSize: 48, fontWeight: 900, lineHeight: 1 }}>{lastCalled.num}</span>
          </div>
        ) : (
          <div style={{ fontSize: 28, color: "#475569" }}>—</div>
        )}
        <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
          {callIndex}/{allNumbers.length} ቁጥሮች ተጥረዋል
        </div>
      </div>

      {/* Call Button */}
      <button
        onClick={callNumber}
        disabled={won || gameOver}
        style={{
          background: won || gameOver
            ? "rgba(255,255,255,0.05)"
            : "linear-gradient(135deg, #F59E0B, #EF4444)",
          border: "none",
          borderRadius: 12,
          padding: "12px 36px",
          color: won || gameOver ? "#475569" : "#fff",
          fontSize: 16,
          fontWeight: 700,
          cursor: won || gameOver ? "not-allowed" : "pointer",
          marginBottom: 20,
          letterSpacing: 1,
          boxShadow: won || gameOver ? "none" : "0 4px 20px rgba(245,158,11,0.4)",
          transition: "transform 0.1s",
          transform: "translateY(0)",
        }}
        onMouseDown={e => e.currentTarget.style.transform = "translateY(2px)"}
        onMouseUp={e => e.currentTarget.style.transform = "translateY(0)"}
      >
        {gameOver ? "ጨዋታ አለቀ" : "ቁጥር ጥራ 🎱"}
      </button>

      {/* Bingo Card */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 20,
        padding: 12,
        backdropFilter: "blur(10px)",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
      }}>
        {/* Header Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 6 }}>
          {BINGO_LETTERS.map((l, i) => (
            <div key={l} style={{
              width: 56, height: 44,
              background: colColors[i],
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 900,
              boxShadow: `0 4px 12px ${colColors[i]}66`
            }}>{l}</div>
          ))}
        </div>

        {/* Number Grid */}
        {[0,1,2,3,4].map(row => (
          <div key={row} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 6 }}>
            {BINGO_LETTERS.map((_, col) => {
              const isCenter = col === 2 && row === 2;
              const num = card[col][row];
              const called = isCalled(num);
              const markedCell = isMarked(col, row);

              return (
                <button
                  key={col}
                  onClick={() => toggleMark(col, row)}
                  disabled={!called && !isCenter}
                  style={{
                    width: 56, height: 56,
                    borderRadius: 10,
                    border: markedCell ? `2px solid ${colColors[col]}` : "2px solid rgba(255,255,255,0.08)",
                    background: isCenter
                      ? `linear-gradient(135deg, ${colColors[col]}, ${colDark[col]})`
                      : markedCell
                        ? `linear-gradient(135deg, ${colColors[col]}33, ${colColors[col]}11)`
                        : called
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(255,255,255,0.02)",
                    color: isCenter ? "#fff"
                      : markedCell ? colColors[col]
                      : called ? "#F8FAFC"
                      : "#334155",
                    fontSize: isCenter ? 22 : 18,
                    fontWeight: 700,
                    cursor: (called || isCenter) ? "pointer" : "default",
                    transition: "all 0.15s",
                    boxShadow: markedCell ? `0 0 12px ${colColors[col]}44` : "none",
                    transform: markedCell ? "scale(0.95)" : "scale(1)"
                  }}
                >
                  {isCenter ? "⭐" : num}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Recent calls */}
      {calledNumbers.length > 0 && (
        <div style={{ marginTop: 20, maxWidth: 320, width: "100%" }}>
          <div style={{ fontSize: 11, color: "#475569", letterSpacing: 2, marginBottom: 8, textAlign: "center" }}>
            የቅርብ ጊዜ ጥሪዎች / RECENT CALLS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
            {calledNumbers.slice(0, 15).map((c, i) => (
              <span key={i} style={{
                background: `${colColors[BINGO_LETTERS.indexOf(c.letter)]}22`,
                border: `1px solid ${colColors[BINGO_LETTERS.indexOf(c.letter)]}44`,
                borderRadius: 6,
                padding: "2px 8px",
                fontSize: 13,
                color: colColors[BINGO_LETTERS.indexOf(c.letter)],
                opacity: i === 0 ? 1 : 0.5
              }}>
                {c.letter}{c.num}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Restart */}
      <button
        onClick={restart}
        style={{
          marginTop: 24,
          background: "transparent",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 10,
          padding: "10px 28px",
          color: "#94A3B8",
          fontSize: 14,
          cursor: "pointer",
          letterSpacing: 1,
          transition: "all 0.2s"
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "#F8FAFC"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "#94A3B8"; }}
      >
        🔄 እንደገና ጀምር / New Game
      </button>

      <div style={{ marginTop: 16, fontSize: 11, color: "#334155", textAlign: "center", maxWidth: 280 }}>
        ቁጥር ጠርተህ በካርዱ ላይ ካለ ንካ • ረድፍ፣ አምድ ወይም አጣጣፍ ሞላ = ቢንጎ!
      </div>
    </div>
  );
}
