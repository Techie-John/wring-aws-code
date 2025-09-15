import { getInvoices } from '../store'; // Import the new store

const calculateTieredCost = (service, usage) => {
  const PRICING_TIERS = {
    "EC2": [
      { minUsage: 0, maxUsage: 744, pricePerUnit: 0.0464 },
      { minUsage: 745, maxUsage: 8760, pricePerUnit: 0.0418 },
      { minUsage: 8761, maxUsage: Infinity, pricePerUnit: 0.0372 }
    ],
    "S3": [
      { minUsage: 0, maxUsage: 50000, pricePerUnit: 0.023 },
      { minUsage: 50001, maxUsage: 450000, pricePerUnit: 0.022 },
      { minUsage: 450001, maxUsage: Infinity, pricePerUnit: 0.021 }
    ]
  };
  const tiers = PRICING_TIERS[service] || PRICING_TIERS["EC2"];
  let cost = 0;
  let remainingUsage = usage;

  for (const tier of tiers) {
    if (remainingUsage <= 0) break;
    const tierCapacity = tier.maxUsage === Infinity ? remainingUsage : tier.maxUsage - tier.minUsage + 1;
    const tierUsage = Math.min(remainingUsage, tierCapacity);
    cost += tierUsage * tier.pricePerUnit;
    remainingUsage -= tierUsage;
  }
  return cost;
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const invoices = await getInvoices(); // Get from persistent storage
  const totalUsage = {};
  let totalCost = 0;

  invoices.forEach(invoice => {
    invoice.items.forEach(item => {
      totalUsage[item.service] = (totalUsage[item.service] || 0) + item.usage;
      totalCost += item.totalCost;
    });
  });

  let pooledCost = 0;
  Object.entries(totalUsage).forEach(([service, usage]) => {
    pooledCost += calculateTieredCost(service, usage);
  });

  res.json({
    totalCustomers: invoices.length,
    totalUsage,
    totalCost,
    estimatedSavings: Math.max(0, totalCost - pooledCost)
  });
}