'use strict';

const bankBalance = ({collected, paid, reserve, adjustment}) => collected + reserve - paid + adjustment;

function simulationOdds(bank, stake) {
  const win = bankBalance(bank) >= stake ? bank.winRate : 0;
  return {win, push:bank.pushRate, loss:100-win-bank.pushRate};
}

async function bankRequest(path, payload, token) {
  const headers = {};
  if (payload) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch('/api/' + path, {
    method:payload ? 'POST' : 'GET', headers,
    body:payload ? JSON.stringify(payload) : undefined, cache:'no-store'
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The shared bank is unavailable.');
    error.status = response.status;
    throw error;
  }
  return data;
}
