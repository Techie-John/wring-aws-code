import React, { useState, useContext, createContext, useCallback, useEffect, useRef } from 'react';
import { Upload, FileText, DollarSign, Users, TrendingDown, Download, X, Plus, Trash2, AlertCircle, CheckCircle, Info } from 'lucide-react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Pie } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

// Context for sharing state across components
const PoolContext = createContext(null);

// Pool Provider component
const PoolProvider = ({ children }) => {
  const [invoices, setInvoices] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const invoicesRes = await fetch('/api/invoices');
      const invoicesData = await invoicesRes.json();
      setInvoices(invoicesData);

      const statsRes = await fetch('/api/pool/stats');
      const statsData = await statsRes.json();
      setStats(statsData);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to fetch data from the server. Check your backend deployment.' });
      console.error('Failed to fetch data:', error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addInvoice = useCallback(async (formData) => {
    try {
      const response = await fetch('/api/invoices/upload', {
        method: 'POST',
        body: formData
      });
  
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload invoice');
      }
  
      const result = await response.json();
      setMessage({ type: 'success', text: `Invoice for '${result.invoice.customerName}' uploaded successfully!` });
      fetchData(); // Re-fetch data to get the updated pool stats
      return result;
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
      console.error('Add invoice error:', error);
    }
  }, [fetchData]);

  const removeInvoice = useCallback(async (id) => {
    try {
      const response = await fetch(`/api/invoices/${id}`, {
        method: 'DELETE',
      });
  
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete invoice');
      }
  
      setMessage({ type: 'success', text: 'Invoice removed successfully.' });
      fetchData(); // Re-fetch data
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
      console.error('Remove invoice error:', error);
    }
  }, [fetchData]);

  return (
    <PoolContext.Provider value={{ invoices, stats, loading, message, addInvoice, removeInvoice, fetchData }}>
      {children}
    </PoolContext.Provider>
  );
};

// Custom Hook for using the Pool Context
const usePool = () => {
  const context = useContext(PoolContext);
  if (context === null) {
    throw new Error('usePool must be used within a PoolProvider');
  }
  return context;
};

// Reusable components
const Message = ({ type, text }) => {
  const isError = type === 'error';
  const Icon = isError ? AlertCircle : CheckCircle;
  const bgColor = isError ? 'bg-red-100' : 'bg-green-100';
  const textColor = isError ? 'text-red-700' : 'text-green-700';

  return (
    <div className={`p-4 rounded-xl flex items-center gap-3 ${bgColor} ${textColor} mb-4`}>
      <Icon className="h-5 w-5" />
      <span className="font-medium text-sm">{text}</span>
    </div>
  );
};

const Card = ({ children, title, description, icon: Icon }) => (
  <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100 h-full flex flex-col">
    <div className="flex items-start gap-4 mb-4">
      <div className="p-3 bg-indigo-50 rounded-full text-indigo-600">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
        {description && <p className="text-gray-500 text-sm mt-1">{description}</p>}
      </div>
    </div>
    <div className="flex-grow flex items-center justify-center">
      {children}
    </div>
  </div>
);

// Components for the main application
const PoolDashboard = () => {
  const { stats, loading } = usePool();

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-md p-6 border border-gray-100 animate-pulse h-48"></div>
        ))}
      </div>
    );
  }

  const chartData = {
    labels: ['Total Invoices', 'Total Services'],
    datasets: [{
      data: [stats.totalInvoices, stats.totalServices],
      backgroundColor: ['#6366f1', '#a5b4fc'],
      hoverBackgroundColor: ['#4f46e5', '#818cf8'],
    }],
  };
  const options = {
    plugins: {
      legend: {
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: function(tooltipItem) {
            return `${tooltipItem.label}: ${tooltipItem.raw}`;
          }
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <Card title="Total Invoices" description="Number of invoices in the pool." icon={FileText}>
        <div className="text-5xl font-bold text-gray-900">{stats.totalInvoices}</div>
      </Card>
      <Card title="Total Services" description="Combined unique services across all invoices." icon={Users}>
        <div className="text-5xl font-bold text-gray-900">{stats.totalServices}</div>
      </Card>
      <Card title="Overall Pool Usage" description="The total combined usage for all services in the pool." icon={DollarSign}>
        <div className="flex-grow w-full flex items-center justify-center">
          <Pie data={chartData} options={options} />
        </div>
      </Card>
    </div>
  );
};

const InvoiceUploader = () => {
  const { addInvoice, message } = usePool();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
      await handleFileUpload(files[0]);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('invoiceFile', file);
    
    await addInvoice(formData);
    setUploading(false);
  };

  return (
    <div className="lg:col-span-1">
      <Card title="Upload Invoice" description="Upload a PDF invoice to add it to the pool." icon={Upload}>
        <div 
          className={`flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-xl transition-colors duration-200 ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white'}`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="text-center text-gray-500">
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-2" />
            <p className="font-semibold text-lg">
              {uploading ? 'Processing...' : 'Drag and drop your PDF here'}
            </p>
            <p className="text-sm">or</p>
            <button
              onClick={() => fileInputRef.current.click()}
              className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              disabled={uploading}
            >
              {uploading ? 'Uploading...' : 'Browse Files'}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileUpload(e.target.files[0])}
              className="hidden"
              accept=".pdf"
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

const PDFExporter = () => {
  const { invoices } = usePool();

  const generateReport = async (invoice) => {
    const doc = new window.jsPDF();
    doc.text(`Savings Report for ${invoice.customerName}`, 10, 10);
    doc.text(`Original Invoice File: ${invoice.originalFileName}`, 10, 20);
    doc.text(`Original Total Cost: $${invoice.totalCost.toFixed(2)}`, 10, 30);

    const res = await fetch(`/api/calculate-savings/${invoice.id}`);
    const data = await res.json();
    
    doc.text(`\n--- Savings Calculation ---`, 10, 40);
    doc.text(`Standalone Cost: $${data.standalone.toFixed(2)}`, 10, 50);
    doc.text(`Pooled Cost: $${data.pooled.toFixed(2)}`, 10, 60);
    doc.text(`Total Savings: $${data.savings.toFixed(2)}`, 10, 70);
    doc.text(`Savings Percentage: ${data.percentage.toFixed(2)}%`, 10, 80);

    doc.save(`savings-report-${invoice.customerName}.pdf`);
  };

  return (
    <div className="lg:col-span-1">
      <Card title="Generate PDF Report" description="Select an invoice to generate a savings report." icon={Download}>
        <div className="w-full">
          {invoices.length === 0 ? (
            <div className="text-center text-gray-500 p-6">
              <Info className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p>Upload an invoice first to generate a report.</p>
            </div>
          ) : (
            invoices.map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-2">
                <span className="font-medium text-gray-700">{invoice.customerName} - {invoice.originalFileName}</span>
                <button
                  onClick={() => generateReport(invoice)}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                >
                  <Download className="h-4 w-4 inline-block mr-2" />
                  Download
                </button>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

const InvoiceList = () => {
  const { invoices, removeInvoice, loading, message } = usePool();
  const [expandedInvoice, setExpandedInvoice] = useState(null);

  const toggleExpand = (invoiceId) => {
    setExpandedInvoice(expandedInvoice === invoiceId ? null : invoiceId);
  };

  const MemoizedInvoiceCard = React.memo(({ invoice, removeInvoice, isExpanded, toggleExpand }) => {
    const [savingsData, setSavingsData] = useState(null);
    const [savingsLoading, setSavingsLoading] = useState(false);
    const [savingsError, setSavingsError] = useState(null);

    const calculateSavings = async () => {
      setSavingsLoading(true);
      setSavingsError(null);
      try {
        const response = await fetch(`/api/calculate-savings/${invoice.id}`);
        if (!response.ok) {
          throw new Error('Failed to fetch savings data.');
        }
        const data = await response.json();
        setSavingsData(data);
      } catch (error) {
        setSavingsError(error.message);
        console.error('Savings calculation error:', error);
      } finally {
        setSavingsLoading(false);
      }
    };

    return (
      <div className="bg-white rounded-xl shadow-md p-6 mb-4 border border-gray-100 transition-all duration-300">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-xl font-semibold text-gray-800">{invoice.customerName}</h3>
            <p className="text-sm text-gray-500">{invoice.originalFileName}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-2xl font-bold text-gray-900">${invoice.totalCost.toFixed(2)}</span>
            <button
              onClick={() => removeInvoice(invoice.id)}
              className="p-2 text-red-600 hover:text-red-800 transition-colors duration-200"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                if (!isExpanded) {
                  calculateSavings();
                }
                toggleExpand(invoice.id);
              }}
              className="p-2 bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-200 transition-colors duration-200"
            >
              <Info className={`h-5 w-5 transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 animate-fadeIn">
            <h4 className="font-semibold text-lg text-gray-700 mb-2">Service Breakdown</h4>
            {invoice.items.length > 0 ? (
              <ul className="list-disc list-inside space-y-1 text-gray-600 mb-4">
                {invoice.items.map((item, index) => (
                  <li key={index} className="flex justify-between items-center">
                    <span>{item.service}: {item.usage} units</span>
                    <span className="font-medium">${item.totalCost.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 italic">No service items found for this invoice.</p>
            )}

            {savingsLoading ? (
              <p className="text-indigo-600 font-medium">Calculating savings...</p>
            ) : savingsError ? (
              <p className="text-red-600 font-medium">Error: {savingsError}</p>
            ) : savingsData ? (
              <div className="mt-4 p-4 rounded-lg bg-green-50 border border-green-200 flex flex-col sm:flex-row justify-between items-center shadow-inner">
                <div className="text-center sm:text-left">
                  <p className="text-2xl font-extrabold text-green-700">
                    <span className="inline-flex items-center">
                      <TrendingDown className="h-6 w-6 mr-1" />
                      Save {savingsData.percentage.toFixed(2)}%
                    </span>
                  </p>
                  <p className="text-sm text-green-600 mt-1">Total Savings: ${savingsData.savings.toFixed(2)}</p>
                </div>
                <div className="text-center sm:text-right mt-4 sm:mt-0">
                  <p className="text-sm text-gray-600">Standalone Cost: <span className="font-semibold">${savingsData.standalone.toFixed(2)}</span></p>
                  <p className="text-sm text-gray-600">Pooled Cost: <span className="font-semibold">${savingsData.pooled.toFixed(2)}</span></p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500 italic">Expand to view savings calculation.</p>
            )}
          </div>
        )}
      </div>
    );
  });

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Invoices in the Pool</h2>
      {message && <Message type={message.type} text={message.text} />}
      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-md p-6 border border-gray-100 animate-pulse h-28"></div>
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500 shadow-sm border border-gray-200">
          <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">No invoices uploaded yet.</p>
          <p className="text-sm mt-1">Upload a PDF invoice to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {invoices.map(invoice => (
            <MemoizedInvoiceCard 
              key={invoice.id} 
              invoice={invoice}
              removeInvoice={removeInvoice}
              isExpanded={expandedInvoice === invoice.id}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Main App component
export default function App() {
  return (
    <PoolProvider>
      <div className="min-h-screen bg-gray-50 font-sans">
        {/* Header */}
        <header className="bg-white shadow-sm border-b">
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
        </header>

        <main className="max-w-7xl mx-auto px-4 py-8">
          {/* Dashboard */}
          <PoolDashboard />

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <InvoiceUploader />
            <PDFExporter />
          </div>

          {/* Invoice List */}
          <InvoiceList />
        </main>

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
}
