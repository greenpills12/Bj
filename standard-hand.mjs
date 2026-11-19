// Wallet Standard plays a single unconditioned hand. Both sides hit below 17.
export function randomBelow(limit) {
  const random = new Uint32Array(1);
  const ceiling = Math.floor(2 ** 32 / limit) * limit;
  do { crypto.getRandomValues(random); } while (random[0] >= ceiling);
  return random[0] % limit;
}

function total(cards) {
  const low = cards.reduce((sum, card) => sum + Math.min(card.rank + 1, 10), 0);
  return low <= 11 && cards.some(card => card.rank === 0) ? low + 10 : low;
}

export function standardHand(pick = randomBelow) {
  const shoe = Array.from({length:312}, (_, index) => index);
  const draw = () => {
    const index = pick(shoe.length);
    const card = shoe[index];
    shoe[index] = shoe.at(-1);
    shoe.pop();
    return {rank:card % 13, suit:Math.floor(card / 13) % 4};
  };
  const player = [draw()], house = [draw()];
  player.push(draw());
  house.push(draw());
  const blackjack = total(player) === 21;
  const dealerBlackjack = total(house) === 21;
  if (!blackjack && !dealerBlackjack) {
    while (total(player) < 17) player.push(draw());
    if (total(player) <= 21) while (total(house) < 17) house.push(draw());
  }
  const points = total(player), dealer = total(house);
  const multiplier = dealerBlackjack ? (blackjack ? 1 : 0)
    : blackjack ? 2.5 : points > 21 ? 0
    : dealer > 21 || points > dealer ? 2 : points === dealer ? 1 : 0;
  return {player, house, multiplier};
}
