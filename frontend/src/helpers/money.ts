const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatMoney = (cents: number) => money.format(cents / 100);