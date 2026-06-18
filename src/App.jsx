import { Toaster } from "./components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from './lib/query-client'
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import GlobalErrorBoundary from './components/GlobalErrorBoundary';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { MarketContextProvider } from './lib/MarketContextProvider';
import UserNotRegisteredError from './components/UserNotRegisteredError';
import AppLayout from './components/layout/AppLayout';
import Probabilities from './pages/Probabilities';
import DayTrading from './pages/DayTrading';
import Live from './pages/Live';
import Live2 from './pages/Live2';
import Live3 from './pages/Live3';
import Live4 from './pages/Live4';
import News from './pages/News';
import Swing from './pages/Swing';
import Institutional from './pages/Institutional';
import BotSettings from './pages/BotSettings';
import Journal from './pages/Journal';
import Library from './pages/Library';
import LiveDashboard from './pages/LiveDashboard';
import Backtest from './pages/Backtest';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/Probabilities" replace />} />
      <Route element={<AppLayout />}>
        <Route path="/Probabilities" element={<Probabilities />} />
        <Route path="/Live" element={<Live />} />
        <Route path="/Live2" element={<Live2 />} />
        <Route path="/Live3" element={<Live3 />} />
        <Route path="/Live4" element={<Live4 />} />
        <Route path="/Backtest" element={<Backtest />} />
        <Route path="/DayTrading" element={<DayTrading />} />
        <Route path="/News" element={<News />} />
        <Route path="/Swing" element={<Swing />} />
        <Route path="/Institutional" element={<Institutional />} />
        <Route path="/BotSettings" element={<BotSettings />} />
        <Route path="/Journal" element={<Journal />} />
        <Route path="/Library" element={<Library />} />
        <Route path="/LiveDashboard" element={<LiveDashboard />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <GlobalErrorBoundary>
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <MarketContextProvider>
            <AuthenticatedApp />
          </MarketContextProvider>
        </Router>
        <Toaster />
        <SonnerToaster position="top-right" theme="dark" />
      </QueryClientProvider>
    </AuthProvider>
    </GlobalErrorBoundary>
  )
}

export default App