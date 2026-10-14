const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const passages = [
  "the fastest way to improve is to practice a little every day. stay relaxed, look ahead, and let your fingers find the rhythm.",
  "a good player does not need to rush every moment. steady movement, smart choices, and patience can make all the difference.",
  "small steps still move you forward. learn from each mistake, try again, and remember that progress is built one keystroke at a time.",
  "when the countdown ends, take a breath and focus on the next word. consistency beats panic, and accuracy makes speed useful."
];
const rooms = new Map();
const makeCode = () => Math.random().toString(36).slice(2, 6).toUpperCase();

function publicRoom(room) {
  return {
    code: room.code, status: room.status, countdown: room.countdown,
    passage: room.passage,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, progress:p.progress, wpm:p.wpm,
      accuracy:p.accuracy, finished:p.finished
    }))
  };
}
function emitRoom(room) { io.to(room.code).emit("room:update", publicRoom(room)); }
function cleanName(name) {
  return String(name || "Player").replace(/[<>]/g, "").trim().slice(0, 16) || "Player";
}
function getRoom(socket) {
  const code = socket.data.room;
  return code ? rooms.get(code) : null;
}
function leaveRoom(socket) {
  const room = getRoom(socket);
  if (!room) return;
  room.players.delete(socket.id);
  socket.leave(room.code);
  socket.data.room = null;
  if (!room.players.size) {
    if (room.timer) clearInterval(room.timer);
    rooms.delete(room.code);
  } else {
    if (room.status === "countdown" && room.players.size === 0) room.status = "lobby";
    emitRoom(room);
  }
}

io.on("connection", socket => {
  socket.on("room:create", ({name} = {}, cb = () => {}) => {
    leaveRoom(socket);
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    const room = {code, status:"lobby", passage:"", players:new Map(), timer:null, countdown:0};
    rooms.set(code, room);
    room.players.set(socket.id, {id:socket.id,name:cleanName(name),progress:0,wpm:0,accuracy:100,finished:false});
    socket.join(code); socket.data.room = code;
    cb({ok:true, code}); emitRoom(room);
  });

  socket.on("room:join", ({code,name} = {}, cb = () => {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ok:false,error:"Room not found. Check the code and try again."});
    if (room.status !== "lobby") return cb({ok:false,error:"This race has already started."});
    if (room.players.size >= 8) return cb({ok:false,error:"This room is full (8 players max)."});
    leaveRoom(socket);
    room.players.set(socket.id, {id:socket.id,name:cleanName(name),progress:0,wpm:0,accuracy:100,finished:false});
    socket.join(code); socket.data.room = code;
    cb({ok:true,code}); emitRoom(room);
  });

  socket.on("race:start", () => {
    const room = getRoom(socket);
    if (!room || room.status !== "lobby") return;
    if (room.players.size < 1) return;
    room.status = "countdown"; room.countdown = 3;
    room.passage = passages[Math.floor(Math.random() * passages.length)];
    for (const p of room.players.values()) Object.assign(p,{progress:0,wpm:0,accuracy:100,finished:false});
    emitRoom(room);
    room.timer = setInterval(() => {
      room.countdown--;
      if (room.countdown <= 0) {
        clearInterval(room.timer); room.timer = null;
        room.status = "racing";
        io.to(room.code).emit("race:go", {passage:room.passage, startedAt:Date.now()});
      }
      emitRoom(room);
    }, 1000);
  });

  socket.on("race:progress", data => {
    const room = getRoom(socket);
    if (!room || room.status !== "racing") return;
    const p = room.players.get(socket.id);
    if (!p || p.finished) return;
    const typed = String(data?.typed || "").slice(0, room.passage.length);
    let correct = 0;
    for (let i=0;i<typed.length;i++) if (typed[i] === room.passage[i]) correct++;
    const elapsed = Math.max(1, Number(data?.elapsedMs || 1000)) / 60000;
    p.progress = Math.min(100, Math.floor(typed.length / room.passage.length * 100));
    p.wpm = Math.round((correct / 5) / elapsed);
    p.accuracy = typed.length ? Math.round(correct / typed.length * 100) : 100;
    if (typed.length >= room.passage.length) { p.finished = true; p.progress = 100; }
    emitRoom(room);
    if ([...room.players.values()].every(x => x.finished)) {
      room.status = "finished";
      emitRoom(room);
    }
  });

  socket.on("race:reset", () => {
    const room = getRoom(socket);
    if (!room || room.status !== "finished") return;
    room.status = "lobby"; room.passage = "";
    for (const p of room.players.values()) Object.assign(p,{progress:0,wpm:0,accuracy:100,finished:false});
    emitRoom(room);
  });

  socket.on("disconnect", () => leaveRoom(socket));
});

server.listen(PORT, () => console.log(`TypeRush running at http://localhost:${PORT}`));
