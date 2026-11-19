'use strict';

{
  const form = document.getElementById('simulator-form');
  const status = document.getElementById('simulator-status');
  const results = document.getElementById('simulator-results');
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const suits = ['♠', '♥', '♣', '♦'];
  const cards = hand => hand?.map(({rank, suit}) => ranks[rank] + suits[suit]).join(' ') ?? '—';
  const percent = (value, total) => total ? (100 * value / total).toFixed(1) + '%' : '—';

  if (walletScope === 'GC') {
    for (const [name, value] of [['minBet',100], ['maxBet',5000]]) {
      const input = form.elements.namedItem(name);
      input.min = input.step = 100;
      input.max = 250000;
      input.value = value;
    }
    form.elements.namedItem('startingBank').step = 1;
  }

  function renderSimulation(data) {
    const {totals} = data;
    const settled = totals.win + totals.loss + totals.push;
    const table = data.currency ? 'Wallet ' + data.currency : 'Practice';
    const rules = data.ruleset === 'standard' ? 'Standard Blackjack'
      : 'Bank-adjusted Simulation · Configured win ' + data.winRate + '% · Configured push ' + data.pushRate + '%';
    document.getElementById('simulator-rules').textContent = table + ' · ' + rules;
    const metrics = [
      ['Starting bank', formatCredits(data.initialBank)],
      ['Ending bank', formatCredits(data.endingBank)],
      ['Bank net', signedCredits(data.endingBank - data.initialBank)],
      ['Total wagered', formatCredits(totals.wagered)],
      ['Total returned', formatCredits(totals.returned)],
      ['Player return (RTP)', percent(totals.returned, totals.wagered)],
      ['Wins', totals.win + ' · ' + percent(totals.win, settled)],
      ['Losses', totals.loss + ' · ' + percent(totals.loss, settled)],
      ['Pushes', totals.push + ' · ' + percent(totals.push, settled)],
      ['Skipped for reserve', totals.skipped],
      ['Losses due to bank limit', totals.bankLimited]
    ];
    document.getElementById('simulator-summary').replaceChildren(...metrics.map(([label, value]) => {
      const group = document.createElement('div');
      const term = document.createElement('dt');
      const amount = document.createElement('dd');
      term.textContent = label;
      amount.textContent = value;
      group.append(term, amount);
      return group;
    }));

    document.getElementById('simulator-rounds').replaceChildren(...data.rounds.map(round => {
      const row = document.createElement('tr');
      const outcome = round.outcome === 'skipped' ? 'Skipped · reserve'
        : round.bankLimited ? 'Loss · bank limit' : round.outcome;
      for (const value of [round.number, formatCredits(round.bet), outcome, cards(round.player),
        cards(round.dealer), formatCredits(round.payout), formatCredits(round.bank)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    results.hidden = false;
    status.textContent = settled + ' of ' + data.rounds.length + ' rounds settled.';
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    results.hidden = true;
    status.textContent = 'Running simulation…';
    const values = new FormData(form);
    const payload = {roundCount:Number(values.get('roundCount'))};
    for (const field of ['minBet', 'maxBet', 'startingBank']) {
      if (values.get(field) !== '') payload[field] = Math.round(Number(values.get(field)) * 400);
    }

    try {
      renderSimulation(await dashboardRequest('simulate', payload));
    } catch (error) {
      if (error.status === 401) location.replace('/bank/');
      else status.textContent = error.status ? error.message : 'Simulation unavailable. Try again.';
    } finally {
      button.disabled = false;
    }
  });
}
