const { DOMMatrix, ImageData, Path2D } = require('canvas');

// These polyfills might not be strictly necessary, but are good practice
// to ensure all expected APIs are available.
global.DOMMatrix = DOMMatrix;
global.ImageData = ImageData;
global.Path2D = Path2D;

const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(fileUpload());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE');
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// SKU-LEVEL PRICING STRUCTURE
// Each SKU has its own volume discount tiers
const SKU_PRICING_TIERS = {
  // EC2 Instance Types
  "EC2-t3.micro-us-east-1": [
    { minUsage: 0, maxUsage: 750, pricePerUnit: 0.0104 }, // Free tier
    { minUsage: 751, maxUsage: 8760, pricePerUnit: 0.0104 },
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.0094 }, // Volume discount
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.0084 }
  ],
  "EC2-t3.small-us-east-1": [
    { minUsage: 0, maxUsage: 8760, pricePerUnit: 0.0208 },
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.0188 },
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.0168 }
  ],
  "EC2-t3.medium-us-east-1": [
    { minUsage: 0, maxUsage: 8760, pricePerUnit: 0.0416 },
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.0376 },
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.0336 }
  ],
  
  // S3 Storage Classes
  "S3-Standard-us-east-1": [
    { minUsage: 0, maxUsage: 50000, pricePerUnit: 0.023 }, // First 50TB
    { minUsage: 50001, maxUsage: 450000, pricePerUnit: 0.022 }, // Next 450TB
    { minUsage: 450001, maxUsage: Infinity, pricePerUnit: 0.021 } // Over 500TB
  ],
  "S3-IA-us-east-1": [
    { minUsage: 0, maxUsage: Infinity, pricePerUnit: 0.0125 }
  ],
  "S3-Glacier-us-east-1": [
    { minUsage: 0, maxUsage: Infinity, pricePerUnit: 0.004 }
  ],
  
  // RDS Instance Types
  "RDS-db.t3.micro-us-east-1": [
    { minUsage: 0, maxUsage: 750, pricePerUnit: 0.0 }, // Free tier
    { minUsage: 751, maxUsage: 8760, pricePerUnit: 0.017 },
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.015 },
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.013 }
  ],
  "RDS-db.t3.small-us-east-1": [
    { minUsage: 0, maxUsage: 8760, pricePerUnit: 0.034 },
    { minUsage: 8761, maxUsage: 87600, pricePerUnit: 0.031 },
    { minUsage: 87601, maxUsage: Infinity, pricePerUnit: 0.028 }
  ],
  
  // Data Transfer
  "DataTransfer-InternetEgress-us-east-1": [
    { minUsage: 0, maxUsage: 1, pricePerUnit: 0.0 }, // First 1GB free
    { minUsage: 2, maxUsage: 10000, pricePerUnit: 0.09 }, // Up to 10TB
    { minUsage: 10001, maxUsage: 50000, pricePerUnit: 0.085 }, // Next 40TB
    { minUsage: 50001, maxUsage: Infinity, pricePerUnit: 0.070 } // Over 50TB
  ],
  
  // CloudFront
  "CloudFront-DataTransfer-us-east-1": [
    { minUsage: 0, maxUsage: 10000, pricePerUnit: 0.085 }, // First 10TB
    { minUsage: 10001, maxUsage: 40000, pricePerUnit: 0.080 }, // Next 40TB
    { minUsage: 40001, maxUsage: 100000, pricePerUnit: 0.060 }, // Next 100TB
    { minUsage: 100001, maxUsage: Infinity, pricePerUnit: 0.040 } // Over 150TB
  ],
  
  // SES
  "SES-EmailSending-us-east-1": [
    { minUsage: 0, maxUsage: 62000, pricePerUnit: 0.0 }, // First 62k emails free
    { minUsage: 62001, maxUsage: Infinity, pricePerUnit: 0.0001 }
  ],
  
  // SNS
  "SNS-Requests-us-east-1": [
    { minUsage: 0, maxUsage: 1000000, pricePerUnit: 0.0000005 }, // First 1M requests free
    { minUsage: 1000001, maxUsage: Infinity, pricePerUnit: 0.0000005 }
  ]
};

let invoices = [];

// Calculate tiered cost for a specific SKU and usage
const calculateSKUTieredCost = (skuId, totalUsage) => {
  const tiers = SKU_PRICING_TIERS[skuId];
  if (!tiers) {
    console.warn(`No pricing tiers found for SKU: ${skuId}`);
    return totalUsage * 0.01; // Fallback pricing
  }

  let cost = 0;
  let remainingUsage = totalUsage;

  for (const tier of tiers) {
    if (remainingUsage <= 0) break;
    
    const tierCapacity = tier.maxUsage === Infinity 
      ? remainingUsage 
      : Math.min(tier.maxUsage - tier.minUsage + 1, remainingUsage);
    
    const usageInThisTier = Math.min(remainingUsage, tierCapacity);
    cost += usageInThisTier * tier.pricePerUnit;
    remainingUsage -= usageInThisTier;
    
    if (tier.maxUsage === Infinity) break;
  }

  return cost;
};

// Calculate what a customer would pay for their SKUs in the pool
const calculateCustomerSKUPooledCost = (customerSKUs, poolTotals) => {
  let customerPooledCost = 0;

  customerSKUs.forEach(sku => {
    const totalPoolUsage = poolTotals[sku.skuId] || 0;
    if (totalPoolUsage === 0) return;

    // Calculate total cost for this SKU at pool volume
    const totalSKUCost = calculateSKUTieredCost(sku.skuId, totalPoolUsage);
    
    // Customer pays their proportional share
    const customerShare = sku.usage / totalPoolUsage;
    customerPooledCost += totalSKUCost * customerShare;
  });

  return customerPooledCost;
};

// Enhanced Gemini parsing to extract SKU-level data
const parseAWSInvoiceWithGemini = async (pdfText) => {
  const prompt = `
You are an AWS billing expert. Parse this AWS invoice and break down services into specific SKUs (Stock Keeping Units).

INVOICE TEXT:
${pdfText}

Return ONLY valid JSON in this exact format:
{
  "skus": [
    {
      "skuId": "SERVICE-TYPE-REGION",
      "service": "EC2|S3|RDS|CloudFront|DataTransfer|SES|SNS",
      "cost": <number>,
      "estimatedUsage": <number>,
      "unit": "hours|GB|requests|emails",
      "region": "us-east-1"
    }
  ],
  "totalCost": <number>
}

SKU BREAKDOWN RULES:
1. For "Amazon Elastic Compute Cloud" costs, estimate instance types:
   - Small costs (<$10): "EC2-t3.micro-us-east-1"
   - Medium costs ($10-50): "EC2-t3.small-us-east-1" 
   - Large costs (>$50): "EC2-t3.medium-us-east-1"

2. For "Amazon Simple Storage Service" costs:
   - Standard storage: "S3-Standard-us-east-1"
   - For costs <$1: assume standard storage

3. For "Amazon RDS Service" costs:
   - Small costs (<$30): "RDS-db.t3.micro-us-east-1"
   - Larger costs: "RDS-db.t3.small-us-east-1"

4. For "AWS Data Transfer": "DataTransfer-InternetEgress-us-east-1"
5. For "Amazon CloudFront": "CloudFront-DataTransfer-us-east-1"
6. For "Amazon Simple Email Service": "SES-EmailSending-us-east-1"
7. For "Amazon Simple Notification Service": "SNS-Requests-us-east-1"

USAGE ESTIMATION:
- EC2: cost ÷ $0.0104 (hours for t3.micro)
- S3: cost ÷ $0.023 × 1000 (GB storage)
- RDS: cost ÷ $0.017 (hours for db.t3.micro)
- DataTransfer: cost ÷ $0.09 × 1000 (GB transfer)
- CloudFront: cost ÷ $0.085 × 1000 (GB transfer)
- SES: cost ÷ $0.0001 (emails sent)
- SNS: cost ÷ $0.0000005 (requests)

Extract actual costs from invoice, ignore $0.00 charges, assume us-east-1 region if not specified.
  `;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini SKU parsing response:', text);
    
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const parsedData = JSON.parse(jsonText);
    
    if (!parsedData.skus || !Array.isArray(parsedData.skus)) {
      throw new Error('Invalid SKU response structure from Gemini');
    }
    
    // Convert to expected format with SKU-level items
    const skuItems = parsedData.skus.map((sku, index) => ({
      id: `sku-${Date.now()}-${index}`,
      skuId: sku.skuId,
      service: sku.service,
      usage: Math.round(sku.estimatedUsage || 0),
      totalCost: parseFloat(sku.cost || 0),
      region: sku.region || 'us-east-1',
      unit: sku.unit || 'units'
    })).filter(item => item.totalCost > 0);

    return {
      skus: skuItems,
      totalCost: parsedData.totalCost || skuItems.reduce((sum, item) => sum + item.totalCost, 0)
    };

  } catch (error) {
    console.error('Gemini SKU parsing error:', error);
    return fallbackSKUParsing(pdfText);
  }
};

// Fallback SKU parsing if Gemini fails
const fallbackSKUParsing = (text) => {
  const skuItems = [];
  
  // Pattern matching with SKU estimation
  const servicePatterns = [
    { 
      pattern: /Amazon Simple Storage Service.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: (cost) => cost < 1 ? "S3-Standard-us-east-1" : "S3-Standard-us-east-1",
      service: 'S3', 
      unit: 'GB',
      getUsage: (cost) => Math.round(cost / 0.023 * 1000)
    },
    { 
      pattern: /AWS Data Transfer.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: () => "DataTransfer-InternetEgress-us-east-1",
      service: 'DataTransfer', 
      unit: 'GB',
      getUsage: (cost) => Math.round(cost / 0.09 * 1000)
    },
    { 
      pattern: /Amazon RDS Service.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: (cost) => cost < 30 ? "RDS-db.t3.micro-us-east-1" : "RDS-db.t3.small-us-east-1",
      service: 'RDS', 
      unit: 'hours',
      getUsage: (cost) => Math.round(cost / 0.017)
    },
    { 
      pattern: /Amazon CloudFront.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: () => "CloudFront-DataTransfer-us-east-1",
      service: 'CloudFront', 
      unit: 'GB',
      getUsage: (cost) => Math.round(cost / 0.085 * 1000)
    },
    { 
      pattern: /Amazon Simple Email Service.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: () => "SES-EmailSending-us-east-1",
      service: 'SES', 
      unit: 'emails',
      getUsage: (cost) => Math.round(cost / 0.0001)
    },
    { 
      pattern: /Amazon Elastic Compute Cloud.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: (cost) => {
        if (cost < 10) return "EC2-t3.micro-us-east-1";
        if (cost < 50) return "EC2-t3.small-us-east-1";
        return "EC2-t3.medium-us-east-1";
      },
      service: 'EC2', 
      unit: 'hours',
      getUsage: (cost) => Math.round(cost / 0.0104)
    },
    { 
      pattern: /Amazon Simple Notification Service.*?\$([0-9,]+\.?[0-9]*)/gi, 
      getSKU: () => "SNS-Requests-us-east-1",
      service: 'SNS', 
      unit: 'requests',
      getUsage: (cost) => Math.round(cost / 0.0000005)
    }
  ];

  servicePatterns.forEach(({ pattern, getSKU, service, unit, getUsage }) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const cost = parseFloat(match[1].replace(/[,$]/g, ''));
      if (cost > 0) {
        const skuId = getSKU(cost);
        const usage = getUsage(cost);
        
        skuItems.push({
          id: `sku-${Date.now()}-${skuItems.length}`,
          skuId: skuId,
          service: service,
          usage: usage,
          totalCost: cost,
          region: 'us-east-1',
          unit: unit
        });
      }
    }
  });

  const totalCost = skuItems.reduce((sum, item) => sum + item.totalCost, 0);
  return { skus: skuItems, totalCost };
};

// Enhanced PDF parsing with SKU extraction
const parseAWSInvoicePDF = async (pdfBuffer) => {
  try {
    const document = await pdfjsLib.getDocument({ data: pdfBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    console.log('Extracted PDF text for SKU parsing:', fullText.substring(0, 500));
    return await parseAWSInvoiceWithGemini(fullText);
    
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF: ' + error.message);
  }
};

// API endpoint for uploading invoices with SKU processing
app.post('/api/invoices/upload', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({ error: 'No files were uploaded.' });
  }

  const { customerName } = req.body;
  if (!customerName || !customerName.trim()) {
    return res.status(400).json({ error: 'Customer name is required.' });
  }

  const pdfFile = req.files.invoice;
  
  if (!pdfFile.mimetype || !pdfFile.mimetype.includes('pdf')) {
    return res.status(400).json({ error: 'Only PDF files are supported.' });
  }

  try {
    console.log(`Processing PDF for SKU extraction: ${customerName}`);
    
    const parseResult = await parseAWSInvoicePDF(Uint8Array.from(pdfFile.data));
    
    const invoice = {
      id: `invoice-${Date.now()}`,
      customerName: customerName.trim(),
      skus: parseResult.skus, // Now storing SKU-level data
      items: parseResult.skus, // Keep items for backward compatibility
      totalCost: parseResult.totalCost,
      uploadDate: new Date(),
      originalFileName: pdfFile.name
    };

    invoices.push(invoice);
    
    console.log(`Successfully parsed invoice with SKU breakdown for ${customerName}:`);
    console.log(`- ${invoice.skus.length} SKUs found`);
    console.log(`- Total cost: $${invoice.totalCost.toFixed(2)}`);
    console.log('- SKUs:', invoice.skus.map(s => s.skuId).join(', '));
    
    res.status(201).json({ 
      message: 'Invoice uploaded and parsed with SKU breakdown successfully.',
      invoice: {
        id: invoice.id,
        customerName: invoice.customerName,
        itemCount: invoice.skus.length,
        totalCost: invoice.totalCost
      }
    });

  } catch (error) {
    console.error('PDF processing error:', error);
    res.status(500).json({ 
      error: 'Failed to parse PDF invoice: ' + error.message
    });
  }
});

// SKU-LEVEL Pool statistics endpoint
app.get('/api/pool/stats', (req, res) => {
  const poolSKUTotals = {};
  let totalStandaloneCost = 0;

  // Calculate pool usage totals by SKU
  invoices.forEach(invoice => {
    invoice.skus.forEach(sku => {
      poolSKUTotals[sku.skuId] = (poolSKUTotals[sku.skuId] || 0) + sku.usage;
      totalStandaloneCost += sku.totalCost;
    });
  });

  // Calculate pooled costs using SKU-level volume tiers
  let totalPooledCost = 0;
  Object.entries(poolSKUTotals).forEach(([skuId, usage]) => {
    totalPooledCost += calculateSKUTieredCost(skuId, usage);
  });

  const estimatedSavings = Math.max(0, totalStandaloneCost - totalPooledCost);

  const stats = {
    totalCustomers: invoices.length,
    totalUsage: poolSKUTotals, // Now shows SKU-level totals
    totalCost: totalStandaloneCost,
    pooledCost: totalPooledCost,
    estimatedSavings: estimatedSavings,
    savingsPercentage: totalStandaloneCost > 0 ? (estimatedSavings / totalStandaloneCost * 100) : 0
  };

  console.log('SKU-level pool stats:', {
    customers: stats.totalCustomers,
    standaloneCost: stats.totalCost,
    pooledCost: stats.pooledCost,
    savings: stats.estimatedSavings,
    savingsRate: `${stats.savingsPercentage.toFixed(1)}%`,
    skuCount: Object.keys(poolSKUTotals).length
  });

  res.json(stats);
});

// Get all invoices
app.get('/api/invoices', (req, res) => {
  res.json(invoices);
});

// Remove invoice from pool
app.delete('/api/invoices/:id', (req, res) => {
  const { id } = req.params;
  const initialLength = invoices.length;
  invoices = invoices.filter(inv => inv.id !== id);
  if (invoices.length < initialLength) {
    res.status(200).json({ message: 'Invoice removed successfully.' });
  } else {
    res.status(404).json({ error: 'Invoice not found.' });
  }
});

// SKU-LEVEL individual customer savings calculation
app.get('/api/invoices/savings/:id', (req, res) => {
  const { id } = req.params;
  const invoice = invoices.find(inv => inv.id === id);

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found.' });
  }

  // Calculate standalone cost (what customer pays alone)
  const standalone = invoice.totalCost;
  
  // Calculate pool usage totals by SKU
  const poolSKUTotals = {};
  invoices.forEach(inv => {
    inv.skus.forEach(sku => {
      poolSKUTotals[sku.skuId] = (poolSKUTotals[sku.skuId] || 0) + sku.usage;
    });
  });

  // Calculate what this customer would pay in the pool at SKU level
  const customerPooledCost = calculateCustomerSKUPooledCost(invoice.skus, poolSKUTotals);
  
  const savings = Math.max(0, standalone - customerPooledCost);
  const percentage = standalone > 0 ? (savings / standalone) * 100 : 0;

  const result = {
    standalone,
    pooled: customerPooledCost,
    savings,
    percentage: Math.max(0, percentage)
  };

  console.log(`SKU-level savings calculation for ${invoice.customerName}:`, result);
  console.log(`- SKUs processed: ${invoice.skus.map(s => s.skuId).join(', ')}`);

  res.json(result);
});

// Debug endpoint showing SKU breakdown
app.get('/api/debug/skus', (req, res) => {
  const debugInfo = {
    totalSKUs: 0,
    skuBreakdown: {},
    customers: invoices.map(invoice => ({
      id: invoice.id,
      customerName: invoice.customerName,
      fileName: invoice.originalFileName,
      skuCount: invoice.skus.length,
      totalCost: invoice.totalCost,
      skus: invoice.skus.map(sku => ({
        skuId: sku.skuId,
        service: sku.service,
        usage: sku.usage,
        cost: sku.totalCost,
        unit: sku.unit,
        region: sku.region
      }))
    }))
  };
  
  // Calculate SKU totals across all customers
  invoices.forEach(invoice => {
    invoice.skus.forEach(sku => {
      if (!debugInfo.skuBreakdown[sku.skuId]) {
        debugInfo.skuBreakdown[sku.skuId] = {
          totalUsage: 0,
          totalCost: 0,
          customers: 0
        };
      }
      debugInfo.skuBreakdown[sku.skuId].totalUsage += sku.usage;
      debugInfo.skuBreakdown[sku.skuId].totalCost += sku.totalCost;
      debugInfo.skuBreakdown[sku.skuId].customers += 1;
    });
  });
  
  debugInfo.totalSKUs = Object.keys(debugInfo.skuBreakdown).length;
  
  res.json(debugInfo);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    invoicesCount: invoices.length,
    skuPoolingEnabled: true,
    availableSKUs: Object.keys(SKU_PRICING_TIERS).length
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Gemini AI configured:', !!process.env.GEMINI_API_KEY);
  console.log('SKU-level pooling enabled with', Object.keys(SKU_PRICING_TIERS).length, 'SKUs');
  console.log('Ready to process AWS invoice PDFs with SKU-level cost pooling...');
});