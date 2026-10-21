// The Mercenary Guild: ranks from F to S, earned with merit from guild contracts.

export const RANKS = [
  { id: 'F', merit: 0,    color: '#a8b0bc', title: 'Novice' },
  { id: 'E', merit: 60,   color: '#8fd08a', title: 'Hired blade' },
  { id: 'D', merit: 180,  color: '#5ac8e8', title: 'Sellsword' },
  { id: 'C', merit: 450,  color: '#5a8aff', title: 'Veteran' },
  { id: 'B', merit: 1000, color: '#b86bff', title: 'Elite' },
  { id: 'A', merit: 2200, color: '#ffb547', title: 'Ace' },
  { id: 'S', merit: 4800, color: '#ff5a5a', title: 'Legend' },
];
export const MAX_CONTRACTS = 3;
// What a contract of each rank pays, before the planet's richness.
export const CONTRACT_PAY = [90, 160, 280, 480, 800, 1300, 2200];
export const CONTRACT_MERIT = [12, 22, 40, 70, 120, 200, 340];

export const rankOf = (merit = 0) => {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (merit >= RANKS[i].merit) r = i;
  return r;
};
export const rankName = (r) => `${RANKS[r].id}-rank`;
// You can take contracts up to one rank above your own.
export const canTake = (myRank, contractRank) => contractRank <= myRank + 1;
