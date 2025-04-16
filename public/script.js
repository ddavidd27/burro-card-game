let ws = null;
let playerId = null;
let roomNumber = null;

function createGame() {
  const playerName = document.getElementById('createPlayerName').value.trim();
  if (!playerName) {
    showError('Please enter your name');
    return;
  }
  localStorage.setItem('playerName', playerName);
  localStorage.removeItem('playerId');
  connectWebSocket({ type: 'createGame', playerName });
}

function joinGame() {
  const playerName = document.getElementById('joinPlayerName').value.trim();
  const roomNum = document.getElementById('roomNumber').value.trim();
  if (!playerName || !roomNum) {
    showError('Please enter your name and room number');
    return;
  }
  localStorage.setItem('playerName', playerName);
  localStorage.removeItem('playerId');
  roomNumber = roomNum;
  connectWebSocket({ type: 'joinGame', roomNumber, playerName });
}

function connectWebSocket(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('WebSocket open, sending:', message);
    ws.send(JSON.stringify(message));
    return;
  }
  ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    console.log('WebSocket opened, sending:', message);
    ws.send(JSON.stringify(message));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received:', data);

    if (data.type === 'roomCreated') {
      roomNumber = data.roomNumber;
      window.location.href = `game.html?room=${roomNumber}`;
    }

    if (data.type === 'joinSuccess') {
      playerId = data.playerId;
      localStorage.setItem('playerId', playerId);
      console.log('Join success, playerId:', playerId);
      roomNumber = data.roomNumber;
      window.location.href = `game.html?room=${roomNumber}`;
    }

    if (data.type === 'error') {
      showError(data.message);
    }

    if (window.location.pathname.includes('game.html')) {
      if (data.type === 'playerJoined') {
        updatePlayers(data.players, data.creatorId);
      }

      if (data.type === 'gameState') {
        updateGameState(data);
      }

      if (data.type === 'burroAvailable') {
        console.log('Burro available received for player:', playerId);
        const burroButton = document.getElementById('burroButton');
        if (burroButton) {
          burroButton.disabled = false;
        } else {
          console.error('burroButton not found in DOM');
        }
      }

      if (data.type === 'scoreUpdate') {
        updatePlayers(data.players, gameState.creatorId);
      }

      if (data.type === 'playerEliminated') {
        updatePlayers(data.players, gameState.creatorId);
      }

      if (data.type === 'gameOver') {
        alert(`Game Over! ${data.winnerName} won!`);
        localStorage.clear();
        window.location.href = 'index.html';
      }
    }
  };

  ws.onclose = () => {
    console.log('WebSocket closed');
    showError('Disconnected from server. Trying to reconnect...');
    ws = null;
  };
}

function showError(message) {
  const errorElement = document.getElementById('error') || document.getElementById('status');
  if (errorElement) errorElement.textContent = message;
}

let gameState = { players: {}, cards: [], currentPlayer: '', started: false, creatorId: null };

if (window.location.pathname.includes('game.html')) {
  const urlParams = new URLSearchParams(window.location.search);
  roomNumber = urlParams.get('room');
  document.getElementById('roomNumber').textContent = roomNumber;

  playerId = localStorage.getItem('playerId');
  console.log('Game page loaded, playerId:', playerId);

  connectWebSocketForGame();

  const rulesButton = document.getElementById('rulesButton');
  const rulesModal = document.getElementById('rulesModal');
  const closeRules = document.getElementById('closeRules');

  if (rulesButton && rulesModal && closeRules) {
    rulesButton.onclick = () => {
      rulesModal.style.display = 'flex';
    };
    closeRules.onclick = () => {
      rulesModal.style.display = 'none';
    };
    window.onclick = (event) => {
      if (event.target === rulesModal) {
        rulesModal.style.display = 'none';
      }
    };
  }
}

function connectWebSocketForGame() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('Game WebSocket already open');
    return;
  }
  ws = new WebSocket('ws://localhost:3000');

  ws.onopen = () => {
    const playerName = localStorage.getItem('playerName') || 'Player';
    const joinMessage = { type: 'joinGame', roomNumber, playerName, playerId };
    console.log('Sending joinGame:', joinMessage);
    ws.send(JSON.stringify(joinMessage));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Game received:', data);

    if (data.type === 'joinSuccess') {
      playerId = data.playerId;
      localStorage.setItem('playerId', playerId);
      console.log('Joined, playerId:', playerId);
    }
    if (data.type === 'gameState') {
      gameState = {
        players: Object.fromEntries(
          data.players.map((p) => [p.id, { name: p.name || 'Player', score: p.score, eliminated: p.eliminated }])
        ),
        cards: data.cards,
        currentPlayer: data.currentPlayer,
        started: data.started || false,
        creatorId: data.creatorId || gameState.creatorId,
      };
      updateGameState(data);
    }
    if (data.type === 'burroAvailable') {
      console.log('Burro available received for player:', playerId);
      const burroButton = document.getElementById('burroButton');
      if (burroButton) {
        burroButton.disabled = false;
      } else {
        console.error('burroButton not found in DOM');
      }
    }
    if (data.type === 'scoreUpdate') {
      data.players.forEach(p => {
        gameState.players[p.id] = { name: p.name || 'Player', score: p.score, eliminated: p.eliminated };
      });
      updatePlayers(data.players, gameState.creatorId);
    }
    if (data.type === 'playerEliminated') {
      data.players.forEach(p => {
        gameState.players[p.id] = { name: p.name || 'Player', score: p.score, eliminated: p.eliminated };
      });
      updatePlayers(data.players, gameState.creatorId);
    }
    if (data.type === 'gameOver') {
      alert(`Game Over! ${data.winnerName} won!`);
      localStorage.clear();
      window.location.href = 'index.html';
    }
    if (data.type === 'playerJoined') {
      gameState.creatorId = data.creatorId;
      data.players.forEach(p => {
        gameState.players[p.id] = { name: p.name || 'Player', score: p.score, eliminated: p.eliminated };
      });
      updatePlayers(data.players, data.creatorId);
    }
    if (data.type === 'error') {
      showError(data.message);
    }
  };

  ws.onclose = () => {
    console.log('Game WebSocket closed');
    showError('Disconnected from server. Trying to reconnect...');
    ws = null;
    setTimeout(connectWebSocketForGame, 1000);
  };

  const burroButton = document.getElementById('burroButton');
  if (burroButton) {
    burroButton.onclick = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        showError('Not connected to server. Please wait...');
        connectWebSocketForGame();
        return;
      }
      console.log('Shout Burro clicked by player:', playerId);
      ws.send(JSON.stringify({ type: 'shoutBurro', roomNumber, playerId }));
      burroButton.disabled = true;
    };
  } else {
    console.error('burroButton not found during initialization');
  }

  const startButton = document.getElementById('startButton');
  if (startButton) {
    startButton.onclick = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        showError('Not connected to server. Please wait...');
        connectWebSocketForGame();
        return;
      }
      ws.send(JSON.stringify({ type: 'startGame', roomNumber, playerId }));
    };
  }
}

function updatePlayers(players, creatorId) {
  const playersDiv = document.getElementById('players');
  if (!playersDiv) return;
  playersDiv.innerHTML = '<h2>Players</h2>';
  players.forEach((p) => {
    const playerDiv = document.createElement('div');
    playerDiv.className = 'player';
    const displayName = p.name || 'Player';
    let playerText = displayName;
    if (p.score) {
      playerText += ` (${p.score})`;
    }
    if (p.id === creatorId) {
      playerText += ' (Creator)';
    }
    playerDiv.textContent = playerText;
    if (p.eliminated) {
      playerDiv.classList.add('eliminated');
    }
    playersDiv.appendChild(playerDiv);
  });
}

function updateGameState(data) {
  console.log('Game state:', data, 'playerId:', playerId, 'cards:', data.cards);
  const cardsDiv = document.getElementById('cards');
  if (!cardsDiv) return;
  cardsDiv.innerHTML = '<h2>Your Cards</h2>';
  if (!data.cards || data.cards.length === 0) {
    cardsDiv.innerHTML += '<p>No cards yet. Waiting for game to start...</p>';
    return;
  }
  data.cards.forEach((card, index) => {
    if (card.rank === 'placeholder') return;
    const cardContainer = document.createElement('div');
    cardContainer.className = 'card-container';

    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.style.backgroundImage = `url('/images/${card.rank}_${card.suit}.png')`;
    cardDiv.textContent = `${card.rank} de ${card.suit}`;
    cardDiv.style.textIndent = '-9999px';
    if (data.lastPassedCard && card.rank === data.lastPassedCard.rank && card.suit === data.lastPassedCard.suit) {
      cardDiv.classList.add('new-card');
      setTimeout(() => cardDiv.classList.remove('new-card'), 2000);
    }

    const passButton = document.createElement('button');
    passButton.textContent = 'Pass';
    passButton.className = 'card-pass-button';
    const isTurn = data.started && data.currentPlayer === playerId;
    passButton.disabled = !isTurn || card.rank === 'placeholder';
    console.log(`Pass button for card ${card.rank} de ${card.suit}: disabled=${passButton.disabled}, started=${data.started}, isTurn=${isTurn}`);
    passButton.onclick = () => {
      console.log('Passing card:', card);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        showError('Not connected to server. Please wait...');
        connectWebSocketForGame();
        return;
      }
      ws.send(JSON.stringify({ type: 'passCard', roomNumber, playerId, card }));
      const status = document.getElementById('status');
      if (status) {
        status.textContent = 'Waiting for other player...';
      }
    };

    cardContainer.appendChild(cardDiv);
    cardContainer.appendChild(passButton);
    cardsDiv.appendChild(cardContainer);
  });

  const status = document.getElementById('status');
  if (status) {
    status.textContent = data.started
      ? data.currentPlayer === playerId
        ? 'Your turn! Click a Pass button to pass a card.'
        : `Waiting for ${data.players.find(p => p.id === data.currentPlayer)?.name || 'other player'}...`
      : 'Waiting for game to start...';
  }

  const startButton = document.getElementById('startButton');
  if (startButton) {
    startButton.disabled = data.started || data.players.filter(p => !p.eliminated).length < 2 || playerId !== data.creatorId;
  }
}