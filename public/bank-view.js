'use strict';

const walletScope = new URLSearchParams(location.search).get('wallet');
const walletAccount = ['GC','DC'].includes(walletScope);
if (walletAccount) document.getElementById('bank-title').textContent = 'Wallet Bank · ' + walletScope;
function dashboardRequest(path, payload) {
  const scope = walletAccount ? walletScope : null;
  return bankRequest(path + (scope ? (path.includes('?') ? '&' : '?') + 'wallet=' + scope : ''), payload);
}

const formatCredits = value => (value / 400).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 4
});
const signedCredits = value => (value > 0 ? '+' : '') + formatCredits(value);

const oddsText = ({win, loss, push}) => win + '% / ' + loss + '% / ' + push + '%';
const previewBet = document.getElementById('preview-bet');
previewBet?.addEventListener('input', renderBank);

const rateSliders = ['target-rate','target-loss','target-push'].map(id => document.getElementById(id));
const rateLabels = rateSliders.map(input => input.previousElementSibling);
let editingRates = false;
let savingRates = false;

function showRates(rates) {
  rates.forEach((rate, index) => {
    rateSliders[index].value = rate;
    rateLabels[index].value = rate + '%';
    rateSliders[index].setAttribute('aria-valuetext', rate + '%');
  });
}

rateSliders.forEach((slider, index) => slider.addEventListener('input', () => {
  editingRates = true;
  const rates = rateSliders.map(input => input.valueAsNumber);
  const [first, second] = [0,1,2].filter(i => i !== index);
  const remaining = 100 - rates[index];
  const otherTotal = rates[first] + rates[second];
  rates[first] = otherTotal ? Math.round(remaining * rates[first] / otherTotal) : remaining;
  rates[second] = remaining - rates[first];
  showRates(rates);
}));

let bank;
let activeWalletMode;
const modeForm = document.getElementById('wallet-mode-form');
const modeSelect = document.getElementById('wallet-mode');
const modeSave = modeForm.querySelector('button');
let savingMode = false;

function showWalletMode(ruleset) {
  const isEdited = !!activeWalletMode && modeSelect.value !== activeWalletMode;
  activeWalletMode = ruleset;
  if (!isEdited) modeSelect.value = ruleset;
  modeSelect.disabled = savingMode;
  modeSave.disabled = savingMode;
}

modeForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!activeWalletMode || savingMode) return;
  const status = document.getElementById('wallet-mode-status');
  savingMode = modeSelect.disabled = modeSave.disabled = true;
  try {
    const {ruleset} = await bankRequest('wallet/settings', {ruleset:modeSelect.value});
    activeWalletMode = modeSelect.value = ruleset;
    status.textContent = 'Saved for new Zoya7 wallet rounds.';
    renderBank();
    await refreshBank();
  } catch (error) {
    status.textContent = error.status ? error.message : 'Could not confirm the table mode. Check the saved mode before retrying.';
  } finally {
    savingMode = modeSelect.disabled = modeSave.disabled = false;
  }
});


function renderBank() {
  if (!bank) return;
  if (!editingRates) showRates([bank.winRate, 100 - bank.winRate - bank.pushRate, bank.pushRate]);
  const walletStandard = walletAccount && activeWalletMode === 'standard';
  document.getElementById('rate-sliders').disabled = savingRates || walletStandard;
  const {collected, paid, reserve} = bank;
  for (const [id, value] of Object.entries({'bank-balance':bankBalance(bank), collected, paid, reserve, 'game-net':collected-paid})) {
    document.getElementById(id).textContent = formatCredits(value);
  }
  document.getElementById('adjustment').textContent = signedCredits(bank.adjustment);
  document.getElementById('base-odds').textContent = walletStandard ? 'Standard Blackjack · Card results' : oddsText({win:bank.winRate, push:bank.pushRate, loss:100-bank.winRate-bank.pushRate});
  document.getElementById('held-reserve').textContent = formatCredits(bank.held ?? 0);
  const stake = Math.round(previewBet.valueAsNumber * 400);
  document.getElementById('effective-odds').textContent = walletStandard ? 'Standard Blackjack uses the cards to settle each round.' : Number.isSafeInteger(stake) && stake > 0
    ? 'Win / loss / push: ' + oddsText(simulationOdds(bank, stake))
    : 'Enter a positive bet amount.';
  const lastChange = document.getElementById('last-change');
  if (lastChange) {
    lastChange.textContent = bank.lastChange == null ? '—'
      : signedCredits(bank.lastChange);
  }
  const history = document.getElementById('history');
  if (!history) return;
  const rounds = (bank.rounds ?? []).filter(round => round &&
    [round.bet, round.change, round.balance].every(Number.isSafeInteger));
  document.getElementById('history-empty').hidden = rounds.length > 0;
  document.getElementById('history-table').hidden = rounds.length === 0;
  const wins = rounds.filter(round => round.change < 0).length;
  const losses = rounds.filter(round => round.change > 0).length;
  document.getElementById('observed-odds').textContent = [wins, losses, rounds.length-wins-losses].join(' / ');
  history.replaceChildren(...rounds.map(round => {
    const row = document.createElement('tr');
    const outcome = round.change < 0 ? 'Win' : round.change === 0 ? 'Push' : round.bankLimited ? 'Loss · bank limit' : 'Loss';
    for (const value of [formatCredits(round.bet), outcome, signedCredits(round.change),
      formatCredits(round.balance - round.change), formatCredits(round.balance)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));
}
const connection = document.getElementById('bank-connection');
let version = 0;
async function refreshBank() {
  const current = ++version;
  try {
    const snapshot = await dashboardRequest('bank');
    if (current !== version) return;
    bank = snapshot;
    if (snapshot.walletRuleset && !savingMode) showWalletMode(snapshot.walletRuleset);
    connection.textContent = 'Connected · Shared bank';
    renderBank();
  } catch (error) {
    if (error.status === 401) {
      location.replace('/bank/');
      return;
    }
    if (current === version) connection.textContent = 'Shared bank unavailable. Reconnect to see current values.';
  }
}
const credits = id => Math.round(document.getElementById(id).valueAsNumber * 400);
for (const [formId, endpoint, statusId, readPayload] of [
  ['reserve-form', 'reserve', 'reserve-status', () => ({amount:credits('reserve-amount')})],
  ['settings-form', 'settings', 'settings-status', () => {
    const target = document.getElementById('target-bank');
    const win = document.getElementById('target-rate');
    const push = document.getElementById('target-push');
    return {
      target:target.value === '' ? undefined : credits('target-bank'),
      winRate:editingRates && !(walletAccount && activeWalletMode === 'standard') ? win.valueAsNumber : undefined,
      pushRate:editingRates && !(walletAccount && activeWalletMode === 'standard') ? push.valueAsNumber : undefined
    };
  }]
]) {
  const form = document.getElementById(formId);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById(statusId);
    const button = form.querySelector('button');
    const rateFields = form.querySelector('#rate-sliders');
    button.disabled = true;
    if (rateFields) { savingRates = true; rateFields.disabled = true; }
    try {
      const snapshot = await dashboardRequest(endpoint, readPayload());
      ++version;
      bank = snapshot;
      if (endpoint === 'settings') editingRates = false;
      status.textContent = endpoint === 'reserve' ? 'Reserve credits added.' : 'Settings saved.';
      form.reset();
      renderBank();
    } catch (error) {
      status.textContent = error.status ? error.message : 'Unable to confirm the update. Check the bank before retrying.';
    } finally {
      button.disabled = false;
      if (rateFields) {
        savingRates = false;
        if (bank) renderBank();
      }
    }
  });
}
const archiveMore = document.getElementById('archive-more');
const archiveReset = document.getElementById('archive-reset');
const archiveRows = document.getElementById('archive-rows');
const archiveTable = document.getElementById('archive-table');
const archiveStatus = document.getElementById('archive-status');
let archiveCursor = null;

async function loadArchive() {
  if (archiveMore.disabled) return;
  archiveMore.disabled = true;
  archiveReset.disabled = true;
  archiveStatus.textContent = 'Loading rounds…';
  try {
    const query = archiveCursor ? '?after=' + encodeURIComponent(archiveCursor) : '';
    const {rounds, nextAfter} = await dashboardRequest('history' + query);
    if (!rounds.length) {
      archiveStatus.textContent = 'No rounds recorded yet.';
      archiveMore.hidden = true;
      return;
    }
    archiveRows.replaceChildren(...rounds.map(round => {
      const row = document.createElement('tr');
      const when = Number.isFinite(round.at) ? new Date(round.at).toLocaleString() : '—';
      const outcome = round.bankLimited ? 'Loss · bank limit' : round.outcome;
      for (const value of [round.id, round.playerId ?? '—', when, formatCredits(round.bet), outcome,
        signedCredits(round.change), formatCredits(round.balance)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    archiveCursor = nextAfter;
    archiveTable.hidden = false;
    archiveMore.textContent = 'Next page';
    archiveMore.hidden = !nextAfter;
    archiveReset.hidden = false;
    archiveStatus.textContent = rounds.length + ' recorded rounds on this page.';
  } catch (error) {
    if (error.status === 401) location.replace('/bank/');
    else archiveStatus.textContent = 'Could not load the archive. Try again.';
  } finally {
    archiveMore.disabled = false;
    archiveReset.disabled = false;
  }
}
archiveMore.addEventListener('click', loadArchive);
archiveReset.addEventListener('click', () => {
  archiveCursor = null;
  archiveMore.hidden = false;
  loadArchive();
});

window.addEventListener('pageshow', refreshBank);
window.addEventListener('focus', refreshBank);
setInterval(() => { if (!document.hidden) refreshBank(); }, 5000);
