const express = require('express');
const WebSocket = require('ws');

const app = express();
app.use(express.static('public'));

const server = app.listen(3000, () => {
  console.log('Server running on port 3000');
});

const wss = new WebSocket.WebSocketServer({ server });

const rooms = {};

function generateRoomNumber() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function createDeck() {
  const suits = ['oros', 'copas', 'espadas', 'bastos'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '10', '11', '12'];
  let deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

wss.on('connection', (ws) => {
  console.log('Client Connected!');

  ws.on('error', (err) => {
    console.error('Error with socket:', err);
  });

  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch (e) {
      console.error('Invalid message format:', data);
      return;
    }

    const { type, roomNumber, playerName, card, playerId: clientPlayerId } = message;

    if (type === 'createGame') {
      let newRoomNumber = generateRoomNumber();
      while (rooms[newRoomNumber]) {
        newRoomNumber = generateRoomNumber();
      }
      rooms[newRoomNumber] = {
        players: [],
        deck: [],
        started: false,
        currentPlayerIndex: 0,
        burroShouted: false,
        reactionPlayers: new Set(),
        creatorId: null,
        locked: false,
        firstShout: false,
      };
      ws.send(JSON.stringify({ type: 'roomCreated', roomNumber: newRoomNumber }));
    }

    if (type === 'joinGame') {
      if (!rooms[roomNumber]) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room does not exist' }));
        return;
      }
      if (rooms[roomNumber].locked && !rooms[roomNumber].players.find(p => p.id === clientPlayerId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is locked to initial players' }));
        return;
      }
      if (rooms[roomNumber].players.length >= 10) {
        ws.send(JSON.stringify({ type: 'error', message: 'Room is full' }));
        return;
      }

      let playerId;
      const existingPlayer = rooms[roomNumber].players.find(p => p.id === clientPlayerId);
      if (existingPlayer) {
        playerId = clientPlayerId;
        existingPlayer.ws = ws;
        existingPlayer.name = playerName || existingPlayer.name || 'Player';
        console.log(`Player reconnected: ID=${playerId}, Name=${existingPlayer.name}, Room=${roomNumber}`);
      } else {
        playerId = clientPlayerId || `${roomNumber}-${Date.now()}`;
        rooms[roomNumber].players.push({
          id: playerId,
          ws,
          name: playerName || 'Player',
          cards: [],
          pendingCard: null,
          score: '',
          eliminated: false,
        });
        console.log(`Player joined: ID=${playerId}, Name=${playerName}, Room=${roomNumber}`);
      }
      ws.playerId = playerId;
      ws.roomNumber = roomNumber;

      if (!rooms[roomNumber].creatorId) {
        rooms[roomNumber].creatorId = playerId;
      }

      ws.send(JSON.stringify({ type: 'joinSuccess', roomNumber, playerId }));

      broadcastToRoom(roomNumber, {
        type: 'playerJoined',
        playerId,
        playerName: rooms[roomNumber].players.find(p => p.id === playerId).name,
        players: rooms[roomNumber].players.map(p => ({
          id: p.id,
          name: p.name,
          score: p.score,
          eliminated: p.eliminated,
        })),
        creatorId: rooms[roomNumber].creatorId,
      });

      if (rooms[roomNumber].started) {
        const player = rooms[roomNumber].players.find(p => p.id === playerId);
        if (!player.eliminated) {
          ws.send(
            JSON.stringify({
              type: 'gameState',
              cards: player.cards.concat(player.pendingCard ? [player.pendingCard] : []),
              currentPlayer: rooms[roomNumber].players[rooms[roomNumber].currentPlayerIndex]?.id || null,
              players: rooms[roomNumber].players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                eliminated: p.eliminated,
              })),
              started: true,
            })
          );
        }
      }

      ws.on('close', () => {
        if (roomNumber && rooms[roomNumber]) {
          console.log(`Player disconnected: ID=${playerId}, Room=${roomNumber}`);
          rooms[roomNumber].players = rooms[roomNumber].players.filter(p => p.id !== playerId);
          broadcastToRoom(roomNumber, {
            type: 'playerLeft',
            playerId,
            players: rooms[roomNumber].players.map(p => ({
              id: p.id,
              name: p.name,
              score: p.score,
              eliminated: p.eliminated,
            })),
          });
          if (rooms[roomNumber].players.length === 0) {
            console.log(`Room ${roomNumber} empty, deleting`);
            delete rooms[roomNumber];
          }
        }
      });
    }

    if (type === 'startGame') {
      if (!rooms[roomNumber] || rooms[roomNumber].started) return;
      const activePlayers = rooms[roomNumber].players.filter(p => !p.eliminated);
      if (activePlayers.length < 2) {
        ws.send(JSON.stringify({ type: 'error', message: 'Need at least 2 active players' }));
        return;
      }
      rooms[roomNumber].locked = true;
      startGame(roomNumber);
    }

    if (type === 'passCard' && rooms[roomNumber]) {
      if (!clientPlayerId) {
        console.error('Pass rejected: No playerId provided');
        ws.send(JSON.stringify({ type: 'error', message: 'Player ID required' }));
        return;
      }
      handlePassCard(roomNumber, clientPlayerId, card);
    }

    if (type === 'shoutBurro' && rooms[roomNumber]) {
      if (!clientPlayerId) {
        console.error('Shout rejected: No playerId provided');
        ws.send(JSON.stringify({ type: 'error', message: 'Player ID required' }));
        return;
      }
      handleShoutBurro(roomNumber, clientPlayerId);
    }
  });
});

function startGame(roomNumber) {
  const room = rooms[roomNumber];
  room.started = true;
  room.currentPlayerIndex = 0;
  room.burroShouted = false;
  room.reactionPlayers = new Set();
  room.firstShout = false;

  const activePlayers = room.players.filter(p => !p.eliminated);
  const numPlayers = activePlayers.length;
  const fullDeck = createDeck();
  const availableRanks = ['1', '2', '3', '4', '5', '6', '7', '10', '11', '12'];

  let selectedRanks = [...availableRanks];
  if (numPlayers < 10) {
    selectedRanks = [];
    const shuffledRanks = shuffleDeck([...availableRanks]);
    for (let i = 0; i < Math.min(numPlayers, availableRanks.length); i++) {
      selectedRanks.push(shuffledRanks[i]);
    }
  }

  let dealDeck = [];
  selectedRanks.forEach(rank => {
    const rankCards = fullDeck.filter(card => card.rank === rank);
    dealDeck.push(...rankCards);
  });

  dealDeck = shuffleDeck(dealDeck);

  activePlayers.forEach(player => {
    player.cards = dealDeck.splice(0, 4);
    player.pendingCard = null;
  });

  room.deck = dealDeck;

  console.log('Dealt cards:', activePlayers.map(p => ({ id: p.id, name: p.name, cards: p.cards })));

  for (let player of room.players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(
        JSON.stringify({
          type: 'gameState',
          cards: player.eliminated ? [] : player.cards.concat(player.pendingCard ? [player.pendingCard] : []),
          currentPlayer: activePlayers[room.currentPlayerIndex]?.id || null,
          players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            eliminated: p.eliminated,
          })),
          started: true,
        })
      );
    }
  }
}

function handlePassCard(roomNumber, playerId, card) {
  const room = rooms[roomNumber];
  const activePlayers = room.players.filter(p => !p.eliminated);
  console.log(`Pass attempt: player=${playerId}, current=${activePlayers[room.currentPlayerIndex]?.id}, card=`, card);
  if (!playerId) {
    console.error('Pass rejected: Invalid playerId');
    return;
  }
  if (activePlayers[room.currentPlayerIndex]?.id !== playerId || room.burroShouted) {
    console.log('Pass rejected: not player’s turn or burro shouted');
    return;
  }

  const player = room.players.find(p => p.id === playerId);
  if (!player || player.eliminated) {
    console.error('Pass rejected: Player not found or eliminated');
    return;
  }

  let passedCard = null;
  let isPendingCard = false;

  if (
    player.pendingCard &&
    card.rank === player.pendingCard.rank &&
    card.suit === player.pendingCard.suit
  ) {
    if (player.cards.length === 4) {
      console.error('Pass rejected: Cannot pass the pending card when you have 5 cards');
      player.ws.send(JSON.stringify({ type: 'error', message: 'Cannot pass the last received card when you have 5 cards' }));
      return;
    }
    passedCard = player.pendingCard;
    isPendingCard = true;
    player.pendingCard = null;
  } else {
    const cardIndex = player.cards.findIndex(
      (c) => c.rank === card.rank && c.suit === card.suit
    );
    if (cardIndex === -1) {
      console.error('Card not found:', card, 'in', player.cards, 'or pendingCard');
      player.ws.send(JSON.stringify({ type: 'error', message: 'Card not found in your hand' }));
      return;
    }
    passedCard = player.cards.splice(cardIndex, 1)[0];
  }

  let nextPlayerIndex = (room.currentPlayerIndex + 1) % activePlayers.length;
  const nextPlayer = activePlayers[nextPlayerIndex];
  if (!nextPlayer) {
    console.error('Pass rejected: Next player not found');
    return;
  }

  let newCard = null;
  if (player.pendingCard && !isPendingCard) {
    player.cards.push(player.pendingCard);
    newCard = player.pendingCard;
    player.pendingCard = null;
  }

  nextPlayer.pendingCard = passedCard;

  room.currentPlayerIndex = nextPlayerIndex;

  console.log(`Card passed: ${passedCard.rank} de ${passedCard.suit} from ${playerId} to ${nextPlayer.id}, isPending=${isPendingCard}`);
  console.log(`Player ${playerId} cards:`, player.cards, `pending:`, player.pendingCard);
  console.log(`Next player ${nextPlayer.id} cards:`, nextPlayer.cards, `pending:`, nextPlayer.pendingCard);

  for (let p of room.players) {
    if (p.ws.readyState === WebSocket.OPEN) {
      let displayCards = p.eliminated ? [] : [...p.cards];
      if (p.pendingCard) {
        displayCards.push(p.pendingCard);
      }
      while (displayCards.length < 4) {
        displayCards.push({ rank: 'placeholder', suit: 'none' });
      }
      p.ws.send(
        JSON.stringify({
          type: 'gameState',
          cards: displayCards,
          currentPlayer: activePlayers[room.currentPlayerIndex]?.id,
          players: room.players.map(pl => ({
            id: pl.id,
            name: pl.name,
            score: pl.score,
            eliminated: pl.eliminated,
          })),
          started: true,
          lastPassedCard: p.id === playerId && newCard ? newCard : null,
        })
      );
    }
  }

  activePlayers.forEach(p => checkForBurro(roomNumber, p.id));
}

function checkForBurro(roomNumber, playerId) {
  const room = rooms[roomNumber];
  const player = room.players.find(p => p.id === playerId);
  if (player.eliminated) return;

  const cardsToCheck = [...player.cards];
  if (player.pendingCard) {
    cardsToCheck.push(player.pendingCard);
  }
  const ranks = cardsToCheck.map(c => c.rank);
  console.log(`Checking burro for ${playerId}: ranks=`, ranks, `cards=`, cardsToCheck);

  if (cardsToCheck.length >= 4 && new Set(ranks).size === 1) {
    console.log(`Burro detected for ${playerId}`);
    room.burroShouted = true;
    broadcastToRoom(roomNumber, { type: 'burroAvailable' });
  }
}

function handleShoutBurro(roomNumber, playerId) {
  const room = rooms[roomNumber];
  if (!room.burroShouted) {
    console.log(`Shout ignored for ${playerId}: No burro available`);
    return;
 épa
  }

  if (!room.firstShout) {
    room.firstShout = true;
    broadcastToRoom(roomNumber, {
      type: 'firstBurroShouted',
      playerId,
    });
  }

  const activePlayers = room.players.filter(p => !p.eliminated);
  room.reactionPlayers.add(playerId);
  console.log(`Player ${playerId} shouted Burro. Reactions:`, [...room.reactionPlayers]);

  if (room.reactionPlayers.size === activePlayers.length || room.reactionPlayers.size === activePlayers.length - 1) {
    let loser = activePlayers.find(p => !room.reactionPlayers.has(p.id));
    if (!loser && room.reactionPlayers.size === activePlayers.length) {
      loser = activePlayers[activePlayers.length - 1];
    }
    if (loser) {
      const currentScore = loser.score;
      let newLetter = '';
      if (currentScore === '') {
        newLetter = 'B';
      } else if (currentScore === 'B') {
        newLetter = 'U';
      } else if (currentScore === 'BU') {
        newLetter = 'R';
      } else if (currentScore === 'BUR') {
        newLetter = 'R';
      } else if (currentScore === 'BURR') {
        newLetter = 'O';
      }

      if (newLetter) {
        loser.score += newLetter;
        console.log(`Score updated: ${loser.id} now has score ${loser.score}`);

        broadcastToRoom(roomNumber, {
          type: 'scoreUpdate',
          playerId: loser.id,
          score: loser.score,
          players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            eliminated: p.eliminated,
          })),
        });

        if (loser.score === 'BURRO') {
          loser.eliminated = true;
          loser.name = `${loser.name} burro`;
          loser.cards = [];
          loser.pendingCard = null;

          broadcastToRoom(roomNumber, {
            type: 'playerEliminated',
            playerId: loser.id,
            name: loser.name,
            players: room.players.map(p => ({
              id: p.id,
              name: p.name,
              score: p.score,
              eliminated: p.eliminated,
            })),
          });

          const remainingPlayers = room.players.filter(p => !p.eliminated);
          if (remainingPlayers.length === 1) {
            const winner = remainingPlayers[0];
            broadcastToRoom(roomNumber, {
              type: 'gameOver',
              winner: winner.id,
              winnerName: winner.name,
            });
            delete rooms[roomNumber];
            return;
          } else if (remainingPlayers.length >= 2) {
            startNextRound(roomNumber);
          }
        } else {
          startNextRound(roomNumber);
        }
      }
    }
    room.reactionPlayers = new Set();
    room.burroShouted = false;
    room.firstShout = false;
  }
}

function startNextRound(roomNumber) {
  const room = rooms[roomNumber];
  room.burroShouted = false;
  room.reactionPlayers = new Set();
  room.firstShout = false;
  startGame(roomNumber);
}

function broadcastToRoom(roomNumber, message) {
  const room = rooms[roomNumber];
  if (!room) return;
  console.log(`Broadcasting to room ${roomNumber}:`, message);
  for (let player of room.players) {
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  }
}