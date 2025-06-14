import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowLeft } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { API_URL } from '../config/apiConfig';

const FeedSearch = () => {
  const navigate = useNavigate();
  const [searchSku, setSearchSku] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [skuHistory, setSkuHistory] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('details');

  const handleSearch = async () => {
    if (!searchSku.trim()) {
      setError('Please enter a SKU to search');
      return;
    }

    setLoading(true);
    setError('');
    setSearchResults(null);
    setSkuHistory(null);

    try {
      // Search for SKU details
      const searchResponse = await fetch(`${API_URL}/feeds/search/${searchSku.trim()}`);
      const searchData = await searchResponse.json();

      if (!searchResponse.ok) {
        throw new Error(searchData.message || 'Failed to search SKU');
      }

      setSearchResults(searchData);

      // Get SKU history
      const historyResponse = await fetch(`${API_URL}/feeds/history/${searchSku.trim()}`);
      const historyData = await historyResponse.json();

      if (historyResponse.ok) {
        setSkuHistory(historyData);
      }
    } catch (err) {
      setError(err.message || 'An error occurred while searching');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const formatDate = (dateString) => {
    return format(new Date(dateString), 'MMM dd, yyyy HH:mm:ss');
  };

  const prepareChartData = () => {
    if (!skuHistory || !skuHistory.history) return [];

    return skuHistory.history
      .slice()
      .reverse()
      .map(item => ({
        date: format(new Date(item.created_at), 'MMM dd HH:mm'),
        quantity: parseInt(item.quantity) || 0,
        fullDate: formatDate(item.created_at)
      }));
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <button
          onClick={() => navigate('/')}
          className="btn btn-secondary flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
      </div>
      
      <div className="card">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-2">
            <Search className="h-5 w-5" />
            <h1 className="text-2xl font-bold">Feed Search</h1>
          </div>
          <p className="text-gray-600 mb-6">
            Search for product information across all Amazon feeds
          </p>

          <div className="flex gap-2 mb-6">
            <input
              type="text"
              placeholder="Enter SKU (e.g., SEDH329266175)"
              value={searchSku}
              onChange={(e) => setSearchSku(e.target.value)}
              onKeyPress={handleKeyPress}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button 
              onClick={handleSearch} 
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {error && (
            <div className="bg-error bg-opacity-10 border border-error text-error px-4 py-3 rounded mb-6">
              <p>{error}</p>
            </div>
          )}

          {searchResults && searchResults.data && searchResults.data.length === 0 && (
            <div className="bg-gray-100 px-4 py-3 rounded mb-6">
              <p>No data found for SKU: {searchSku}</p>
            </div>
          )}

          {searchResults && searchResults.data && searchResults.data.length > 0 && (
            <div>
              <div className="flex gap-2 mb-4">
                <button
                  className={`px-4 py-2 rounded ${activeTab === 'details' ? 'bg-primary text-white' : 'bg-gray-200'}`}
                  onClick={() => setActiveTab('details')}
                >
                  Details
                </button>
                <button
                  className={`px-4 py-2 rounded ${activeTab === 'history' ? 'bg-primary text-white' : 'bg-gray-200'}`}
                  onClick={() => setActiveTab('history')}
                >
                  History
                </button>
                <button
                  className={`px-4 py-2 rounded ${activeTab === 'raw' ? 'bg-primary text-white' : 'bg-gray-200'}`}
                  onClick={() => setActiveTab('raw')}
                >
                  Raw Data
                </button>
              </div>

              {activeTab === 'details' && (
                <div className="space-y-4">
                  {searchResults.data.map((feed, index) => (
                    <div key={feed.feed_id} className="card p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="text-lg font-semibold">Feed #{index + 1}</h3>
                          <p className="text-gray-600">{formatDate(feed.created_at)}</p>
                        </div>
                        <div className="flex gap-2">
                          <span className={`px-3 py-1 rounded-full text-sm ${
                            feed.status === 'processed' ? 'bg-success text-white' : 'bg-gray-200'
                          }`}>
                            {feed.status}
                          </span>
                          <span className="px-3 py-1 rounded-full text-sm bg-gray-200">
                            {feed.feed_type}
                          </span>
                        </div>
                      </div>

                      {feed.products.map((product, prodIndex) => (
                        <div key={prodIndex} className="space-y-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <p className="text-sm text-gray-600">SKU</p>
                              <p className="font-mono">{product.sku}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600">Quantity</p>
                              <p className="font-semibold">{product.quantity || '0'}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600">Channel</p>
                              <p>{product.channel || 'DEFAULT'}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600">Lead Time</p>
                              <p>{product.lead_time || 'N/A'} days</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm text-gray-600">Operation Type</p>
                              <p>{product.operation_type}</p>
                            </div>
                            <div>
                              <p className="text-sm text-gray-600">Product Type</p>
                              <p>{product.product_type}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-4">
                  {skuHistory && skuHistory.history && skuHistory.history.length > 0 ? (
                    <>
                      <div className="card p-6">
                        <h3 className="text-lg font-semibold mb-4">Quantity History</h3>
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={prepareChartData()}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="date" />
                              <YAxis />
                              <Tooltip 
                                content={({ active, payload }) => {
                                  if (active && payload && payload[0]) {
                                    return (
                                      <div className="bg-white border rounded p-2 shadow">
                                        <p className="text-sm">{payload[0].payload.fullDate}</p>
                                        <p className="text-sm font-semibold">
                                          Quantity: {payload[0].value}
                                        </p>
                                      </div>
                                    );
                                  }
                                  return null;
                                }}
                              />
                              <Line 
                                type="monotone" 
                                dataKey="quantity" 
                                stroke="#8884d8" 
                                strokeWidth={2}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>

                      <div className="card p-6">
                        <h3 className="text-lg font-semibold mb-4">History Details</h3>
                        <div className="space-y-2">
                          {skuHistory.history.map((item, index) => (
                            <div key={index} className="flex justify-between items-center py-2 border-b last:border-0">
                              <div>
                                <p className="text-sm">{formatDate(item.created_at)}</p>
                                <p className="text-xs text-gray-600">
                                  {item.store_id} - {item.operation_type}
                                </p>
                              </div>
                              <span className={`px-3 py-1 rounded text-sm ${
                                item.quantity > 0 ? 'bg-primary text-white' : 'bg-gray-200'
                              }`}>
                                Qty: {item.quantity}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-gray-100 px-4 py-3 rounded">
                      <p>No history data available for this SKU</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'raw' && (
                <div className="card p-6">
                  <h3 className="text-lg font-semibold mb-4">Raw JSON Data</h3>
                  <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-96 text-xs">
                    {JSON.stringify(searchResults, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedSearch;
