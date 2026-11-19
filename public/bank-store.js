'use strict';

const bankBalance = ({collected, paid, reserve, adjustment}) => collected + reserve - paid + adjustment;

function simulationOdds(bank, stake) {
  const win = bankBalance(bank) - (bank.held ?? 0) >= stake ? bank.winRate : 0;
  return {win, push:bank.pushRate, loss:100-win-bank.pushRate};
}

async function bankRequest(path, payload) {
  const headers = {};
  if (payload) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/' + path, {
    method:payload ? 'POST' : 'GET', headers,
    body:payload ? JSON.stringify(payload) : undefined, cache:'no-store'
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The shared bank is unavailable.');
    error.status = response.status;
    error.pending = data.pending;
    throw error;
  }
  return data;
}
