import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { StoresList } from './components/StoresList';
import { StoreDashboard } from './components/StoreDashboard';
import FeedSearch from './components/FeedSearch';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<StoresList />} />
        <Route path="/store/:id" element={<StoreDashboard />} />
        <Route path="/search" element={<FeedSearch />} />
      </Routes>
    </Router>
  );
}

export default App;
