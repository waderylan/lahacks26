const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number) => usd.format(cents / 100);
export const pct = (p: number) => `${Math.round(p * 100)}%`;
