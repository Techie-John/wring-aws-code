const { DOMMatrix, ImageData, Path2D } = require('canvas');
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

// These polyfills might not be strictly necessary, but are good practice
// to ensure all expected APIs are available.
global.DOMMatrix = DOMMatrix;
global.ImageData = ImageData;
global.Path2D = Path2D;

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// --- Helper Functions and Data (These can stay) ---

// In-memory data store for invoices.
// In a real-world app, you would use a database like Firestore.
let invoices = [];

// AWS pricing tiers (simplified for this example)
// Note: This data is static. A production app would fetch this from a live API.
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
  ],
  "DynamoDB": [
    { minUsage: 0, maxUsage: 25000000000, pricePerUnit: 0.00000025 }
  ]
};

// --- Cost Calculation Logic (Same as before) ---
/**
 * Calculates the total cost for a given service based on tiered pricing.
 * @param {string} service The service name (e.g., "EC2", "S3").
 * @param {number} usage The total usage amount.
 * @returns {number} The calculated cost.
 */
function calculateTieredCost(service, usage) {
  const tiers = PRICING_TIERS[service];
  if (!tiers) {
    return 0;
  }
  let remainingUsage = usage;
  let totalCost = 0;
  for (const tier of tiers) {
    if (remainingUsage > 0) {
      const tierUsage = Math.min(remainingUsage, tier.maxUsage - tier.minUsage + (tier.maxUsage === Infinity ? Infinity : 1));
      totalCost += tierUsage * tier.pricePerUnit;
      remainingUsage -= tierUsage;
    } else {
      break;
    }
  }
  return totalCost;
}

// Function to parse the PDF and extract data
async function parsePdfInvoice(buffer, originalFileName) {
  const data = new Uint8Array(buffer);
  const pdfDocument = await pdfjsLib.getDocument({ data }).promise;
  const numPages = pdfDocument.numPages;
  let fullText = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map(item => item.str).join(' ');
  }
  
  // This is a simplified extraction. In a real app, you'd use more robust regex.
  const serviceRegex = /(EC2|S3|DynamoDB)/g;
  const items = [];
  let match;
  while ((match = serviceRegex.exec(fullText)) !== null) {
    const service = match[1];
    const textAround = fullText.substring(match.index, Math.min(match.index + 200, fullText.length));
    const usageMatch = textAround.match(/(\d+\.?\d*)\s*(GB-Mo|GB|Hrs)/i);
    if (usageMatch) {
      const usage = parseFloat(usageMatch[1]);
      const totalCostMatch = textAround.match(/\$(\d+\.?\d*)/);
      const totalCost = totalCostMatch ? parseFloat(totalCostMatch[1]) : 0;
      items.push({ service, usage, totalCost });
    }
  }

  const customerNameMatch = fullText.match(/Customer Name:\s*(.*)/i);
  const customerName = customerNameMatch ? customerNameMatch[1].trim() : 'Unknown Customer';
  const totalCostMatch = fullText.match(/Total Cost:\s*\$(\d+\.?\d*)/i);
  const totalCost = totalCostMatch ? parseFloat(totalCostMatch[1]) : items.reduce((acc, curr) => acc + curr.totalCost, 0);

  return {
    id: Date.now().toString(),
    customerName,
    originalFileName,
    items,
    totalCost,
  };
}

// --- API Endpoints (Refactored to be Vercel-compatible) ---

app.get('/api/invoices', (req, res) => {
  res.json(invoices);
});

app.get('/api/pool/stats', (req, res) => {
  const totalInvoices = invoices.length;
  const totalServices = invoices.reduce((acc, inv) => acc + inv.items.length, 0);
  const totalUsage = invoices.reduce((acc, inv) => acc + inv.items.reduce((sum, item) => sum + item.usage, 0), 0);
  res.json({ totalInvoices, totalServices, totalUsage });
});

app.post('/api/invoices/upload', async (req, res) => {
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    const file = req.files.invoiceFile;
    const invoiceData = await parsePdfInvoice(file.data, file.name);
    invoices.push(invoiceData);
    res.json({ message: 'Invoice uploaded and processed successfully.', invoice: invoiceData });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'Failed to process invoice.' });
  }
});

app.delete('/api/invoices/:id', (req, res) => {
  const { id } = req.params;
  const initialLength = invoices.length;
  invoices = invoices.filter(inv => inv.id !== id);
  if (invoices.length < initialLength) {
    res.status(200).json({ message: 'Invoice deleted successfully.' });
  } else {
    res.status(404).json({ error: 'Invoice not found.' });
  }
});

app.get('/api/calculate-savings/:invoiceId', (req, res) => {
  const { invoiceId } = req.params;
  const invoice = invoices.find(inv => inv.id === invoiceId);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  const standalone = invoice.totalCost;

  const tempUsage = {};
  invoices.forEach(inv => {
    inv.items.forEach(item => {
      tempUsage[item.service] = (tempUsage[item.service] || 0) + item.usage;
    });
  });

  let customerPooledCost = 0;
  invoice.items.forEach(item => {
    const totalServiceUsage = tempUsage[item.service];
    if (totalServiceUsage > 0) {
      const customerRatio = item.usage / totalServiceUsage;
      const totalServiceCost = calculateTieredCost(item.service, totalServiceUsage);
      customerPooledCost += totalServiceCost * customerRatio;
    }
  });

  const savings = Math.max(0, standalone - customerPooledCost);
  const percentage = standalone > 0 ? (savings / standalone) * 100 : 0;

  res.json({
    standalone,
    pooled: customerPooledCost,
    savings,
    percentage: Math.max(0, percentage)
  });
});

// Debug endpoint to help with PDF parsing
app.get('/api/debug/invoices', (req, res) => {
  const debugInfo = invoices.map(invoice => ({
    id: invoice.id,
    customerName: invoice.customerName,
    fileName: invoice.originalFileName,
    itemCount: invoice.items.length,
    totalCost: invoice.totalCost,
    services: invoice.items.map(item => ({
      service: item.service,
      usage: item.usage,
      cost: item.totalCost,
      unit: item.usageUnit,
    })),
  }));
  res.json(debugInfo);
});


// For Vercel, we export the Express app as a serverless function.
// The `app.listen()` call is removed.
module.exports = app;
