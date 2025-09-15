import React, { useState, useContext, createContext, useCallback, useEffect } from 'react';
import { Upload, FileText, DollarSign, Users, TrendingDown, Download, X, Plus, Trash2, AlertCircle, CheckCircle, Info } from 'lucide-react';

// Context
const PoolContext = createContext(null);

// Pool Provider
const PoolProvider = ({ children }) => {
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const invoicesRes = await fetch('http://localhost:5000/api/invoices');
      const invoicesData = await invoicesRes.json();
      setInvoices(invoicesData);

      const statsRes = await fetch('http://localhost:5000/api/pool/stats');
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addInvoice = useCallback(async (formData) => {
    const response = await fetch('http://localhost:5000/api/invoices/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to upload invoice');
    }

    const result = await response.json();
    fetchData(); // Re-fetch data to get the updated pool stats
    return result;
  }, [fetchData]);

  const removeInvoice = useCallback(async (id) => {
    try {
      await fetch(`http://localhost:5000/api/invoices/${id}`, {
        method: 'DELETE'
      });
      fetchData(); // Re-fetch data to get the updated pool stats
    } catch (error) {
      console.error('Failed to remove invoice:', error);
    }
  }, [fetchData]);

  return (
    <PoolContext.Provider value={{ invoices, addInvoice, removeInvoice, stats, loading }}>
      {children}
    </PoolContext.Provider>
  );
};

// Enhanced Invoice Uploader with better validation
const InvoiceUploader = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [message, setMessage] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const pool = useContext(PoolContext);

  const validateFile = (file) => {
    if (!file.type.includes('pdf')) {
      throw new Error('Only PDF files are accepted. Please upload an AWS invoice PDF.');
    }
    
    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      throw new Error('File size too large. Please upload a PDF smaller than 10MB.');
    }

    if (file.size < 1024) { // Very small file
      throw new Error('File seems too small to be a valid invoice. Please check your file.');
    }
  };

  const processFiles = async (files) => {
    if (!customerName.trim()) {
      setMessage({ type: 'error', text: 'Please enter a customer name before uploading.' });
      return;
    }
    
    if (!files || !files[0]) {
      return;
    }

    setIsUploading(true);
    setMessage(null);
    setUploadProgress(0);
    
    try {
      const file = files[0];
      validateFile(file);
      
      setUploadProgress(25);
      setMessage({ type: 'info', text: 'Validating PDF file...' });
      
      const formData = new FormData();
      formData.append('invoice', file);
      formData.append('customerName', customerName.trim());

      setUploadProgress(50);
      setMessage({ type: 'info', text: 'Parsing AWS invoice data...' });

      const result = await pool.addInvoice(formData);
      
      setUploadProgress(100);
      setCustomerName('');
      setMessage({ 
        type: 'success', 
        text: `✅ Invoice for "${customerName.trim()}" uploaded successfully! Found ${result.invoice?.itemCount || 0} services totaling $${result.invoice?.totalCost?.toFixed(2) || '0.00'}.` 
      });
      
      // Clear success message after 5 seconds
      setTimeout(() => {
        setMessage(null);
      }, 5000);
      
    } catch (error) {
      console.error('Upload error:', error);
      setMessage({ type: 'error', text: `❌ ${error.message}` });
      setUploadProgress(0);
    }
    setIsUploading(false);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    processFiles(e.dataTransfer.files);
  };
  
  const handleFileChange = (e) => {
    processFiles(e.target.files);
    e.target.value = null;
  };

  const clearMessage = () => {
    setMessage(null);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-semibold mb-4 flex items-center">
        <Upload className="mr-2" />
        Upload AWS Invoice PDF
      </h2>
      
      <div className="mb-4">
        <label htmlFor="customer-name" className="block text-sm font-medium mb-2">
          Customer Name *
        </label>
        <input
          id="customer-name"
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Enter customer name (e.g., 'Acme Corporation')"
          disabled={isUploading}
        />
      </div>
      
      {message && (
        <div className={`p-4 mb-4 rounded-lg flex items-start justify-between ${
          message.type === 'error' ? 'bg-red-50 border border-red-200' : 
          message.type === 'success' ? 'bg-green-50 border border-green-200' :
          'bg-blue-50 border border-blue-200'
        }`}>
          <div className="flex items-start">
            {message.type === 'error' && <AlertCircle className="text-red-500 mr-2 mt-0.5 flex-shrink-0" size={16} />}
            {message.type === 'success' && <CheckCircle className="text-green-500 mr-2 mt-0.5 flex-shrink-0" size={16} />}
            {message.type === 'info' && <Info className="text-blue-500 mr-2 mt-0.5 flex-shrink-0" size={16} />}
            <span className={`text-sm ${
              message.type === 'error' ? 'text-red-700' : 
              message.type === 'success' ? 'text-green-700' :
              'text-blue-700'
            }`}>
              {message.text}
            </span>
          </div>
          <button onClick={clearMessage} className="ml-2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        </div>
      )}

      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
        } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        {isUploading ? (
          <div className="space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-600">Processing PDF... This may take a moment.</p>
          </div>
        ) : (
          <>
            <FileText className="mx-auto mb-4 text-gray-400" size={48} />
            <h3 className="text-lg font-medium mb-2">Drop your AWS invoice PDF here</h3>
            <p className="text-gray-600 mb-4">Or click to browse and select a file</p>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="bg-blue-500 text-white px-6 py-3 rounded-lg cursor-pointer hover:bg-blue-600 inline-flex items-center transition-colors"
            >
              <Upload className="mr-2" size={16} />
              Browse PDF Files
            </label>
            <div className="mt-4 p-3 bg-gray-50 rounded text-sm text-gray-600">
              <p className="font-medium mb-1">📋 Supported formats:</p>
              <ul className="text-xs space-y-1">
                <li>• Standard AWS billing invoices (PDF format)</li>
                <li>• AWS Cost and Usage Reports</li>
                <li>• Monthly AWS statements</li>
              </ul>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <p>💡 <strong>Tips for best results:</strong></p>
        <ul className="ml-4 mt-1 space-y-1">
          <li>• Use official AWS PDF invoices (not screenshots or scans)</li>
          <li>• Ensure the PDF contains text data (not just images)</li>
          <li>• File size should be under 10MB</li>
        </ul>
      </div>
    </div>
  );
};

// Enhanced Pool Dashboard with better metrics
const PoolDashboard = () => {
  const pool = useContext(PoolContext);
  if (!pool || pool.loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-lg p-6 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-20"></div>
                <div className="h-8 bg-gray-200 rounded w-16"></div>
              </div>
              <div className="h-6 w-6 bg-gray-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const stats = pool.stats;

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
  };

  const savingsRate = stats.totalCost > 0 ? (stats.estimatedSavings / stats.totalCost) * 100 : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Pool Members</p>
            <p className="text-3xl font-bold text-gray-800">{stats.totalCustomers || 0}</p>
            <p className="text-xs text-gray-500 mt-1">Active customers</p>
          </div>
          <Users className="text-blue-500" size={32} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-indigo-500">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Combined Spend</p>
            <p className="text-3xl font-bold text-gray-800">{formatCurrency(stats.totalCost)}</p>
            <p className="text-xs text-gray-500 mt-1">Monthly total</p>
          </div>
          <DollarSign className="text-indigo-500" size={32} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-green-500">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Potential Savings</p>
            <p className="text-3xl font-bold text-green-600">{formatCurrency(stats.estimatedSavings)}</p>
            <p className="text-xs text-gray-500 mt-1">Per month</p>
          </div>
          <TrendingDown className="text-green-500" size={32} />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-emerald-500">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 font-medium">Savings Rate</p>
            <p className="text-3xl font-bold text-emerald-600">
              {savingsRate.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Average discount</p>
          </div>
          <TrendingDown className="text-emerald-500" size={32} />
        </div>
      </div>
    </div>
  );
};

// Enhanced Invoice List with better service breakdown
const InvoiceList = () => {
  const pool = useContext(PoolContext);
  if (!pool || pool.loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Pool Members</h3>
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="border rounded-lg p-4 animate-pulse">
              <div className="space-y-2">
                <div className="h-5 bg-gray-200 rounded w-48"></div>
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="grid grid-cols-4 gap-4 mt-4">
                  {[...Array(4)].map((_, j) => (
                    <div key={j} className="space-y-1">
                      <div className="h-3 bg-gray-200 rounded w-16"></div>
                      <div className="h-4 bg-gray-200 rounded w-20"></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (pool.invoices.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Users className="mr-2" />
          Pool Members
        </h3>
        <div className="text-center py-12">
          <FileText className="mx-auto text-gray-300 mb-4" size={64} />
          <p className="text-gray-500 text-lg mb-2">No invoices uploaded yet</p>
          <p className="text-gray-400 text-sm">Upload your first AWS invoice to start building the pool</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center justify-between">
        <span className="flex items-center">
          <Users className="mr-2" />
          Pool Members ({pool.invoices.length})
        </span>
        <span className="text-sm font-normal text-gray-500">
          Total: {pool.stats.totalCost ? `${pool.stats.totalCost.toLocaleString()}` : '$0'}
        </span>
      </h3>
      <div className="space-y-4">
        {pool.invoices.map((invoice) => (
          <InvoiceCard key={invoice.id} invoice={invoice} />
        ))}
      </div>
    </div>
  );
};

// Enhanced Invoice Card with better service visualization
const InvoiceCard = ({ invoice }) => {
  const pool = useContext(PoolContext);
  const [savings, setSavings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const fetchSavings = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/invoices/savings/${invoice.id}`);
        const data = await response.json();
        setSavings(data);
      } catch (error) {
        console.error(`Failed to fetch savings for invoice ${invoice.id}:`, error);
        setSavings({ standalone: invoice.totalCost, pooled: invoice.totalCost, savings: 0, percentage: 0 });
      }
      setLoading(false);
    };
    fetchSavings();
  }, [invoice.id, invoice.totalCost]);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount || 0);
  };

  const getServiceColor = (service) => {
    const colors = {
      'EC2': 'bg-orange-100 text-orange-800',
      'S3': 'bg-green-100 text-green-800',
      'RDS': 'bg-blue-100 text-blue-800',
      'CloudFront': 'bg-purple-100 text-purple-800',
      'DataTransfer': 'bg-yellow-100 text-yellow-800',
      'Lambda': 'bg-pink-100 text-pink-800'
    };
    return colors[service] || 'bg-gray-100 text-gray-800';
  };

  const serviceCount = invoice.items ? invoice.items.length : 0;
  const uploadDate = new Date(invoice.uploadDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  return (
    <div className="border rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-lg text-gray-800">{invoice.customerName}</h4>
            <button
              onClick={() => pool.removeInvoice(invoice.id)}
              className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded transition-colors"
              title="Remove from pool"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="flex items-center text-sm text-gray-600 mt-1 space-x-4">
            <span>{serviceCount} services</span>
            <span>•</span>
            <span>Uploaded {uploadDate}</span>
            {invoice.originalFileName && (
              <>
                <span>•</span>
                <span className="truncate max-w-32" title={invoice.originalFileName}>
                  {invoice.originalFileName}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-sm text-gray-500">Calculating savings...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-gray-600 font-medium">Standalone Cost</p>
              <p className="font-bold text-lg">{formatCurrency(savings.standalone)}</p>
            </div>
            <div className="bg-blue-50 p-3 rounded">
              <p className="text-gray-600 font-medium">Pooled Cost</p>
              <p className="font-bold text-lg text-blue-600">{formatCurrency(savings.pooled)}</p>
            </div>
            <div className="bg-green-50 p-3 rounded">
              <p className="text-gray-600 font-medium">Monthly Savings</p>
              <p className="font-bold text-lg text-green-600">{formatCurrency(savings.savings)}</p>
            </div>
            <div className="bg-green-100 p-3 rounded">
              <p className="text-gray-600 font-medium">Savings Rate</p>
              <p className="font-bold text-lg text-green-700">{savings.percentage.toFixed(1)}%</p>
            </div>
          </div>

          {/* Service tags */}
          <div className="mb-3">
            <div className="flex flex-wrap gap-1">
              {invoice.items && invoice.items.slice(0, expanded ? invoice.items.length : 5).map((item, index) => (
                <span
                  key={index}
                  className={`px-2 py-1 rounded-full text-xs font-medium ${getServiceColor(item.service)}`}
                  title={`${item.service}: ${formatCurrency(item.totalCost)}`}
                >
                  {item.service}
                </span>
              ))}
              {invoice.items && invoice.items.length > 5 && !expanded && (
                <button
                  onClick={() => setExpanded(true)}
                  className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  +{invoice.items.length - 5} more
                </button>
              )}
            </div>
          </div>

          {/* Expandable service breakdown */}
          <details className="mt-3" open={expanded}>
            <summary 
              className="cursor-pointer text-blue-500 hover:underline text-sm font-medium"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Hide' : 'View'} Service Breakdown
            </summary>
            {expanded && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2 font-medium">Service</th>
                      <th className="text-left p-2 font-medium">Region</th>
                      <th className="text-right p-2 font-medium">Usage</th>
                      <th className="text-right p-2 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items && invoice.items.map((item, index) => (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs ${getServiceColor(item.service)}`}>
                            {item.service}
                          </span>
                        </td>
                        <td className="p-2 text-gray-600">{item.region || 'N/A'}</td>
                        <td className="p-2 text-right">
                          {item.usage ? `${item.usage.toLocaleString()} ${item.unit || 'units'}` : 'N/A'}
                        </td>
                        <td className="p-2 text-right font-medium">{formatCurrency(item.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-medium">
                    <tr>
                      <td className="p-2" colSpan="3">Total</td>
                      <td className="p-2 text-right">{formatCurrency(invoice.totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </details>
        </>
      )}
    </div>
  );
};

// Enhanced PDF Exporter
const PDFExporter = () => {
  const pool = useContext(PoolContext);
  const [generating, setGenerating] = useState(false);
  
  if (!pool || pool.loading) return null;
  const stats = pool.stats;

  const generatePDF = async () => {
    setGenerating(true);
    
    try {
      // Import jsPDF dynamically
      const { jsPDF } = await import('jspdf');
      
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      const margin = 20;
      
      // Header
      doc.setFontSize(24);
      doc.setTextColor(33, 37, 41);
      doc.text('AWS Cost Pooling Analysis', margin, 30);
      
      doc.setFontSize(12);
      doc.setTextColor(108, 117, 125);
      doc.text(`Generated on: ${new Date().toLocaleDateString('en-US', { 
        year: 'numeric', month: 'long', day: 'numeric' 
      })}`, margin, 45);
      
      // Executive Summary Box
      doc.setFillColor(240, 248, 255);
      doc.rect(margin, 55, pageWidth - 2 * margin, 40, 'F');
      doc.setFontSize(16);
      doc.setTextColor(33, 37, 41);
      doc.text('Executive Summary', margin + 5, 70);
      
      doc.setFontSize(11);
      doc.setTextColor(73, 80, 87);
      const savingsRate = stats.totalCost > 0 ? ((stats.estimatedSavings || 0) / stats.totalCost * 100) : 0;
      doc.text(`Pool of ${stats.totalCustomers || 0} customers can save ${savingsRate.toFixed(1)}% monthly`, margin + 5, 80);
      doc.text(`Combined spend: ${(stats.totalCost || 0).toLocaleString()}`, margin + 5, 88);
      doc.text(`Potential savings: ${(stats.estimatedSavings || 0).toLocaleString()} per month`, margin + 5, 96);
      
      // Pool Statistics
      let yPos = 115;
      doc.setFontSize(16);
      doc.setTextColor(33, 37, 41);
      doc.text('Pool Statistics', margin, yPos);
      
      yPos += 15;
      doc.setFontSize(11);
      doc.setTextColor(73, 80, 87);
      const metrics = [
        [`Total Pool Members:`, `${stats.totalCustomers || 0}`],
        [`Combined Monthly Spend:`, `${(stats.totalCost || 0).toLocaleString()}`],
        [`Estimated Monthly Savings:`, `${(stats.estimatedSavings || 0).toLocaleString()}`],
        [`Average Savings Rate:`, `${savingsRate.toFixed(1)}%`],
        [`Annual Potential Savings:`, `${((stats.estimatedSavings || 0) * 12).toLocaleString()}`]
      ];
      
      metrics.forEach(([label, value]) => {
        doc.text(label, margin, yPos);
        doc.text(value, margin + 80, yPos);
        yPos += 8;
      });
      
      // Member Breakdown
      yPos += 10;
      doc.setFontSize(16);
      doc.setTextColor(33, 37, 41);
      doc.text('Member Breakdown', margin, yPos);
      yPos += 15;
      
      // Table header
      doc.setFillColor(248, 249, 250);
      doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 12, 'F');
      doc.setFontSize(10);
      doc.setTextColor(33, 37, 41);
      doc.text('Customer', margin + 2, yPos + 3);
      doc.text('Services', margin + 70, yPos + 3);
      doc.text('Monthly Cost', margin + 110, yPos + 3);
      doc.text('Est. Savings', margin + 150, yPos + 3);
      
      yPos += 15;
      doc.setFontSize(9);
      doc.setTextColor(73, 80, 87);
      
      pool.invoices.forEach((invoice) => {
        if (yPos > 250) {
          doc.addPage();
          yPos = 30;
        }
        
        const servicesToShow = invoice.items ? Math.min(invoice.items.length, 999) : 0;
        const estimatedSavings = (invoice.totalCost || 0) * (savingsRate / 100);
        
        doc.text(invoice.customerName || 'Unknown', margin + 2, yPos);
        doc.text(`${servicesToShow}`, margin + 70, yPos);
        doc.text(`${(invoice.totalCost || 0).toLocaleString()}`, margin + 110, yPos);
        doc.text(`${estimatedSavings.toLocaleString()}`, margin + 150, yPos);
        yPos += 10;
      });
      
      // Footer with recommendations
      if (yPos > 200) {
        doc.addPage();
        yPos = 30;
      }
      
      yPos += 20;
      doc.setFontSize(16);
      doc.setTextColor(33, 37, 41);
      doc.text('Recommendations', margin, yPos);
      yPos += 15;
      
      doc.setFontSize(10);
      doc.setTextColor(73, 80, 87);
      const recommendations = [
        '• Join the AWS purchasing cooperative to realize these savings immediately',
        '• Larger pools create even greater volume discounts',
        '• Savings compound over time - annual benefits exceed monthly projections',
        '• No changes to your current AWS usage or architecture required'
      ];
      
      recommendations.forEach(rec => {
        doc.text(rec, margin, yPos);
        yPos += 8;
      });
      
      // Legal disclaimer
      yPos += 15;
      doc.setFontSize(8);
      doc.setTextColor(108, 117, 125);
      doc.text('* Savings estimates based on AWS published volume discount tiers. Actual savings may vary.', margin, yPos);
      doc.text('Contact us for more information about joining our cloud purchasing cooperative.', margin, yPos + 8);
      
      // Save the PDF
      const fileName = `aws-pooling-analysis-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);
      
    } catch (error) {
      console.error('PDF generation error:', error);
      alert('Failed to generate PDF. Please try again.');
    }
    
    setGenerating(false);
  };

  const canGenerate = pool.invoices.length > 0 && stats.totalCost > 0;

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h3 className="text-lg font-semibold mb-4 flex items-center">
        <Download className="mr-2" />
        Export Analysis Report
      </h3>
      
      <div className="space-y-4">
        <p className="text-gray-600">
          Generate a comprehensive PDF report showing pool statistics, individual savings, 
          and professional recommendations for stakeholder presentations.
        </p>
        
        {canGenerate && (
          <div className="bg-blue-50 p-3 rounded-lg text-sm">
            <p className="font-medium text-blue-800">Report will include:</p>
            <ul className="text-blue-700 mt-1 space-y-1">
              <li>• Executive summary with key metrics</li>
              <li>• Individual customer savings breakdown</li>
              <li>• Professional recommendations</li>
              <li>• Annual savings projections</li>
            </ul>
          </div>
        )}
        
        <button
          onClick={generatePDF}
          disabled={!canGenerate || generating}
          className="w-full bg-blue-500 text-white py-3 px-4 rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
        >
          {generating ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Generating PDF...
            </>
          ) : (
            <>
              <Download className="mr-2" size={16} />
              Generate Professional Report
            </>
          )}
        </button>
        
        {!canGenerate && (
          <p className="text-sm text-gray-500 text-center">
            Upload at least one invoice with valid cost data to generate a report
          </p>
        )}
      </div>
    </div>
  );
};

// Main App Component
const App = () => {
  return (
    <PoolProvider>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white shadow-sm border-b">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                AWS Cost Pooling Platform
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Discover how much your organization can save by joining our cloud purchasing cooperative. 
                Upload your AWS invoices to see real volume discount benefits.
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Dashboard */}
          <PoolDashboard />

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <InvoiceUploader />
            <PDFExporter />
          </div>

          {/* Invoice List */}
          <InvoiceList />
        </div>

        {/* Footer */}
        <footer className="bg-white border-t mt-12">
          <div className="max-w-7xl mx-auto px-4 py-6">
            <div className="text-center text-gray-500 text-sm">
              <p>AWS Cost Pooling Platform - Demonstrating volume discount savings through cooperative purchasing</p>
            </div>
          </div>
        </footer>
      </div>
    </PoolProvider>
  );
};

export default App;