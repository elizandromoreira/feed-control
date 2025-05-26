import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { StoresList } from './components/StoresList';
import { StoreDashboard } from './components/StoreDashboard';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<StoresList />} />
        <Route path="/store/:id" element={<StoreDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
