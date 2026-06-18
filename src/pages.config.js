/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */

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
import Backtest from './pages/Backtest';
import Leaps from './pages/Leaps';
import TradeHistory from './pages/TradeHistory';

export const PAGES = {
	Probabilities,
	DayTrading,
	Live,
	Live2,
	Live3,
	Live4,
	News,
	Swing,
	Institutional,
	BotSettings,
	Journal,
	Library,
	Backtest,
	Leaps,
	TradeHistory,
};

export const pagesConfig = {
	mainPage: "Probabilities",
	Pages: PAGES,
};

