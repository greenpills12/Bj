'use strict';

const byId = id => document.getElementById(id);
const suits = ['♠', '♥', '♣', '♦'];
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const units = 400;
const chips = [[200, '0.50', '#2e6ccf'], [400, '1', '#ce192e'], [2000, '5', '#177441'], [10000, '25', '#29292b']];
const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const practiceWallet = 'zoya7.practice.balance';
const simulationWallet = 'zoya7.simulation.balance';
let simulation = false;
let sharedBank;
let pendingSimulation;
let balance = loadBalance(practiceWallet);
let muted = read('zoya7.practice.muted') === 'true';
const initialTable = new URLSearchParams(location.search).get('table');
let shoe = [], mode = initialTable === 'classic' ? 'classic' : 'regular';
let phase = 'bet', wagers = mode === 'classic' ? [0,0,0] : [0], selected = 0;
let dealer = [], hands = [], active = 0, insurance = 0, message = '', revealed = false;
const sound = Object.fromEntries(['card','chip','win','lose','push','blackjack'].map(name => [name,new Audio('assets/' + name + '.mp3')]));
const amount = n => (n / units).toLocaleString('en-US', {minimumFractionDigits:2,maximumFractionDigits:4});
const sum = values => values.reduce((a,b) => a+b,0);
const value = card => Math.min(card.rank + 1, 10);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const pause = ms => new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? Math.min(ms, 35) : ms));

function stopSounds() {
  for (const effect of Object.values(sound)) effect.pause();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSounds();
});

function play(name) {
  if (muted || document.hidden) return;
  sound[name].currentTime = 0;
  sound[name].play().catch(() => {});
}
function loadBalance(key) {
  const value = read(key);
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(+value) ? +value : 2 * units;
}
function changeBalance(delta) {
  balance += delta;
  save(simulation ? simulationWallet : practiceWallet, balance);
}
function randomBelow(limit) {
  const word = new Uint32Array(1);
  const bound = Math.floor(2 ** 32 / limit) * limit;
  do { crypto.getRandomValues(word); } while (word[0] >= bound);
  return word[0] % limit;
}
function shuffle() {
  shoe = Array.from({length:312}, (_,i) => ({rank:i % 13, suit:Math.floor(i / 13) % 4}));
  for (let i=shoe.length-1; i>0; i--) {
    const j = randomBelow(i+1);
    [shoe[i],shoe[j]] = [shoe[j],shoe[i]];
  }
}
function score(cards) {
  const low = sum(cards.map(value));
  return cards.some(c => c.rank === 0) && low <= 11 ? low+10 : low;
}
const natural = cards => cards.length === 2 && score(cards) === 21;
const newHand = (bet, spot, cards = [], split = false, stopped = false) => ({bet,spot,cards,split,stopped,outcome:''});
const done = hand => hand.stopped || score(hand.cards) >= 21;
const live = () => !['bet','settled'].includes(phase);

function reset(nextMode = mode) {
  if (mode !== nextMode) shoe = [];
  mode = nextMode;
  phase = 'bet';
  wagers = mode === 'classic' && !simulation ? [0,0,0] : [0];
  selected = active = insurance = 0;
  dealer = []; hands = [];
  revealed = false; message = '';
  render();
}
async function deal() {
  const stake = sum(wagers);
  if (phase !== 'bet' || !stake || stake > balance) return;
  if (simulation) {
    phase = 'dealing';
    message = 'Dealing simulation round…';
    render();
    return dealSimulation(stake);
  }
  if (shoe.length <= 78) shuffle();
  changeBalance(-stake);
  hands = wagers.flatMap((bet,spot) => bet ? [newHand(bet,spot)] : []);
  phase = 'dealing';
  message = 'Dealing…';
  render();
  for (let pass=0; pass<2; pass++) {
    for (const hand of hands) {
      hand.cards.push(shoe.pop());
      play('card'); render();
      await pause(145);
    }
    dealer.push(shoe.pop());
    play('card'); render();
    await pause(145);
  }
  if (dealer[0].rank === 0) {
    phase = 'insurance';
    message = 'Insurance available · ' + amount(stake / 2);
    render();
  } else {
    peek();
  }
}
function simulationCards(outcome) {
  while (true) {
    const positions = new Set();
    function draw() {
      let position;
      do { position = randomBelow(312); } while (positions.has(position));
      positions.add(position);
      return {rank:position % 13, suit:Math.floor(position / 13) % 4};
    }
    const player = [draw()];
    const house = [draw()];
    player.push(draw());
    house.push(draw());
    const playerNatural = natural(player);
    const dealerNatural = natural(house);
    if (!playerNatural && !dealerNatural) {
      while (score(player) < 17) player.push(draw());
      if (score(player) <= 21) {
        while (score(house) < 17) house.push(draw());
      }
    }
    const playerTotal = score(player);
    const dealerTotal = score(house);
    const push = (playerNatural && dealerNatural) ||
      (!playerNatural && !dealerNatural && playerTotal === dealerTotal && playerTotal <= 21);
    const playerWon = !dealerNatural &&
      (playerNatural || (playerTotal <= 21 && (dealerTotal > 21 || playerTotal > dealerTotal)));
    const result = push ? 'push' : playerWon ? 'win' : 'loss';
    if (result === outcome) return {player, house};
  }
}

async function dealSimulation(stake) {
  if (stake > 250 * units) {
    phase = 'bet';
    message = 'Simulation bet limit: 250 credits.';
    render();
    return;
  }
  if (pendingSimulation && pendingSimulation.stake !== stake) {
    phase = 'bet';
    message = 'Retry the previous bet of ' + amount(pendingSimulation.stake) + ' credits.';
    render();
    return;
  }
  pendingSimulation ??= {id:crypto.randomUUID(), stake};
  let result;
  try {
    result = await bankRequest('round', pendingSimulation);
  } catch (error) {
    if (error.status >= 400 && error.status < 500) pendingSimulation = null;
    phase = 'bet';
    message = error.status ? error.message : 'Shared bank unavailable. Retry the same bet.';
    render();
    return;
  }
  pendingSimulation = null;
  sharedBank = result.bank;
  const {player, house} = simulationCards(result.round.outcome);
  changeBalance(-stake);
  hands = [newHand(stake,0)];
  const playerCards = hands[0].cards;
  const initial = [[playerCards, player[0]], [dealer, house[0]],
    [playerCards, player[1]], [dealer, house[1]]];
  for (const [hand, card] of [...initial, ...player.slice(2).map(card => [playerCards, card])]) {
    hand.push(card);
    play('card'); render();
    await pause(145);
  }
  phase = 'dealer';
  message = 'Dealer plays…';
  revealed = true;
  play('card'); render();
  for (const card of house.slice(2)) {
    await pause(320);
    dealer.push(card);
    play('card'); render();
  }
  await pause(300);
  settle(natural(dealer));
}
function peek() {
  if (natural(dealer)) {
    finishDealer();
    return;
  }
  phase = 'player';
  advance();
}
function insure(take) {
  const cost = sum(wagers) / 2;
  if (phase !== 'insurance' || (take && cost > balance)) return;
  if (take) { insurance = cost; changeBalance(-cost); }
  peek();
}
function advance() {
  while (active < hands.length && done(hands[active])) active++;
  if (active === hands.length) {
    finishDealer();
  } else {
    message = hands.length > 1 ? 'Play hand ' + (active+1) : 'Your move';
    render();
  }
}
function canSplit(hand) {
  return hand.cards.length === 2 && value(hand.cards[0]) === value(hand.cards[1])
    && hands.filter(h => h.spot === hand.spot).length < 4 && hand.bet <= balance;
}
function move(action) {
  if (phase !== 'player') return;
  const hand = hands[active];
  if (action === 'stand') {
    hand.stopped = true;
  } else if (action === 'split') {
    if (!canSplit(hand)) return;
    changeBalance(-hand.bet);
    const aces = hand.cards[0].rank === 0;
    hands.splice(active,1,...hand.cards.map(card => newHand(hand.bet,hand.spot,[card,shoe.pop()],true,aces)));
    play('card');
  } else {
    if (action === 'double') {
      if (hand.cards.length !== 2 || hand.bet > balance) return;
      changeBalance(-hand.bet);
      hand.bet *= 2; hand.stopped = true;
    }
    hand.cards.push(shoe.pop()); play('card');
  }
  advance();
}
async function finishDealer() {
  phase = 'dealer';
  message = 'Dealer plays…';
  render();
  await pause(300);
  revealed = true;
  play('card'); render();
  const dealerNatural = natural(dealer);
  const needsComparison = hands.some(h => score(h.cards) <= 21 && (h.split || !natural(h.cards)));
  while (!dealerNatural && needsComparison && score(dealer) < 17) {
    await pause(320);
    dealer.push(shoe.pop());
    play('card'); render();
  }
  await pause(300);
  settle(dealerNatural);
}
function settle(dealerNatural) {
  const total = score(dealer);
  let returned = dealerNatural ? insurance * 3 : 0;
  for (const hand of hands) {
    const points = score(hand.cards);
    const blackjack = !hand.split && natural(hand.cards);
    if (points > 21) hand.outcome = 'Bust';
    else if (blackjack && !dealerNatural) { hand.outcome = 'Blackjack'; returned += hand.bet * (simulation ? 2 : 2.5); }
    else if ((dealerNatural && blackjack) || (!dealerNatural && points === total)) { hand.outcome = 'Push'; returned += hand.bet; }
    else if (!dealerNatural && (total > 21 || points > total)) { hand.outcome = 'Win'; returned += hand.bet * 2; }
    else hand.outcome = 'Loss';
  }
  changeBalance(returned);
  const net = returned - sum(hands.map(h => h.bet)) - insurance;
  message = (net > 0 ? '+' : net < 0 ? '−' : '') + amount(Math.abs(net)) + ' credits';
  if (insurance) message += dealerNatural ? ' · Insurance paid' : ' · Insurance lost';
  phase = 'settled';
  play(net > 0 ? (hands.some(h => h.outcome === 'Blackjack') ? 'blackjack' : 'win') : net < 0 ? 'lose' : 'push');
  render();
}

function cardRow(cards, hideHole = false) {
  const row = document.createElement('div');
  row.className = 'cards';
  cards.forEach((card, i) => {
    const element = document.createElement('span');
    if (hideHole && i === 1) {
      element.className = 'card down';
      element.setAttribute('aria-label','Face-down card');
      element.innerHTML = '<span class="card-back" aria-hidden="true">Z7</span>';
    } else {
      const rank = ranks[card.rank];
      const suit = suits[card.suit];
      element.className = 'card' + (card.suit === 1 || card.suit === 3 ? ' red' : '');
      element.setAttribute('aria-label', rank + ' of ' + ['spades','hearts','clubs','diamonds'][card.suit]);
      element.innerHTML = '<span class="card-art" aria-hidden="true">' +
        '<span class="corner">' + rank + '<i>' + suit + '</i></span>' +
        '<span class="card-suit">' + suit + '</span>' +
        '<span class="corner inverse">' + rank + '<i>' + suit + '</i></span></span>';
    }
    row.append(element);
  });
  return row;
}
function label(text) {
  const span = document.createElement('span');
  span.className = 'hand-label'; span.textContent = text;
  return span;
}
function button(text, handler, kind, disabled = false) {
  const element = document.createElement('button');
  element.textContent = text;
  element.onclick = handler;
  element.className = kind;
  element.disabled = disabled;
  return element;
}
function render() {
  const betting = phase === 'bet';
  byId('table').classList.toggle('classic',mode === 'classic');
  byId('title').textContent = mode === 'classic' ? 'Blackjack Classic' : 'Blackjack';
  byId('table-note').textContent = simulation ? 'Simulation Mode · Bank-adjusted odds · Bank ' + (sharedBank ? amount(sharedBank.balance) : '—') : 'Dealer stands on all 17s';
  byId('table').classList.toggle('simulation', simulation);
  byId('wallet').setAttribute('aria-label', simulation ? 'Simulation credit balance' : 'Practice credit balance');
  byId('simulation').textContent = simulation ? 'Exit Simulation Mode' : 'Enter Simulation Mode';
  byId('simulation').setAttribute('aria-pressed', String(simulation));
  byId('simulation').disabled = live();
  byId('bank-link').hidden = live();
  byId('back').disabled = live();
  byId('refill').disabled = live();
  byId('balance').textContent = amount(balance);
  byId('sound').textContent = muted ? 'Sound off' : 'Sound on';
  byId('status').textContent = betting && balance < chips[0][0] ? 'Open rules to refill practice credits' : message;
  const spots = byId('spots');
  spots.hidden = !betting;
  spots.replaceChildren(...wagers.map((bet,i) => {
    const spot = button('',() => { selected=i; render(); },'spot' + (bet ? ' funded' : ''));
    if (wagers.length > 1) spot.setAttribute('aria-pressed',String(selected===i));
    const chipLabel = (bet / units).toLocaleString('en-US', {maximumFractionDigits:2});
    const ringContent = bet ? '<span class="placed-chip" aria-hidden="true">' + chipLabel + '</span>'
      : wagers.length > 1 ? 'SPOT ' + (i+1) : 'BET';
    spot.innerHTML = '<span class="bet-ring">' + ringContent +
      '</span><span class="bet-copy"><strong>' + (bet ? 'YOUR BET' : 'PLACE YOUR BET') +
      '</strong><small>' + (bet ? amount(bet) : 'Tap chips below') + '</small></span>';
    if (wagers.length > 1) {
      spot.setAttribute('aria-label', 'Spot ' + (i+1) + (bet ? ', your bet ' + amount(bet) : ', place your bet'));
    }
    return spot;
  }));
  const dealerPanel = byId('dealer');
  dealerPanel.hidden = betting;
  dealerPanel.replaceChildren(label('DEALER' + (revealed ? ' · ' + score(dealer) : '')),cardRow(dealer,!revealed));
  const handPanel = byId('hands');
  handPanel.hidden = betting;
  handPanel.replaceChildren(...hands.map((hand,i) => {
    const section = document.createElement('div');
    section.className = 'hand' + (phase === 'player' && active === i ? ' active' : '');
    const name = mode === 'classic' ? 'SPOT ' + (hand.spot+1) : hands.length === 1 ? 'YOU' : 'HAND ' + (i+1);
    const summary = label(name);
    const total = document.createElement('b');
    total.className = 'total';
    total.textContent = score(hand.cards);
    const stake = document.createElement('span');
    stake.className = 'hand-stake';
    stake.textContent = amount(hand.bet);
    summary.append(total, stake);
    if (hand.outcome) summary.append(' · ' + hand.outcome);
    section.append(summary,cardRow(hand.cards));
    return section;
  }));
  if (phase === 'player' && handPanel.scrollWidth > handPanel.clientWidth) {
    const current = handPanel.children[active];
    const offset = current.getBoundingClientRect().left - handPanel.getBoundingClientRect().left;
    handPanel.scrollLeft += offset - (handPanel.clientWidth - current.offsetWidth) / 2;
  }
  const chipPanel = byId('chips');
  chipPanel.hidden = !betting;
  chipPanel.replaceChildren(...chips.map(([credit,text,color]) => {
    const chip = button(text,() => { wagers[selected]+=credit; play('chip'); render(); },'chip',sum(wagers)+credit>balance);
    chip.style.setProperty('--chip',color);
    chip.setAttribute('aria-label','Bet ' + text + ' credits');
    return chip;
  }));
  const actions = byId('actions');
  actions.replaceChildren();
  const add = (text, callback, disabled = false, primary = true) =>
    actions.append(button(text,callback,primary?'primary':'secondary',disabled));
  if (betting) {
    if (sum(wagers)) add('Clear',() => { wagers.fill(0); render(); },false,false);
    add('Deal',deal,!sum(wagers));
    actions.lastElementChild.setAttribute('aria-keyshortcuts', 'Enter Space');
  }
  if (phase === 'insurance') {
    add('Decline',() => insure(false),false,false);
    add('Insurance',() => insure(true),sum(wagers)/2>balance);
  }
  if (phase === 'player') {
    const hand = hands[active];
    add('Hit',() => move('hit'));
    add('Stand',() => move('stand'));
    add('Double',() => move('double'),hand.cards.length !== 2 || hand.bet > balance);
    add('Split',() => move('split'),!canSplit(hand));
  }
  if (phase === 'settled') add('New round',() => reset());
}
byId('back').onclick = () => {
  window.open('https://zoya777.greenpills12.workers.dev/', '_top');
};
byId('simulation').onclick = () => {
  if (live()) return;
  save(simulation ? simulationWallet : practiceWallet, balance);
  simulation = !simulation;
  balance = loadBalance(simulation ? simulationWallet : practiceWallet);
  byId('rules').close();
  reset();
  if (simulation) refreshSharedBank();
};
if (location.protocol !== 'file:') byId('bank-link').href = '/bank';
byId('bank-link').onclick = event => { if (live()) event.preventDefault(); };
byId('info').onclick = () => byId('rules').showModal();
byId('sound').onclick = () => {
  muted = !muted;
  if (muted) stopSounds();
  save('zoya7.practice.muted',muted);
  render();
};
byId('refill').onclick = () => {
  if (live()) return;
  changeBalance(Math.max(25*units-balance,0));
  byId('rules').close();
  reset();
};
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
      document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape' && !live()) {
    event.preventDefault();
    byId('back').click();
    return;
  }
  if (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.closest('button, a, input, select, textarea, summary'))) return;
  if (phase === 'bet' && sum(wagers) && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    deal();
  }
});
document.querySelectorAll('[data-close]').forEach(el => el.onclick = () => byId(el.dataset.close).close());
document.querySelectorAll('[data-table]').forEach(el => el.onclick = () => {
  if (live()) return;
  reset(el.dataset.table);
  byId('lobby').close();
});
render();

async function refreshSharedBank() {
  try {
    const snapshot = await bankRequest('status');
    if (simulation && !live()) {
      sharedBank = snapshot;
      render();
    }
  } catch {}
}
window.addEventListener('focus', () => { if (simulation) refreshSharedBank(); });
