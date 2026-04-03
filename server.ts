import { WebSocketServer, WebSocket } from 'ws';

interface Player {
  pubkey: string;
  name: string;
  x: number;
  y: number;
  room: string;
  avatar: string;
  status: string;
  ws: WebSocket;
}

const players = new Map<string, Player>();
const wss = new WebSocketServer({ port: 3100 });

console.log('[Presence] Server running on ws://localhost:3100');

wss.on('connection', (ws) => {
  let myPubkey: string | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'join') {
        myPubkey = msg.pubkey || `guest_${Math.random().toString(36).slice(2, 8)}`;
        const room = msg.room || 'hub';
        players.set(myPubkey!, {
          pubkey: myPubkey!,
          name: msg.name || 'anon',
          x: msg.x || 400,
          y: msg.y || 348,
          room,
          avatar: msg.avatar || '',
          status: (msg.status || '').slice(0, 60),
          ws,
        });
        console.log(`[Presence] ${msg.name} joined ${room} (${players.size} online)`);

        const others: any[] = [];
        players.forEach((p, key) => {
          if (key !== myPubkey && p.room === room) {
            others.push({ pubkey: p.pubkey, name: p.name, x: p.x, y: p.y, avatar: p.avatar, status: p.status });
          }
        });
        ws.send(JSON.stringify({ type: 'players', players: others }));
        broadcastToRoom(room, { type: 'join', pubkey: myPubkey, name: msg.name, x: msg.x, y: msg.y, avatar: msg.avatar || '', status: (msg.status || '').slice(0, 60) }, myPubkey);
        broadcastCount();
      }

      if (msg.type === 'room' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;

        const oldRoom = player.room;
        const newRoom = msg.room || 'hub';
        if (oldRoom === newRoom) {
          // Client re-sent same room (e.g. returning scene re-syncing) — resend players list
          const others: any[] = [];
          players.forEach((p, key) => {
            if (key !== myPubkey && p.room === newRoom) {
              others.push({ pubkey: p.pubkey, name: p.name, x: p.x, y: p.y, avatar: p.avatar, status: p.status });
            }
          });
          ws.send(JSON.stringify({ type: 'players', players: others }));
          return;
        }

        console.log(`[Presence] ${player.name} moved ${oldRoom} → ${newRoom}`);

        // If leaving a myroom they own, kick everyone else out
        if (oldRoom.startsWith('myroom:') && oldRoom === `myroom:${myPubkey}`) {
          players.forEach((p, key) => {
            if (key !== myPubkey && p.room === oldRoom && p.ws.readyState === WebSocket.OPEN) {
              p.ws.send(JSON.stringify({ type: 'room_kick', reason: 'Owner left the room' }));
            }
          });
        }

        broadcastToRoom(oldRoom, { type: 'leave', pubkey: myPubkey }, myPubkey);

        player.room = newRoom;
        player.x = msg.x || 400;
        player.y = msg.y || 348;
        if (msg.avatar) player.avatar = msg.avatar;

        const others: any[] = [];
        players.forEach((p, key) => {
          if (key !== myPubkey && p.room === newRoom) {
            others.push({ pubkey: p.pubkey, name: p.name, x: p.x, y: p.y, avatar: p.avatar, status: p.status });
          }
        });
        ws.send(JSON.stringify({ type: 'players', players: others }));
        broadcastToRoom(newRoom, { type: 'join', pubkey: myPubkey, name: player.name, x: player.x, y: player.y, avatar: player.avatar, status: player.status }, myPubkey);
        broadcastCount();
      }

      // Request to enter someone's myroom
      if (msg.type === 'room_request' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const ownerPubkey = msg.ownerPubkey;
        const owner = players.get(ownerPubkey);

        if (!owner) {
          ws.send(JSON.stringify({ type: 'room_denied', reason: 'Player is offline' }));
          return;
        }

        console.log(`[Presence] ${player.name} requested to enter ${owner.name}'s room`);

        if (owner.ws.readyState === WebSocket.OPEN) {
          owner.ws.send(JSON.stringify({
            type: 'room_request',
            requesterPubkey: myPubkey,
            requesterName: player.name,
          }));
        }
      }

      // Owner responds to a room request
      if (msg.type === 'room_response' && myPubkey) {
        const requester = players.get(msg.requesterPubkey);
        if (!requester) return;

        const player = players.get(myPubkey);
        if (!player) return;

        if (msg.accepted) {
          console.log(`[Presence] ${player.name} accepted ${requester.name} into their room`);
          if (requester.ws.readyState === WebSocket.OPEN) {
            requester.ws.send(JSON.stringify({
              type: 'room_granted',
              ownerPubkey: myPubkey,
              ownerName: player.name,
              room: `myroom:${myPubkey}`,
              roomConfig: msg.roomConfig,
            }));
          }
        } else {
          console.log(`[Presence] ${player.name} denied ${requester.name}`);
          if (requester.ws.readyState === WebSocket.OPEN) {
            requester.ws.send(JSON.stringify({
              type: 'room_denied',
              reason: `${player.name} denied your request`,
            }));
          }
        }
      }

      // Request list of online players (for myroom door picker)
      if (msg.type === 'online_players' && myPubkey) {
        const list: any[] = [];
        players.forEach((p, key) => {
          if (key !== myPubkey) list.push({ pubkey: p.pubkey, name: p.name, status: p.status, avatar: p.avatar, room: p.room });
        });
        ws.send(JSON.stringify({ type: 'online_players', players: list }));
      }

      if (msg.type === 'chat' && myPubkey) {
        const player = players.get(myPubkey);
        if (!player) return;
        const text = (msg.text || '').slice(0, 200);
        if (text.length > 0) {
          broadcastToRoom(player.room, { type: 'chat', pubkey: myPubkey, name: player.name, text }, null);
        }
      }

      if (msg.type === 'move' && myPubkey) {
        const player = players.get(myPubkey);
        if (player) {
          player.x = msg.x;
          player.y = msg.y;
          broadcastToRoom(player.room, { type: 'move', pubkey: myPubkey, x: msg.x, y: msg.y }, myPubkey);
        }
      }

      if (msg.type === 'avatar_update' && myPubkey) {
        const player = players.get(myPubkey);
        if (player) {
          player.avatar = msg.avatar || '';
          broadcastToRoom(player.room, { type: 'avatar_update', pubkey: myPubkey, avatar: player.avatar }, myPubkey);
        }
      }

      if (msg.type === 'status_update' && myPubkey) {
        const player = players.get(myPubkey);
        if (player) {
          player.status = (msg.status || '').slice(0, 60);
          broadcastAll({ type: 'status_update', pubkey: myPubkey, status: player.status }, myPubkey);
        }
      }

      if (msg.type === 'name_update' && myPubkey && msg.name) {
        const player = players.get(myPubkey);
        if (player) {
          player.name = msg.name;
          // Name is global — broadcast to all rooms so every player sees it
          broadcastAll({ type: 'name_update', pubkey: myPubkey, name: player.name }, myPubkey);
        }
      }

    } catch (e) {}
  });

  ws.on('close', () => {
    if (myPubkey) {
      const player = players.get(myPubkey);
      console.log(`[Presence] ${player?.name} left (${players.size - 1} online)`);

      if (player && player.room === `myroom:${myPubkey}`) {
        players.forEach((p, key) => {
          if (key !== myPubkey && p.room === player.room && p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(JSON.stringify({ type: 'room_kick', reason: 'Owner disconnected' }));
          }
        });
      }

      if (player) {
        broadcastToRoom(player.room, { type: 'leave', pubkey: myPubkey }, null);
      }
      players.delete(myPubkey);
      broadcastCount();
    }
  });
});

function broadcastToRoom(room: string, msg: any, excludePubkey: string | null) {
  const data = JSON.stringify(msg);
  players.forEach((p, key) => {
    if (key !== excludePubkey && p.room === room && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function broadcastAll(msg: any, excludePubkey: string | null) {
  const data = JSON.stringify(msg);
  players.forEach((p, key) => {
    if (key !== excludePubkey && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}

function broadcastCount() {
  const count = players.size;
  const data = JSON.stringify({ type: 'count', count });
  players.forEach((p) => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(data);
    }
  });
}