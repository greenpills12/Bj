'use strict';

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

function renderBank() {
  if (!bank) return;
  if (!editingRates) showRates([bank.winRate, 100 - bank.winRate - bank.pushRate, bank.pushRate]);
  document.getElementById('rate-sliders').disabled = savingRates;
  const {collected, paid, reserve} = bank;
  for (const [id, value] of Object.entries({'bank-balance':bankBalance(bank), collected, paid, reserve, 'game-net':collected-paid})) {
    document.getElementById(id).textContent = formatCredits(value);
  }
  document.getElementById('adjustment').textContent = signedCredits(bank.adjustment);
  document.getElementById('base-odds').textContent = oddsText(simulationOdds(bank, 0));
  const stake = Math.round(previewBet.valueAsNumber * 400);
  document.getElementById('effective-odds').textContent = Number.isSafeInteger(stake) && stake > 0
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
    const snapshot = await bankRequest('bank');
    if (current !== version) return;
    bank = snapshot;
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
      winRate:editingRates ? win.valueAsNumber : undefined,
      pushRate:editingRates ? push.valueAsNumber : undefined
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
      const snapshot = await bankRequest(endpoint, readPayload());
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
      if (rateFields) { savingRates = false; rateFields.disabled = !bank; }
    }
  });
}
window.addEventListener('pageshow', refreshBank);
window.addEventListener('focus', refreshBank);
setInterval(() => { if (!document.hidden) refreshBank(); }, 5000);
